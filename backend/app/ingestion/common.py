"""Moteur de segmentation des chants — approche multi-indices à score de
confiance plutôt qu'une seule règle stricte (espacement entre paragraphes).

Les carnets réels utilisent au moins une quinzaine de conventions différentes
pour marquer titre/refrain/couplets (voir chaque *_RE ci-dessous et la
docstring de `segment_paragraphs`) — parfois même sans aucune séparation
physique entre elles (deux couplets dans le même paragraphe Word, sans saut
de ligne). Le pipeline est donc : éclatement des marqueurs même en milieu de
texte -> classification ligne par ligne -> regroupement en blocs (les lignes
« dialoguées » comme Soliste:/Chœur: prolongent le bloc courant, elles ne
créent jamais de nouveau couplet) -> détection du refrain par hypothèses
concurrentes quand aucune balise Réf/Refrain n'existe -> score de confiance
reflétant la fiabilité de chaque hypothèse, pour que l'atelier d'import
mette en avant les chants ambigus plutôt que de les importer silencieusement
de travers."""
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Optional

# --- Marqueurs structurels ---------------------------------------------

REF_RE = re.compile(r"^\s*(R[ée]f(?:rain)?\.?\s*\d*|R)\s*[:;]\s*(.*)$", re.IGNORECASE)
# Numérotation : "1.", "1-", "1)", "1:", "1&3-", "1&2&3.", chiffres romains.
VERSE_RE = re.compile(r"^\s*(\d+(?:\s*&\s*\d+)*|[IVXivx]+)\s*[\.\-\):]\s*(.+)$")
BULLET_RE = re.compile(r"^\s*[•●▪◦►\-\*]\s+(.+)$")
# Lignes dialoguées (chant à plusieurs voix) : ne créent jamais de nouveau
# couplet, prolongent seulement le bloc en cours (cas "Soliste:"/"Chœur:").
DIALOGUE_RE = re.compile(
    r"^\s*(Soliste|Solo|Ch[oœ]ur|Tous|Assembl[ée]e|Sop(?:rano)?|Alt(?:o)?|T[ée]nor|Basse|Cantor|H|F)\s*[:;]",
    re.IGNORECASE,
)
BIS_TER_RE = re.compile(r"\(\s*(bis|ter|x\s*\d)\s*\)\s*$", re.IGNORECASE)

INLINE_VERSE_SPLIT_RE = re.compile(r"(?=\b\d+(?:\s*&\s*\d+)*\s*[\.\-\):]\s)")
# Repère un marqueur (Réf/numéro) même au MILIEU d'un paragraphe (deux
# couplets tapés à la suite sans saut de ligne, très fréquent dans les
# carnets sources) pour l'éclater en plusieurs lignes avant classification.
_INLINE_MARKER_SPLIT_RE = re.compile(
    r"(?<=\S)(?<!\(Ref)(?<!\(R[ée]f)\s+"
    r"(?=(?:R[ée]f(?:rain)?\.?\s*\d*\s*[:;])|(?:\d+(?:\s*&\s*\d+)*\s*[\.\-\):]\s))",
    re.IGNORECASE,
)

CODE_REFERENCE_RE = re.compile(r"^([A-Z]{1,2}\s?\d{1,3}\s?[a-z]?)\s+(.+)$")
CATEGORY_PREFIX_RE = re.compile(r"^([A-ZÉÈÀÂÎÔÛÇÏ][A-ZÉÈÀÂÎÔÛÇÏ \-]{2,25}?)\s*:\s*(.+)$")

# Cas 15 : mots-clés de section liturgique — jamais des titres de chant.
SECTION_KEYWORDS = {
    "ENTREE", "ENTRÉE", "KYRIE", "GLORIA", "PSAUME", "ALLELUIA", "ALLÉLUIA",
    "ACCLAMATION", "CREDO", "PRIERE UNIVERSELLE", "PRIÈRE UNIVERSELLE", "PU",
    "OFFERTOIRE", "SANCTUS", "ANAMNESE", "ANAMNÈSE", "NOTRE PERE", "NOTRE PÈRE",
    "PATER", "AGNUS", "COMMUNION", "ACTION DE GRACE", "ACTION DE GRÂCE", "SORTIE",
}

