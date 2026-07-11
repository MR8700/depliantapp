import re
from collections import Counter
from pathlib import Path
from typing import Optional

import fitz

from .common import RawChant, VERSE_RE, finalize, normaliser, segment_paragraphs, split_inline_verses

_NUMERO_PAGE_RE = re.compile(r"^\d{1,4}$")
# Ligne de sommaire à points de suite ("ENTREE.......................... 02")
# — jamais du contenu de chant, à exclure entièrement plutôt que de risquer
# qu'elle se glisse dans un couplet/refrain.
_LIGNE_SOMMAIRE_RE = re.compile(r"\.{3,}\s*\d*\s*$")

# Fraction de la largeur de page en dessous de laquelle une ligne est
# considérée "étroite" (donc représentative d'une vraie colonne) plutôt
# qu'un en-tête/pied de page pleine largeur (ex. "CHORALE SAINT AUGUSTIN"
# répété sur chaque page) qui fausserait sinon la détection des colonnes.
_LARGEUR_ETROITE_RATIO = 0.55
# Écart minimal (fraction de la largeur de page) entre deux bords gauches
# consécutifs pour le considérer comme une vraie séparation de colonnes,
# plutôt qu'une simple variation d'indentation à l'intérieur d'une colonne.
_SEUIL_COLONNE_RATIO = 0.08
# Un saut vertical supérieur à ce multiple de la hauteur de ligne courante
# marque une vraie coupure de paragraphe (ligne suivante = nouveau chant/
# nouveau bloc) plutôt qu'un simple retour à la ligne d'une phrase qui continue.
_SEUIL_SAUT_PARAGRAPHE = 1.6


def _colonnes_frontieres(lignes: list[tuple[float, float, float, float, str]], largeur_page: float) -> list[float]:
    """Déduit les frontières verticales séparant les colonnes réelles d'une
    page en regroupant les bords GAUCHES des lignes ÉTROITES (un bloc pleine
    largeur comme un en-tête ne doit pas fausser la détection). On ne se fie
    volontairement qu'aux bords gauches, pas à un intervalle [x0, x1] fusionné
    de proche en proche : une seule ligne un peu plus longue que la normale
    suffirait sinon à faire fusionner en chaîne deux colonnes pourtant bien
    distinctes. De nombreux carnets sont en A4/Lettre PORTRAIT à 2 colonnes,
    pas systématiquement 4 comme le supposait l'ancienne heuristique
    'largeur > 600 => 4 colonnes', qui découpait alors arbitrairement au
    milieu de paragraphes normaux sur n'importe quelle page assez large (dont
    une simple page Lettre US, déjà large de 612pt à elle seule)."""
    etroites = [l for l in lignes if (l[2] - l[0]) < largeur_page * _LARGEUR_ETROITE_RATIO]
    if len(etroites) < 3:
        return []
    x0s = sorted(l[0] for l in etroites)
    seuil = largeur_page * _SEUIL_COLONNE_RATIO
    return [(x0s[i - 1] + x0s[i]) / 2 for i in range(1, len(x0s)) if x0s[i] - x0s[i - 1] > seuil]


def _assigner_colonnes(lignes: list[tuple[float, float, float, float, str]], largeur_page: float) -> list[list]:
    """Affecte chaque ligne à une colonne d'après son bord GAUCHE (x0), pas
    son centre : dans du texte aligné à gauche, deux lignes d'une même
    colonne partagent le même x0 mais peuvent avoir une largeur très
    différente (un court dernier mot de couplet vs. une ligne pleine), donc
    des CENTRES très différents — les classer par centre les éclaterait à
    tort dans des colonnes différentes alors qu'elles partagent le même x0
    que _colonnes_frontieres a utilisé pour définir ces frontières."""
    frontieres = _colonnes_frontieres(lignes, largeur_page)
    colonnes: list[list] = [[] for _ in range(len(frontieres) + 1)]
    for ligne in lignes:
        x0 = ligne[0]
        idx = sum(1 for f in frontieres if x0 > f)
        colonnes[idx].append(ligne)
    return colonnes


def _lignes_page(page: fitz.Page) -> list[tuple[float, float, float, float, str]]:
    """Une entrée par ligne visuelle (niveau le plus fin de get_text('dict')),
    pas par bloc PyMuPDF : sur un même document, PyMuPDF regroupe tantôt tout
    un chant en un seul bloc, tantôt une seule ligne par bloc, selon
    l'espacement — trop irrégulier pour s'y fier. On reconstruit nous-mêmes
    les paragraphes ensuite à partir des coordonnées (voir _regrouper)."""
    lignes = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            texte = "".join(s["text"] for s in spans).strip()
            if not texte:
                continue
            x0, y0, x1, y1 = line["bbox"]
            lignes.append((x0, y0, x1, y1, texte))
    return lignes


def _regrouper(lignes_colonne: list[tuple[float, float, float, float, str]]) -> list[str]:
    """Reconstruit des paragraphes à partir de lignes visuelles triées
    verticalement : un petit saut vertical (retour à la ligne d'une phrase
    qui continue) rejoint le paragraphe courant, un grand saut (ligne vide
    dans le PDF d'origine) en démarre un nouveau."""
    paragraphes: list[str] = []
    courant: list[str] = []
    dernier_y1: Optional[float] = None
    dernier_h: float = 0.0
    for x0, y0, x1, y1, texte in lignes_colonne:
        hauteur = max(y1 - y0, 1.0)
        if dernier_y1 is not None and (y0 - dernier_y1) > max(dernier_h, hauteur) * _SEUIL_SAUT_PARAGRAPHE:
            if courant:
                paragraphes.append(" ".join(courant))
            courant = []
        courant.append(texte)
        dernier_y1 = y1
        dernier_h = hauteur
    if courant:
        paragraphes.append(" ".join(courant))
    return paragraphes


