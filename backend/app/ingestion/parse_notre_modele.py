"""Parseur dédié aux PDF générés par notre propre moteur (backend/app/render/) —
grille fixe A4 paysage, zones à coordonnées connues (zones.py), typographie fixe
Times 8/9pt (typography.py). Contrairement aux heuristiques génériques de
parse_pdf.py (pensées pour des carnets Word/PDF arbitraires, format inconnu),
ce parseur exploite la structure exacte que nous contrôlons pour reconstruire
les chants avec fiabilité plutôt qu'au mieux-effort.

Principe : le LayoutEngine ne fait que répartir une file plate d'unités
(titre de section, titre de chant, refrain, couplets) dans les zones, dans
l'ordre D1->D2->page2(C1-C4)->G1->G2, sans jamais réordonner ni fusionner deux
unités. Reconstruire cette file — en extrayant le texte zone par zone, dans ce
même ordre — annule donc exactement la distribution, quelle que soit la façon
dont le contenu a été coupé entre les zones."""
from typing import Optional

import fitz

from .common import REF_RE, VERSE_RE, RawChant, finalize
from ..render.labels import LABELS_MOMENTS
from ..render.widgets import DEFAULT_PRIERE_TITRE
from ..render.zones import PAGE_SIZE, construire_grille

_REVERSE_LABELS = {v.upper(): k for k, v in LABELS_MOMENTS.items()}
_PAGE_W, _PAGE_H = PAGE_SIZE
_TOLERANCE = 5.0
_CONFIANCE_MIN_SECTIONS = 2
"""Nombre minimal de titres de section reconnus (correspondant à un moment
liturgique connu) pour accepter ce PDF comme provenant de notre moteur —
évite de traiter à tort un carnet quelconque juste parce qu'il est en A4
paysage."""


def _page_taille_ok(doc: fitz.Document) -> bool:
    if doc.page_count == 0:
        return False
    page = doc[0]
    return (
        abs(page.rect.width - _PAGE_W) < _TOLERANCE
        and abs(page.rect.height - _PAGE_H) < _TOLERANCE
    )


def _zone_rect(zone) -> fitz.Rect:
    """PyMuPDF utilise une origine en haut à gauche (y croissant vers le bas),
    ReportLab (donc nos zones) une origine en bas à gauche (y croissant vers
    le haut) — d'où l'inversion."""
    y_top = _PAGE_H - (zone.y + zone.hauteur)
    y_bottom = _PAGE_H - zone.y
    return fitz.Rect(zone.x, y_top, zone.x + zone.largeur, y_bottom)


def _est_titre_section(texte: str, gras: bool) -> bool:
    lettres = [c for c in texte if c.isalpha()]
    return gras and bool(lettres) and texte == texte.upper()


def _lignes_zone(page: fitz.Page, zone) -> list[tuple[str, bool]]:
    """Lignes de texte de la zone, dans l'ordre de lecture (haut -> bas),
    avec un indicateur « entièrement en gras » (nos titres de section sont
    toujours gras+capitales dans typography.py, jamais le corps de texte)."""
    data = page.get_text("dict", clip=_zone_rect(zone))
    lignes = []
    for block in data.get("blocks", []):
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            texte = "".join(s["text"] for s in spans).strip()
            if not texte:
                continue
            tout_gras = bool(spans) and all("Bold" in s.get("font", "") for s in spans)
            lignes.append((texte, tout_gras, line["bbox"][1]))
    lignes.sort(key=lambda t: t[2])
    return [(t, g) for t, g, _ in lignes]