TITRE_LONGUEUR_SUSPECTE = 60
# Une ligne libre plus longue que ça, après qu'un Réf/verset a déjà été vu
# pour le chant en cours, est presque certainement une phrase de contenu
# (rappel de refrain, suite de couplet) plutôt qu'un vrai titre de chant.
SEUIL_TITRE_COURT = 55
# Au-delà, un « refrain » ou un « couplet » est presque certainement le
# résultat d'une segmentation ratée (plusieurs couplets fusionnés en un
# seul bloc) plutôt qu'un authentique long refrain/couplet.
LONGUEUR_ANORMALE = 500


@dataclass
class RawChant:
    titre: str
    refrain: Optional[str] = None
    couplets: list[str] = field(default_factory=list)
    code_reference: Optional[str] = None
    confiance: float = 1.0
    avertissements: list[str] = field(default_factory=list)


def normaliser(texte: str) -> str:
    """Pour comparer deux textes en ignorant accents/casse/ponctuation/espaces
    multiples (ex: « Recevons l'Esprit » == « recevons l’esprit »), utilisé
    pour détecter les refrains répétés sans balise explicite."""
    texte = unicodedata.normalize("NFKD", texte)
    texte = "".join(c for c in texte if not unicodedata.combining(c))
    texte = texte.lower()
    texte = re.sub(r"[’‘'`´]", "'", texte)
    texte = re.sub(r"[^\w\s']", " ", texte)
    texte = re.sub(r"\s+", " ", texte).strip()
    return texte


def _similarite(a: str, b: str) -> float:
    return SequenceMatcher(None, normaliser(a), normaliser(b)).ratio()


def split_inline_verses(text: str) -> list[str]:
    """Sépare un paragraphe contenant plusieurs couplets numérotés collés
    (ex: paragraphe Word sans saut de ligne entre deux couplets)."""
    parts = INLINE_VERSE_SPLIT_RE.split(text)
    return [p.strip() for p in parts if p.strip()]


def _eclater_marqueurs_internes(paragraphs: list[str]) -> list[str]:
    """Avant toute classification : éclate chaque paragraphe source en
    plusieurs lignes logiques dès qu'un marqueur Réf/numéro apparaît en
    plein milieu du texte (pas seulement en tête de ligne) — les carnets
    sources tapent parfois refrain + 3 couplets à la suite dans un seul
    paragraphe Word, sans le moindre saut de ligne entre eux."""
    lignes: list[str] = []
    for p in paragraphs:
        for morceau in _INLINE_MARKER_SPLIT_RE.split(p):
            morceau = morceau.strip()
            if morceau:
                lignes.append(morceau)
    return lignes


def _extract_code_reference(titre: str) -> tuple[Optional[str], str]:
    m = CODE_REFERENCE_RE.match(titre)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return None, titre


def _est_ligne_section(ligne: str) -> bool:
    return ligne.strip().upper().rstrip(":.") in SECTION_KEYWORDS


# --- Classification ligne par ligne -------------------------------------

@dataclass
class _Ligne:
    texte: str
    type: str  # "ref" | "verset" | "dialogue" | "puce" | "texte"
    marqueur: Optional[str] = None  # numéro/préfixe capturé (verset/ref)
    contenu: str = ""  # texte après le marqueur


def _classer_ligne(ligne: str) -> _Ligne:
    ref_m = REF_RE.match(ligne)
    if ref_m:
        return _Ligne(ligne, "ref", ref_m.group(1), ref_m.group(2).strip())
    verse_m = VERSE_RE.match(ligne)
    if verse_m:
        return _Ligne(ligne, "verset", verse_m.group(1), verse_m.group(2).strip())
    if DIALOGUE_RE.match(ligne):
        return _Ligne(ligne, "dialogue", None, ligne)
    bullet_m = BULLET_RE.match(ligne)
    if bullet_m:
        return _Ligne(ligne, "puce", None, bullet_m.group(1).strip())
    return _Ligne(ligne, "texte", None, ligne)


def _detect_consistent_prefix(paragraphs: list[str]) -> Optional[str]:
    """Détecte un préfixe de catégorie répété en tête de titre (ex: 'SORTIE: ...'),
    utilisé par certains fichiers pour marquer le début de chaque chant."""
    prefixes = []
    for p in paragraphs:
        if REF_RE.match(p) or VERSE_RE.match(p):
            continue
        m = CATEGORY_PREFIX_RE.match(p.strip())
        if m:
            prefixes.append(m.group(1).strip().upper())
    if len(prefixes) < 2:
        return None
    common, count = Counter(prefixes).most_common(1)[0]
    if count >= 2 and count >= len(prefixes) * 0.5:
        return common
    return None


