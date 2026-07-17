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
# Numérotation : "1.", "1-", "1)", "1:", "1&3-", "1&2&3.", chiffres romains —
# le séparateur inclut le tiret cadratin/demi-cadratin ("1 — Texte..."),
# très fréquent en PDF (mise en page Word qui convertit "-" en "—").
VERSE_RE = re.compile(r"^\s*(\d+(?:\s*&\s*\d+)*|[IVXivx]+)\s*[\.\-\)–—:]\s*(.+)$")
BULLET_RE = re.compile(r"^\s*[•●▪◦►\-\*]\s+(.+)$")
# Lignes dialoguées / voix alternées (chant à plusieurs voix ou en
# alternatim, ex. Gloria "A./B./Tous:") : mot complet ("Soliste:"/"Chœur:")
# ou abréviation à une ou deux lettres ("S/", "S/A :", "T/A:", "Ts:", "A.",
# "B-", "A)"...) — le séparateur couvre maintenant aussi le point, le tiret
# et la parenthèse fermante, pas seulement ":"/"/"/";", très fréquents dans
# les carnets scannés/PDF pour marquer une voix.
_VOIX_MOT = r"(?:Soliste|Solo|Ch[oœ]ur|Tous|Assembl[ée]e|Sop(?:rano)?|Alt(?:o)?|T[ée]nor|Basse|Cantor|Ts|[SATBHF](?:\s*/\s*[SATBHF])*)"
DIALOGUE_RE = re.compile(rf"^\s*{_VOIX_MOT}\s*[:/;.\-)]", re.IGNORECASE)
BIS_TER_RE = re.compile(r"\(\s*(bis|ter|x\s*\d)\s*\)\s*$", re.IGNORECASE)

INLINE_VERSE_SPLIT_RE = re.compile(r"(?=\b\d+(?:\s*&\s*\d+)*\s*[\.\-\)–—:]\s)")
# Repère un marqueur (Réf/numéro) même au MILIEU d'un paragraphe (deux
# couplets tapés à la suite sans saut de ligne, très fréquent dans les
# carnets sources) pour l'éclater en plusieurs lignes avant classification.
# Le numéro peut être collé au mot suivant sans espace ("1-Venez mes
# enfants", fréquent en PDF) : on n'exige donc qu'une majuscule juste après
# le séparateur plutôt qu'une espace obligatoire.
_INLINE_MARKER_SPLIT_RE = re.compile(
    r"(?<=\S)(?<!\(Ref)(?<!\(R[ée]f)\s+"
    r"(?=(?:R[ée]f(?:rain)?\.?\s*\d*\s*[:;])"
    r"|(?:\d+(?:\s*&\s*\d+)*\s*[\.\-\)–—:]\s*(?=[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ])))",
    re.IGNORECASE,
)
# Même principe pour les voix alternées (Gloria "A./B./Tous:" etc.) tapées
# à la suite sans le moindre saut de ligne, très fréquent en PDF ("Gloire à
# Dieu... A. Nous te louons... B. Nous t'adorons...") — sans cet éclatement,
# tout le chant reste un seul bloc et finit promu refrain par défaut faute
# d'un autre marqueur détecté à l'intérieur.
_INLINE_DIALOGUE_SPLIT_RE = re.compile(
    rf"(?<=\S)\s+(?={_VOIX_MOT}\s*[:/;.\-)]\s*(?=[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜÇ]))",
    re.IGNORECASE,
)

CODE_REFERENCE_RE = re.compile(r"^([A-Z]{1,2}\s?\d{1,3}\s?[a-z]?)\s+(.+)$")
CATEGORY_PREFIX_RE = re.compile(r"^([A-ZÉÈÀÂÎÔÛÇÏ][A-ZÉÈÀÂÎÔÛÇÏ \-]{2,25}?)\s*:\s*(.+)$")

# Cas 15 : mots-clés de section liturgique — jamais des titres de chant.
SECTION_KEYWORDS = {
    "ENTREE", "ENTRÉE", "KYRIE", "PRENDS PITIE", "PRENDS PITIÉ", "GLORIA", "PSAUME", 
    "ALLELUIA", "ALLÉLUIA", "ACCLAMATION", "CREDO", "PRIERE UNIVERSELLE", "PRIÈRE UNIVERSELLE", 
    "PU", "OFFERTOIRE", "SANCTUS", "ANAMNESE", "ANAMNÈSE", "NOTRE PERE", "NOTRE PÈRE", 
    "PATER", "AGNUS", "COMMUNION", "ACTION DE GRACE", "ACTION DE GRÂCE", "SORTIE",
    "CHANTS MARIAUX", "MARIAUX"
}

