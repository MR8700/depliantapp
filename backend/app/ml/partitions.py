"""Vérification automatique des partitions (copies notées, PDF) uploadées
pour un chant de la bibliothèque partagée.

Principe (voir discussion produit) : plusieurs signaux indépendants, chacun
un score 0-100 (ou None si inapplicable), sont MOYENNÉS -- jamais un seul
critère isolé ne décide. Sous le seuil, ou si l'analyse échoue pour
n'importe quelle raison (PDF corrompu, page vide, etc.), la partition est
orientée vers la validation humaine (statut 'a_verifier'), jamais rejetée
automatiquement -- ce module ne lève jamais d'exception vers l'appelant."""
import unicodedata
from difflib import SequenceMatcher
from typing import Optional

import fitz

SEUIL_AUTO_VALIDATION = 50.0

_PRODUCTEURS_NOTATION = [
    "musescore", "finale", "sibelius", "dorico", "lilypond", "capella",
    "notion", "encore", "harmony assistant", "guitar pro",
]

_POLICES_NOTATION = [
    "bravura", "leland", "emmentaler", "feta", "opus", "maestro", "sonata",
    "musicalsymbols", "petrucci", "finale numerics", "musejazz",
]


def _normaliser(texte: str) -> str:
    texte = unicodedata.normalize("NFKD", texte or "").encode("ascii", "ignore").decode("ascii").lower()
    return " ".join(texte.split())


def _score_metadonnees(doc) -> Optional[float]:
    """Les logiciels de notation laissent presque toujours une signature
    dans producer/creator -- signal fort mais absent des scans/photos."""
    try:
        meta = doc.metadata or {}
        blob = _normaliser(f"{meta.get('producer', '')} {meta.get('creator', '')}")
        if not blob:
            return None
        return 100.0 if any(p in blob for p in _PRODUCTEURS_NOTATION) else 0.0
    except Exception:
        return None


def _score_polices(doc) -> Optional[float]:
    """Les polices de gravure musicale ont des noms caractéristiques."""
    try:
        polices = set()
        for page in doc:
            for f in page.get_fonts():
                polices.add(_normaliser(f[3]))
        if not polices:
            return None
        blob = " ".join(polices)
        return 100.0 if any(p in blob for p in _POLICES_NOTATION) else 0.0
    except Exception:
        return None


def _score_lignes_portee(doc) -> Optional[float]:
    """Cherche, parmi les tracés vectoriels de la 1ère page, des groupes de
    5 lignes horizontales régulièrement espacées (une portée). Ne détecte
    que les partitions "natives" -- un scan/photo est une image sans tracés
    vectoriels, ce signal n'y contribue simplement pas (None), comme les
    autres en cas d'inapplicabilité."""
    try:
        page = doc[0]
        lignes_y = []
        for dessin in page.get_drawings():
            for item in dessin.get("items", []):
                if item[0] == "l":
                    p1, p2 = item[1], item[2]
                    if abs(p1.y - p2.y) < 0.5 and abs(p1.x - p2.x) > 40:
                        lignes_y.append(round(p1.y, 1))
        if len(lignes_y) < 5:
            return None
        lignes_y.sort()
        i = 0
        groupes = 0
        while i <= len(lignes_y) - 5:
            groupe = lignes_y[i:i + 5]
            ecarts = [groupe[j + 1] - groupe[j] for j in range(4)]
            if ecarts and (max(ecarts) - min(ecarts)) < 1.0 and 1.5 < ecarts[0] < 15:
                groupes += 1
                i += 5
            else:
                i += 1
        return 100.0 if groupes >= 1 else 0.0
    except Exception:
        return None


def _score_densite_texte(doc) -> Optional[float]:
    """Signal inverse : une partition a peu de texte extractible rapporté à
    la surface de page (paroles éparses sous les notes) ; un document de
    paroles/texte classique a une densité bien plus élevée."""
    try:
        page = doc[0]
        texte = page.get_text() or ""
        surface = page.rect.width * page.rect.height
        if surface <= 0 or not texte.strip():
            return None
        densite = len(texte) / surface
        if densite <= 0.005:
            return 100.0
        if densite >= 0.03:
            return 0.0
        return round(100.0 * (0.03 - densite) / (0.03 - 0.005), 1)
    except Exception:
        return None