# --- Détection du refrain par hypothèses concurrentes -------------------

def _detecter_refrain_implicite(blocs_avant_versets: list[str], tous_les_blocs: list[str]) -> tuple[Optional[str], float]:
    """Quand aucune balise Réf/Refrain n'a été vue, teste plusieurs
    hypothèses et retient la plus fiable (texte, confiance) :
    - un bloc revient à l'identique (ou quasi) au moins deux fois -> fort
    - le tout premier bloc (avant le premier couplet numéroté) est court
      -> plausible mais plus faible (cas 4 du cahier des charges)."""
    if len(tous_les_blocs) >= 2:
        for i, a in enumerate(tous_les_blocs):
            if len(normaliser(a)) < 3:
                continue
            repetitions = sum(1 for b in tous_les_blocs if b is not a and _similarite(a, b) >= 0.85)
            if repetitions >= 1:
                exact = any(b is not a and _similarite(a, b) >= 0.98 for b in tous_les_blocs)
                return a, (0.95 if exact else 0.85)

    if blocs_avant_versets:
        premier = blocs_avant_versets[0]
        if len(premier) <= 220:
            return premier, 0.55

    return None, 0.0


# --- Segmentation principale ---------------------------------------------

def segment_paragraphs(paragraphs: list[str]) -> list[RawChant]:
    """Segmente une liste de paragraphes en chants individuels (titre, refrain, couplets).

    Approche multi-indices (pas une seule règle d'espacement) :
    1. éclate les marqueurs Réf/numéro même en plein milieu d'un paragraphe
       (cas très fréquent : plusieurs couplets tapés à la suite sans saut de
       ligne) ;
    2. classe chaque ligne (refrain / couplet numéroté ou à puce / voix
       dialoguée / texte libre) ;
    3. les lignes dialoguées (Soliste:/Chœur:/Tous:...) et le texte libre
       prolongent toujours le bloc en cours — jamais de nouveau couplet ;
    4. si aucune balise Réf/Refrain n'apparaît, teste plusieurs hypothèses de
       refrain implicite (texte répété, ou premier bloc court) plutôt que de
       tout classer comme couplet unique ;
    5. calcule une confiance qui redescend fortement si la segmentation
       obtenue est structurellement invraisemblable (refrain ou couplet
       anormalement long, titre contenant manifestement tout un chant) —
       pour que l'atelier d'import mette ces cas en avant plutôt que de les
       importer silencieusement de travers.

    Deux styles de source observés dans CHANTS/ :
    - Style « préfixé » : chaque titre commence par 'CATEGORIE: Titre' (ex.
      SORTIE.docx) ; les couplets suivants ne sont pas numérotés.
    - Style « numéroté » : titre nu, puis 'Ref :'/'Réf :', puis couplets
      numérotés '1-', '2-'... (ex. DEFUNTS.docx, KYRIE.doc) — le style
      largement dominant.
    """
    paragraphs = [p.strip() for p in paragraphs if p and p.strip()]
    paragraphs = [p for p in paragraphs if not _est_ligne_section(p)]
    prefix = _detect_consistent_prefix(paragraphs)
    lignes_brutes = _eclater_marqueurs_internes(paragraphs)
    lignes = [_classer_ligne(l) for l in lignes_brutes]

    chants: list[RawChant] = []
    # Un « chant en cours » accumule des blocs typés avant finalisation, pour
    # pouvoir tester les hypothèses de refrain implicite une fois toutes ses
    # lignes connues (on ne peut pas décider "refrain répété" ligne par ligne).
    blocs_refrain_explicite: list[str] = []
    blocs_versets: list[tuple[str, str]] = []  # (marqueur, texte)
    blocs_pre_versets: list[str] = []  # texte libre vu avant le 1er couplet
    titre_courant: Optional[str] = None
    dernier_type: Optional[str] = None
    # Vrai dès qu'un Réf/verset/puce a été vu pour le chant en cours — une
    # ligne libre qui suit signale alors presque toujours le titre du chant
    # SUIVANT (comportement historique), plutôt qu'une suite du chant actuel.
    a_vu_marqueur = False

    def a_du_contenu() -> bool:
        return bool(blocs_refrain_explicite or blocs_versets or blocs_pre_versets)

    def flush():
        nonlocal titre_courant, blocs_refrain_explicite, blocs_versets, blocs_pre_versets, dernier_type, a_vu_marqueur
        if titre_courant is None and not a_du_contenu():
            return
        chant = RawChant(titre=titre_courant or "(sans titre)")
        refrain_confiance = 1.0
        if blocs_refrain_explicite:
            chant.refrain = " / ".join(blocs_refrain_explicite)
        else:
            tous_blocs = blocs_pre_versets + [t for _, t in blocs_versets]
            refrain_implicite, refrain_confiance = _detecter_refrain_implicite(blocs_pre_versets, tous_blocs)
            if refrain_implicite is not None:
                chant.refrain = refrain_implicite
                if refrain_implicite in blocs_pre_versets:
                    blocs_pre_versets.remove(refrain_implicite)

        # blocs_versets stocke le texte tel qu'extrait par VERSE_RE (sans le
        # numéro, capturé séparément) — on reconstruit "numéro- texte" pour
        # rester compatible avec le rendu existant (mettre_en_gras_numero
        # sait détecter puis mettre en gras un numéro déjà présent).
        couplets = list(blocs_pre_versets)
        for marqueur, texte in blocs_versets:
            couplets.append(f"{marqueur}- {texte}")

        chant.couplets = couplets
        chant.confiance = _calculer_confiance(chant, refrain_confiance, bool(blocs_versets))
        chants.append(_finalize(chant))

        titre_courant = None
        blocs_refrain_explicite = []
        blocs_versets = []
        blocs_pre_versets = []
        dernier_type = None
        a_vu_marqueur = False

    for ligne in lignes:
        prefix_m = CATEGORY_PREFIX_RE.match(ligne.texte) if prefix else None
        is_boundary_title = bool(prefix_m and prefix_m.group(1).strip().upper() == prefix)

        if is_boundary_title:
            flush()
            titre_courant = prefix_m.group(2).strip()
            dernier_type = "titre"
            continue

        if ligne.type == "ref":
            if titre_courant is None and not a_du_contenu():
                titre_courant = "(sans titre)"
            blocs_refrain_explicite.append(ligne.contenu)
            dernier_type = "ref"
            a_vu_marqueur = True
            continue

        if ligne.type == "verset":
            if titre_courant is None and not a_du_contenu():
                titre_courant = "(sans titre)"
            blocs_versets.append((ligne.marqueur, ligne.contenu))
            dernier_type = "verset"
            a_vu_marqueur = True
            continue

        if ligne.type == "dialogue":
            # Prolonge toujours le bloc en cours (jamais un nouveau couplet).
            if dernier_type == "ref" and blocs_refrain_explicite:
                blocs_refrain_explicite[-1] = f"{blocs_refrain_explicite[-1]} {ligne.texte}".strip()
            elif dernier_type == "verset" and blocs_versets:
                m, t = blocs_versets[-1]
                blocs_versets[-1] = (m, f"{t} {ligne.texte}".strip())
            elif blocs_pre_versets:
                blocs_pre_versets[-1] = f"{blocs_pre_versets[-1]} {ligne.texte}".strip()
            else:
                blocs_pre_versets.append(ligne.texte)
            continue

        if ligne.type == "puce":
            if titre_courant is None and not a_du_contenu():
                titre_courant = "(sans titre)"
            blocs_versets.append((str(len(blocs_versets) + 1), ligne.contenu))
            dernier_type = "puce"
            a_vu_marqueur = True
            continue

        # ligne "texte" ordinaire (aucun marqueur reconnu).
        if prefix:
            # Style "préfixé" (ex. SORTIE.docx) : chaque ligne libre après le
            # titre est son propre couplet, jamais fusionnée (comportement
            # historique de ce style de carnet).
            blocs_versets.append((str(len(blocs_versets) + 1), ligne.texte))
            dernier_type = "verset"
            a_vu_marqueur = True
            continue

        if titre_courant is None:
            titre_courant = ligne.texte
            dernier_type = "titre"
            continue

        if a_vu_marqueur:
            # Une ligne libre après un Réf/verset déjà vu est SOIT le titre du
            # chant suivant, SOIT — cas 12 — un rappel de refrain intégré
            # entre deux couplets sans balise (ex: "1. ... Alléluia 2. ...
            # Alléluia"). On ne tranche pas juste sur la position : un vrai
            # titre est court ; un rappel répète (même approximativement) un
            # bloc déjà vu dans CE chant, ou est trop long pour être un titre.
            repete_bloc_existant = any(
                _similarite(ligne.texte, b) >= 0.75
                for b in blocs_refrain_explicite + [t for _, t in blocs_versets]
            )
            if len(ligne.texte) <= SEUIL_TITRE_COURT and not repete_bloc_existant:
                flush()
                titre_courant = ligne.texte
                dernier_type = "titre"
                continue

            if dernier_type == "verset" and blocs_versets:
                m, t = blocs_versets[-1]
                blocs_versets[-1] = (m, f"{t} {ligne.texte}".strip())
            elif dernier_type == "ref" and blocs_refrain_explicite:
                blocs_refrain_explicite[-1] = f"{blocs_refrain_explicite[-1]} {ligne.texte}".strip()
            else:
                blocs_pre_versets.append(ligne.texte)
            continue

        # Encore aucun marqueur structurel vu pour ce chant : cas 4 (intro
        # courte = refrain implicite) ou cas 7 (blocs non numérotés = autant
        # de couplets) — chaque nouvelle ligne libre devient un bloc candidat
        # séparé plutôt que d'être fusionnée indéfiniment au titre.
        blocs_pre_versets.append(ligne.texte)
        dernier_type = "texte"

    flush()
    return chants