# Gros carnets multi-catégories (souvent des PDF) qui préfixent chaque chant
# d'un code "CATEGORIE[numéro] : Titre" (ex. "ENTREE2 : DANS LA PAIX...",
# "NOEL24: Un enfant est venu") — chaque chant a un code DIFFÉRENT, donc
# _detect_consistent_prefix (qui exige un préfixe unique et répété) ne peut
# pas le voir : ce marqueur est reconnu indépendamment, pour n'importe quel
# mot-clé de SECTION_KEYWORDS, avec ou sans numéro.
CODED_TITLE_RE = re.compile(
    r"^([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ]{2,25})\s*(\d{0,3})\s*(?:[:.\-]\s*(.*))?$",
    re.IGNORECASE
)
# Clés déjà passées par normaliser()+upper() (sans accents) puisque la
# recherche ci-dessous normalise systématiquement le mot capté.
_CODED_TITLE_CATEGORIES = {
    "ENTREE": "Entree",
    "KYRIE": "Kyrie",
    "GLORIA": "Gloria",
    "PSAUME": "Psaume",
    "ACCLAMATION": "Acclamation",
    "ACCLAMTION": "Acclamation", # gestion de la coquille dans le docx
    "ALLELUIA": "Acclamation",
    "CREDO": "Credo",
    "PRIERE UNIVERSELLE": "Priere_universelle",
    "PU": "Priere_universelle", "PRIERE": "Priere_universelle",
    "OFFERTOIRE": "Offertoire",
    "SANCTUS": "Sanctus",
    "ANAMNESE": "Anamnese",
    "NOTRE PERE": "Notre_Pere", "PATER": "Notre_Pere",
    "AGNUS": "Agnus",
    "COMMUNION": "Communion",
    "ACTION DE GRACE": "Action_de_grace",
    "SORTIE": "Sortie",
    "NOEL": "Noel",
    "CAREME": "Careme",
    "AVENT": "Avent",
    "PAQUES": "Paques",
    "MARIAGE": "Mariage",
    "DEFUNTS": "Defunts",
    "BAPTEME": "Bapteme_Confirmation",
}


# Éclate aussi un titre codé apparaissant en PLEIN MILIEu d'un paragraphe
# reconstruit (ex. fin d'un couplet collée au titre du chant suivant faute
# d'un espacement suffisant dans le PDF source pour que l'extraction les
# sépare). Le mot-clé capté est validé après coup via _CODED_TITLE_CATEGORIES
# (normalisé, donc insensible aux accents — "CARÊME2 :" doit être reconnu
# aussi bien que "CAREME2 :") plutôt que comparé littéralement à une liste
# ASCII figée, qui manquerait toute variante accentuée.
_CODED_TITLE_INLINE_RE = re.compile(
    r"(?<=\S)(\s+)(?=([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ]{3,25})\s*\d{0,3}\s*[:.\-]\s*\S)"
)


def _split_titres_codes(texte: str) -> list[str]:
    morceaux: list[str] = []
    dernier = 0
    for m in _CODED_TITLE_INLINE_RE.finditer(texte):
        if normaliser(m.group(2)).upper() not in _CODED_TITLE_CATEGORIES:
            continue
        morceaux.append(texte[dernier:m.start()])
        dernier = m.end()
    morceaux.append(texte[dernier:])
    return morceaux


_SECTION_HEAD_RE = re.compile(r"^[A-Z]\.?\s*([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ ]{3,30})$")