def _extraire_titre_principal(doc) -> str:
    try:
        page = doc[0]
        blocs = page.get_text("dict").get("blocks", [])
        meilleur_texte, meilleure_taille = "", 0.0
        for bloc in blocs:
            for ligne in bloc.get("lines", []):
                for span in ligne.get("spans", []):
                    taille = span.get("size", 0)
                    texte = (span.get("text") or "").strip()
                    if texte and taille > meilleure_taille:
                        meilleur_texte, meilleure_taille = texte, taille
        return meilleur_texte
    except Exception:
        return ""


def _score_titre(doc, nom_fichier: str, chant_titre: str) -> Optional[float]:
    """Compare le plus gros bloc de texte de la page 1 (quasi toujours le
    titre dans un export de logiciel de notation) ET le nom du fichier
    uploadé au titre du chant -- garde la meilleure des deux similarités."""
    try:
        cible = _normaliser(chant_titre)
        if not cible:
            return None
        candidats = [_extraire_titre_principal(doc), nom_fichier.rsplit(".", 1)[0]]
        meilleur = 0.0
        trouve = False
        for candidat in candidats:
            candidat = _normaliser(candidat)
            if not candidat:
                continue
            trouve = True
            ratio = SequenceMatcher(None, cible, candidat).ratio()
            meilleur = max(meilleur, ratio)
        return round(meilleur * 100, 1) if trouve else None
    except Exception:
        return None


def _score_lexique(doc, chant_texte: str) -> Optional[float]:
    """Recouvrement lexical (Jaccard côté chant) entre le texte extrait du
    PDF et titre+refrain+couplets+mots-clés du chant -- ignore les mots de
    moins de 3 lettres (bruit : articles, numéros de page)."""
    try:
        texte_pdf = ""
        for page in doc:
            texte_pdf += page.get_text() or ""
        mots_pdf = {m for m in _normaliser(texte_pdf).split() if len(m) > 2}
        mots_chant = {m for m in _normaliser(chant_texte).split() if len(m) > 2}
        if not mots_chant or not mots_pdf:
            return None
        intersection = mots_pdf & mots_chant
        return round(100.0 * len(intersection) / len(mots_chant), 1)
    except Exception:
        return None


def analyser_partition(contenu: bytes, nom_fichier: str, chant: dict) -> dict:
    """Retourne {score: float|None, signaux: dict, statut: 'validee'|'a_verifier'}.

    Ne lève jamais : toute erreur (fichier corrompu, PDF illisible, etc.)
    retombe sur 'a_verifier' avec le détail dans signaux['erreur'] -- jamais
    un rejet, jamais un crash de l'upload."""
    try:
        chant_texte = " ".join(filter(None, [
            chant.get("titre"), chant.get("refrain"),
            " ".join(chant.get("couplets") or []), chant.get("code_reference"),
            " ".join(chant.get("mots_cles") or []),
        ]))
        doc = fitz.open(stream=contenu, filetype="pdf")
        try:
            signaux = {
                "metadonnees": _score_metadonnees(doc),
                "polices": _score_polices(doc),
                "lignes_portee": _score_lignes_portee(doc),
                "densite_texte": _score_densite_texte(doc),
                "titre": _score_titre(doc, nom_fichier, chant.get("titre") or ""),
                "lexique": _score_lexique(doc, chant_texte),
            }
        finally:
            doc.close()
        valeurs = [v for v in signaux.values() if v is not None]
        if not valeurs:
            return {"score": None, "signaux": signaux, "statut": "a_verifier"}
        score = round(sum(valeurs) / len(valeurs), 1)
        statut = "validee" if score >= SEUIL_AUTO_VALIDATION else "a_verifier"
        return {"score": score, "signaux": signaux, "statut": statut}
    except Exception as exc:
        return {"score": None, "signaux": {"erreur": str(exc)}, "statut": "a_verifier"}