def _calculer_confiance(chant: RawChant, refrain_confiance: float, avait_numerotation: bool) -> float:
    """Combine plusieurs signaux plutôt qu'une seule règle : présence
    refrain+couplets, mode de détection du refrain (balise explicite vs
    hypothèse), et surtout des garde-fous qui redescendent la confiance si
    la segmentation obtenue est structurellement invraisemblable."""
    if chant.refrain and chant.couplets:
        base = 1.0 if refrain_confiance >= 0.95 else max(0.6, refrain_confiance)
    elif len(chant.couplets) >= 2:
        base = 0.95 if avait_numerotation else 0.6
    elif chant.refrain or chant.couplets:
        base = 0.5
    else:
        base = 0.3

    # Garde-fous : une segmentation ratée produit typiquement un bloc bien
    # trop long (plusieurs couplets fusionnés faute de marqueur détecté).
    if chant.refrain and len(chant.refrain) > LONGUEUR_ANORMALE:
        base = min(base, 0.35)
        chant.avertissements.append("Refrain anormalement long — probable fusion de plusieurs couplets.")
    for c in chant.couplets:
        if len(c) > LONGUEUR_ANORMALE:
            base = min(base, 0.35)
            chant.avertissements.append("Un couplet anormalement long — probable fusion de plusieurs couplets.")
            break
    if len(chant.titre) > TITRE_LONGUEUR_SUSPECTE:
        base = min(base, 0.4)
        chant.avertissements.append("Titre anormalement long — probablement plusieurs paragraphes fusionnés à tort.")

    return round(base, 2)


def _finalize(chant: RawChant) -> RawChant:
    code, titre = _extract_code_reference(chant.titre)
    chant.titre = titre
    chant.code_reference = code
    return chant


def finalize(chant: RawChant) -> RawChant:
    """Conservé pour compatibilité avec parse_pdf.py, qui construit ses
    RawChant lui-même (segmentation par page/police, hors du pipeline
    ci-dessus) et n'a besoin que de l'extraction de code_reference + d'une
    confiance basique."""
    code, titre = _extract_code_reference(chant.titre)
    chant.titre = titre
    chant.code_reference = code
    if chant.refrain and chant.couplets:
        chant.confiance = 1.0
    elif len(chant.couplets) >= 2:
        chant.confiance = 0.7
    elif chant.refrain or chant.couplets:
        chant.confiance = 0.5
    else:
        chant.confiance = 0.3
    if len(chant.titre) > TITRE_LONGUEUR_SUSPECTE:
        chant.confiance = min(chant.confiance, 0.6)
    return chant