def _match_coded_title(ligne: str) -> Optional[tuple[str, str]]:
    cleaned = ligne.strip()
    m = CODED_TITLE_RE.match(cleaned)
    if not m:
        return None
    
    cat_raw = normaliser(m.group(1)).upper()
    categorie = _CODED_TITLE_CATEGORIES.get(cat_raw)
    if categorie is None:
        return None
    
    number = m.group(2) or ""
    reste = (m.group(3) or "").strip()
    reste = re.sub(r'^[«"\'\s]+|[»"\'\s]+$', '', reste)
    
    if ".." in reste or "…" in reste:
        return None
        
    if len(re.sub(r"[.\s\d]", "", reste)) < 2:
        if number:
            title = f"{m.group(1).strip().capitalize()} {number}"
        else:
            title = m.group(1).strip().capitalize()
    else:
        title = reste
        
    return categorie, title

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
    # Catégorie déduite d'un titre codé ("ENTREE2 : ...") quand la source en
    # fournit un — None si la catégorie doit venir du choix par défaut de
    # l'utilisateur à l'import.
    categorie_detectee: Optional[str] = None


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
        if _match_coded_title(p):
            lignes.append(p)
            continue
        for morceau in _INLINE_MARKER_SPLIT_RE.split(p):
            for sous_morceau in _split_titres_codes(morceau):
                for sous_sous_morceau in _INLINE_DIALOGUE_SPLIT_RE.split(sous_morceau):
                    sous_sous_morceau = sous_sous_morceau.strip()
                    if sous_sous_morceau:
                        lignes.append(sous_sous_morceau)
    return lignes


def _extract_code_reference(titre: str) -> tuple[Optional[str], str]:
    m = CODE_REFERENCE_RE.match(titre)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return None, titre


def _est_ligne_section(ligne: str) -> bool:
    cleaned = ligne.strip().upper().rstrip(":.")
    if cleaned in SECTION_KEYWORDS:
        return True
    m = _SECTION_HEAD_RE.match(cleaned)
    if m:
        val = m.group(1).strip()
        if val in SECTION_KEYWORDS or val.replace(" ", "") in SECTION_KEYWORDS:
            return True
    return False


# --- Classification ligne par ligne -------------------------------------

@dataclass
class _Ligne:
    texte: str
    type: str  # "ref" | "verset" | "dialogue" | "puce" | "texte"
    marqueur: Optional[str] = None  # numéro/préfixe capturé (verset/ref)
    contenu: str = ""  # texte après le marqueur