def _paragraphes_zone(page: fitz.Page, zone) -> list[tuple[str, str]]:
    """Regroupe les lignes en paragraphes (une entrée = un flowable généré
    côté rendu par measure.py) : un titre de section démarre toujours son
    propre paragraphe ; un couplet/refrain démarre dès que son marqueur
    (numéro ou « Réf : ») est reconnu ; sinon la ligne prolonge le paragraphe
    courant (retour à la ligne dans un même flowable, texte qui a débordé)."""
    paragraphes: list[dict] = []
    for texte, gras in _lignes_zone(page, zone):
        if _est_titre_section(texte, gras):
            if paragraphes and paragraphes[-1]["kind"] == "titre_section":
                paragraphes[-1]["lignes"].append(texte)
            else:
                paragraphes.append({"kind": "titre_section", "lignes": [texte]})
            continue
        if gras:
            # Ligne entièrement en gras mais pas en capitales : titre de chant
            # (son propre flowable, cf. measure.py) — jamais le prolongement
            # du titre de section qui précède, même s'il n'y a pas de marqueur
            # explicite entre les deux.
            if paragraphes and paragraphes[-1]["kind"] == "titre_chant":
                paragraphes[-1]["lignes"].append(texte)
            else:
                paragraphes.append({"kind": "titre_chant", "lignes": [texte]})
            continue
        if REF_RE.match(texte) or VERSE_RE.match(texte):
            paragraphes.append({"kind": "marque", "lignes": [texte]})
            continue
        if paragraphes:
            paragraphes[-1]["lignes"].append(texte)
        else:
            paragraphes.append({"kind": "texte", "lignes": [texte]})
    return [(p["kind"], " ".join(p["lignes"])) for p in paragraphes]


def extraire_paragraphes(doc: fitz.Document) -> tuple[list[tuple[str, str]], Optional[str]]:
    """Concatène les paragraphes de chaque zone dans l'ordre exact de
    remplissage du LayoutEngine — ce qui annule la distribution en zones et
    restitue la file plate d'origine. Isole séparément le texte de la Prière
    pour le Burkina Faso si ce widget occupait la zone G2."""
    grille = construire_grille(priere_active=False)  # inclut G2 dans le flux pour la lecture
    priere_texte = None
    paragraphes: list[tuple[str, str]] = []
    for zone in grille.flow_order:
        page = doc[zone.page - 1]
        zone_paragraphes = _paragraphes_zone(page, zone)
        if zone.nom == "G2" and zone_paragraphes:
            premier = zone_paragraphes[0][1].strip().upper()
            if premier == DEFAULT_PRIERE_TITRE.upper():
                priere_texte = "\n\n".join(t for _, t in zone_paragraphes[1:])
                continue
        paragraphes.extend(zone_paragraphes)
    return paragraphes, priere_texte


def _segmenter(paragraphes: list[tuple[str, str]]) -> list[tuple[str, RawChant]]:
    results: list[tuple[str, RawChant]] = []
    categorie = "Autre"
    current: Optional[RawChant] = None
    attend_titre_chant = False

    def flush():
        nonlocal current
        if current is not None:
            results.append((categorie, finalize(current)))
        current = None

    for kind, texte in paragraphes:
        if kind == "titre_section":
            flush()
            categorie = _REVERSE_LABELS.get(texte.strip().upper(), "Autre")
            current = RawChant(titre="(sans titre)")
            attend_titre_chant = True
            continue

        if current is None:
            current = RawChant(titre="(sans titre)")

        if kind == "titre_chant":
            current.titre = texte
            attend_titre_chant = False
            continue

        ref_m = REF_RE.match(texte)
        verse_m = VERSE_RE.match(texte)

        if ref_m:
            current.refrain = ref_m.group(2).strip()
            attend_titre_chant = False
            continue
        if verse_m:
            current.couplets.append(texte)
            attend_titre_chant = False
            continue

        if attend_titre_chant:
            current.titre = texte
            attend_titre_chant = False
        # sinon : ligne inattendue (ex. fragment d'en-tête/bannière capté par erreur en
        # bord de zone) — ignorée plutôt que de corrompre le dernier couplet reconnu.

    flush()
    return [(cat, raw) for cat, raw in results if raw.titre != "(sans titre)" or raw.couplets]


def segment_notre_modele(path) -> Optional[list[tuple[str, RawChant]]]:
    """Retourne la liste (catégorie, chant brut) si `path` a été généré par
    notre propre moteur, sinon None (pour laisser `parse_and_segment`
    retomber sur les heuristiques génériques)."""
    doc = fitz.open(path)
    try:
        if not _page_taille_ok(doc):
            return None
        paragraphes, _priere_texte = extraire_paragraphes(doc)
        resultats = _segmenter(paragraphes)
        sections_reconnues = sum(1 for cat, _ in resultats if cat != "Autre")
        if sections_reconnues < _CONFIANCE_MIN_SECTIONS:
            return None
        return resultats
    finally:
        doc.close()