# Fraction de la hauteur de page, depuis le haut/le bas, où un en-tête/pied
# de page peut physiquement se trouver. Restreindre la DÉTECTION à cette
# marge (plutôt que chercher un texte répété n'importe où sur la page) évite
# qu'un mot ou une courte formule qui revient par coïncidence dans plusieurs
# chants du carnet (ex. un mot de refrain fréquent) ne soit pris à tort pour
# un en-tête et supprimé partout dans le document.
_MARGE_ENTETE_PIED_RATIO = 0.1


def _entetes_pieds_de_page(
    pages: list[tuple[float, float, list[tuple[float, float, float, float, str]]]]
) -> set[str]:
    """Détecte les en-têtes/pieds de page répétés sur (presque) chaque page
    d'un carnet (ex. 'CHORALE SAINT AUGUSTIN ... PAROISSE DE POUYTENGA')
    pour les exclure : sinon ce texte, réinjecté à chaque page au milieu du
    flux d'une colonne, se glisse comme un faux couplet/refrain en plein
    milieu d'un chant. Seules les lignes situées dans la marge haute/basse de
    la page sont candidates (voir _MARGE_ENTETE_PIED_RATIO)."""
    n_pages = len(pages)
    if n_pages < 3:
        return set()
    compteur: Counter[str] = Counter()
    for _largeur, hauteur, lignes in pages:
        marge = hauteur * _MARGE_ENTETE_PIED_RATIO
        vus = set()
        for _x0, y0, _x1, y1, texte in lignes:
            if y0 > marge and y1 < hauteur - marge:
                continue
            cle = normaliser(texte)
            if cle and cle not in vus:
                compteur[cle] += 1
                vus.add(cle)
    seuil_repetition = max(4, int(n_pages * 0.2))
    return {cle for cle, n in compteur.items() if n >= seuil_repetition and len(cle) < 80}


def extract_paragraphs_pdf(path: Path) -> list[str]:
    """Extrait les paragraphes d'un PDF dans l'ordre de lecture réel, colonne
    par colonne (nombre de colonnes détecté dynamiquement page par page, pas
    figé à 4) puis page par page — reproduit ainsi l'ordre 'colonne 1 de haut
    en bas, puis colonne 2, puis page suivante colonne 1...' des livrets
    pliés, quel que soit leur nombre réel de colonnes (1, 2 ou 4)."""
    doc = fitz.open(path)
    try:
        pages = [(page.rect.width, page.rect.height, _lignes_page(page)) for page in doc]
    finally:
        doc.close()

    entetes_pieds = _entetes_pieds_de_page(pages)

    paragraphes: list[str] = []
    for largeur_page, _hauteur, lignes in pages:
        lignes_utiles = [
            l for l in lignes
            if normaliser(l[4]) not in entetes_pieds
            and not _NUMERO_PAGE_RE.match(l[4].strip())
            and not _LIGNE_SOMMAIRE_RE.search(l[4].strip())
        ]
        if not lignes_utiles:
            continue
        for colonne in _assigner_colonnes(lignes_utiles, largeur_page):
            colonne.sort(key=lambda l: l[1])
            paragraphes.extend(_regrouper(colonne))
    return paragraphes


def segment_pdf_paragraphs(path: Path) -> list[tuple[str, RawChant]]:
    """Segmentation générique d'un PDF quelconque : extraction en paragraphes
    dans le bon ordre de lecture, puis même moteur multi-indices à score de
    confiance que les carnets .doc/.docx (common.segment_paragraphs)."""
    paragraphes = extract_paragraphs_pdf(path)
    return [
        (chant.categorie_detectee or "Autre", chant)
        for chant in segment_paragraphs(paragraphes)
    ]


def segment_by_font(path: Path, title_min_size: float = 17.0) -> list[tuple[str, RawChant]]:
    """Segmentation pour les carnets sans numérotation ni en-tête de catégorie
    (ex. CHANT CHORALE.pdf), où seule la mise en forme distingue titre / refrain / couplet :
    titre = grande taille, refrain = gras, couplet = texte normal (numéroté ou non)."""
    doc = fitz.open(path)
    try:
        results: list[tuple[str, RawChant]] = []
        current: Optional[RawChant] = None
        active: Optional[str] = None

        def flush():
            nonlocal current
            if current is not None:
                results.append(("Autre", finalize(current)))
            current = None

        for page in doc:
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    spans = line.get("spans", [])
                    text = "".join(s["text"] for s in spans).strip()
                    if not text:
                        continue
                    max_size = max((s["size"] for s in spans), default=0)
                    is_bold = any(s["flags"] & 16 or "Bold" in s.get("font", "") for s in spans)

                    if max_size >= title_min_size:
                        flush()
                        current = RawChant(titre=text)
                        active = "titre"
                        continue

                    if current is None:
                        current = RawChant(titre="(sans titre)")

                    if is_bold:
                        current.refrain = f"{current.refrain} {text}".strip() if current.refrain else text
                        active = "refrain"
                        continue

                    verse_m = VERSE_RE.match(text)
                    if verse_m or active != "couplet" or not current.couplets:
                        current.couplets.extend(split_inline_verses(text))
                    else:
                        current.couplets[-1] = f"{current.couplets[-1]} {text}".strip()
                    active = "couplet"

        flush()
        return results
    finally:
        doc.close()