def _classer_ligne(ligne: str) -> _Ligne:
    if _est_ligne_section(ligne):
        return _Ligne(ligne, "texte", None, ligne)
        
    ref_m = REF_RE.match(ligne)
    if ref_m:
        return _Ligne(ligne, "ref", ref_m.group(1), ref_m.group(2).strip())
    verse_m = VERSE_RE.match(ligne)
    if verse_m:
        return _Ligne(ligne, "verset", verse_m.group(1), verse_m.group(2).strip())
    dialogue_m = DIALOGUE_RE.match(ligne)
    if dialogue_m:
        contenu = ligne[dialogue_m.end():].strip()
        return _Ligne(ligne, "dialogue", dialogue_m.group(0).strip(" :/;.-)"), contenu or ligne)
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
      -> plausible mais plus faible (cas 4 du cahier des charges).

    Le CANDIDAT élu ne peut venir que de blocs_avant_versets (texte non
    numéroté) — jamais d'un couplet déjà numéroté dans blocs_versets, sans
    quoi ce couplet se retrouverait promu refrain tout en restant listé
    comme couplet (ou pire, disparaîtrait des couplets si son texte
    coïncidait par ailleurs avec une entrée de blocs_avant_versets, la
    suppression ci-dessous ne visant que cette liste). tous_les_blocs ne sert
    qu'à VÉRIFIER qu'un candidat se répète ailleurs (y compris dans un
    couplet, ex. un rappel de refrain intégré à un couplet)."""
    if len(tous_les_blocs) >= 2:
        for a in blocs_avant_versets:
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

def _is_uppercase_title(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    return len(text) <= 60 and len(letters) >= 3 and all(c.isupper() for c in letters)


def segment_paragraphs_docx_clean(paragraphs: list[str]) -> list[RawChant]:
    chants: list[RawChant] = []
    
    titre_courant: Optional[str] = None
    categorie_courante: Optional[str] = None
    
    blocks = []
    current_block = None
    block_finished = False

    def flush_song():
        nonlocal titre_courant, categorie_courante, blocks, current_block, block_finished
        if current_block:
            blocks.append(current_block)
            current_block = None
            
        if titre_courant is None and not blocks:
            return
            
        chant = RawChant(titre=titre_courant or "(sans titre)", categorie_detectee=categorie_courante)
        
        ref_parts = []
        couplets = []
        for b in blocks:
            text = " / ".join(b["lines"])
            if b["type"] == "ref":
                ref_parts.append(text)
            else:
                if b["num"]:
                    couplets.append(f"{b['num']}- {text}")
                else:
                    couplets.append(text)
                    
        if ref_parts:
            chant.refrain = " / ".join(ref_parts)
            
        chant.couplets = couplets
        chant.confiance = _calculer_confiance(chant, 1.0, any(b["type"] == "couplet" and b["num"] for b in blocks))
        chants.append(_finalize(chant))
        
        titre_courant = None
        categorie_courante = None
        blocks = []
        block_finished = False

    for p in paragraphs:
        p_clean = p.strip()
        if not p_clean:
            block_finished = True
            continue
            
        if _est_ligne_section(p_clean):
            flush_song()
            continue
            
        coded = _match_coded_title(p_clean)
        if coded:
            flush_song()
            categorie_courante, titre_courant = coded
            continue
            
        if _is_uppercase_title(p_clean):
            flush_song()
            titre_courant = p_clean
            continue
            
        if titre_courant is None:
            titre_courant = "(sans titre)"
            
        ref_m = REF_RE.match(p_clean)
        verse_m = VERSE_RE.match(p_clean)
        
        if ref_m:
            if current_block:
                blocks.append(current_block)
            current_block = {"type": "ref", "lines": [ref_m.group(2).strip()]}
            block_finished = False
        elif verse_m:
            if current_block:
                blocks.append(current_block)
            current_block = {"type": "couplet", "num": verse_m.group(1), "lines": [verse_m.group(2).strip()]}
            block_finished = False
        else:
            if current_block and not block_finished:
                current_block["lines"].append(p_clean)
            else:
                if current_block:
                    blocks.append(current_block)
                current_block = {"type": "couplet", "num": None, "lines": [p_clean]}
                block_finished = False
                
    flush_song()
    return chants


def segment_paragraphs(paragraphs: list[str], is_clean_paragraphs: bool = False) -> list[RawChant]:
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
    if is_clean_paragraphs:
        return segment_paragraphs_docx_clean(paragraphs)
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
    categorie_courante: Optional[str] = None
    dernier_type: Optional[str] = None
    # Vrai dès qu'un Réf/verset/puce a été vu pour le chant en cours — une
    # ligne libre qui suit signale alors presque toujours le titre du chant
    # SUIVANT (comportement historique), plutôt qu'une suite du chant actuel.
    a_vu_marqueur = False

    def a_du_contenu() -> bool:
        return bool(blocs_refrain_explicite or blocs_versets or blocs_pre_versets)

    def flush():
        nonlocal titre_courant, categorie_courante, blocs_refrain_explicite, blocs_versets, blocs_pre_versets, dernier_type, a_vu_marqueur
        if titre_courant is None and not a_du_contenu():
            return
        chant = RawChant(titre=titre_courant or "(sans titre)", categorie_detectee=categorie_courante)
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
        categorie_courante = None
        blocs_refrain_explicite = []
        blocs_versets = []
        blocs_pre_versets = []
        dernier_type = None
        a_vu_marqueur = False

    for ligne in lignes:
        coded = _match_coded_title(ligne.texte)
        if coded:
            flush()
            categorie_courante, titre_courant = coded
            dernier_type = "titre"
            continue

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
            # Une voix (S/, A., Tous:...) qui suit un Réf/couplet déjà
            # engagé le prolonge (cas "1-S/ ... S/A: ..." où S/ fait
            # partie du couplet 1, jamais un nouveau couplet).
            if dernier_type == "ref" and blocs_refrain_explicite:
                blocs_refrain_explicite[-1] = f"{blocs_refrain_explicite[-1]} {ligne.texte}".strip()
                continue
            if dernier_type == "verset" and blocs_versets:
                m, t = blocs_versets[-1]
                blocs_versets[-1] = (m, f"{t} {ligne.texte}".strip())
                continue
            # Aucun Réf/couplet numéroté en cours pour ce chant : les voix
            # sont alors le SEUL marqueur structurel disponible (Gloria en
            # alternatim "A./B./Tous:", sans aucune numérotation) et
            # doivent créer des couplets distincts plutôt qu'un unique
            # bloc géant qui finirait promu refrain par défaut faute
            # d'un autre marqueur détecté à l'intérieur. dernier_type prend
            # une valeur DIFFÉRENTE de "verset" pour ne pas s'auto-prolonger
            # à la ligne dialoguée suivante (sinon seule la toute première
            # voix créerait un couplet, toutes les suivantes l'étendraient).
            if titre_courant is None and not a_du_contenu():
                titre_courant = "(sans titre)"
            blocs_versets.append((str(len(blocs_versets) + 1), ligne.contenu))
            dernier_type = "voix"
            a_vu_marqueur = True
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
