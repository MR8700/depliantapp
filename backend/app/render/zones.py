"""Grille fixe du dépliant : le document n'est jamais pensé comme une
succession de Paragraph empilés, mais comme une page imprimée composée de
zones à coordonnées fixes (comme dans InDesign/Publisher/Scribus). Chaque
Zone a une position, une largeur et une hauteur invariables — le contenu
(chants) est ensuite injecté dans ces zones, jamais l'inverse."""
from dataclasses import dataclass

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm

PAGE_SIZE = landscape(A4)
PAGE_W, PAGE_H = PAGE_SIZE

MARGE = 5 * mm
ENTRE_COLONNES = 6 * mm
EPAISSEUR_BORDURE = 0.4

HAUTEUR_ENTETE = 46 * mm
"""Bloc fixe en haut du demi-page droite de la page 1 (logos, titre,
chorale, date, lectures) — jamais déplacé."""

HAUTEUR_BANNIERE = 45 * mm
"""Bande fixe en bas du demi-page gauche de la page 1 (annonce, bannière
décorative, coordonnées) — toujours présente, jamais utilisée pour les chants."""

X0 = MARGE
Y0 = MARGE
LARGEUR_UTILE = PAGE_W - 2 * MARGE
HAUTEUR_UTILE = PAGE_H - 2 * MARGE

LARGEUR_DEMI = (LARGEUR_UTILE - ENTRE_COLONNES) / 2
LARGEUR_COLONNE = (LARGEUR_DEMI - ENTRE_COLONNES) / 2
# Sur la page 2, 4 colonnes égales occupent toute la largeur utile — avec le
# même entre-colonnes, elles tombent exactement à la même largeur que les
# demi-colonnes de la page 1 (G1/G2/D1/D2), assurant une grille identique
# sur les deux pages.
LARGEUR_COLONNE_P2 = (LARGEUR_UTILE - 3 * ENTRE_COLONNES) / 4

X_GAUCHE = X0
X_DROITE = X0 + LARGEUR_DEMI + ENTRE_COLONNES


@dataclass(frozen=True)
class Zone:
    nom: str
    page: int
    x: float
    y: float
    largeur: float
    hauteur: float
    padding: float = 2.0


def _colonne_x(x_base: float, i: int, largeur: float) -> float:
    return x_base + i * (largeur + ENTRE_COLONNES)


def construire_zone_g(banniere_active: bool = True) -> tuple[Zone, Zone]:
    """G1 et G2 : demi-page gauche de la page 1, au-dessus de la bannière.
    Si la bannière n'est pas active, les colonnes descendent jusqu'au bas de la page."""
    y = Y0 + HAUTEUR_BANNIERE if banniere_active else Y0
    hauteur = HAUTEUR_UTILE - HAUTEUR_BANNIERE if banniere_active else HAUTEUR_UTILE
    g1 = Zone("G1", page=1, x=_colonne_x(X_GAUCHE, 0, LARGEUR_COLONNE), y=y, largeur=LARGEUR_COLONNE, hauteur=hauteur)
    g2 = Zone("G2", page=1, x=_colonne_x(X_GAUCHE, 1, LARGEUR_COLONNE), y=y, largeur=LARGEUR_COLONNE, hauteur=hauteur)
    return g1, g2


def construire_zone_d() -> tuple[Zone, Zone]:
    """D1 et D2 : demi-page droite de la page 1, sous l'en-tête fixe."""
    y = Y0
    hauteur = HAUTEUR_UTILE - HAUTEUR_ENTETE
    d1 = Zone("D1", page=1, x=_colonne_x(X_DROITE, 0, LARGEUR_COLONNE), y=y, largeur=LARGEUR_COLONNE, hauteur=hauteur)
    d2 = Zone("D2", page=1, x=_colonne_x(X_DROITE, 1, LARGEUR_COLONNE), y=y, largeur=LARGEUR_COLONNE, hauteur=hauteur)
    return d1, d2


def construire_zones_page2() -> list[Zone]:
    """4 colonnes strictement identiques occupant toute la page 2."""
    return [
        Zone(f"C{i + 1}", page=2, x=_colonne_x(X0, i, LARGEUR_COLONNE_P2), y=Y0,
             largeur=LARGEUR_COLONNE_P2, hauteur=HAUTEUR_UTILE)
        for i in range(4)
    ]


@dataclass(frozen=True)
class Grille:
    flow_order: list[Zone]
    """Ordre exact de remplissage des chants : D1 -> D2 -> page2 (4 colonnes)
    -> G1 -> G2 (G2 exclue si la Prière pour le Burkina Faso est active)."""
    toutes: dict[str, Zone]
    """Toutes les zones par nom, y compris celles hors du flux (ex: G2 quand
    la Prière l'occupe) — pour que le rendu puisse toujours les localiser."""


def construire_grille(priere_active: bool, one_page_mode: bool = False, banniere_active: bool = True) -> Grille:
    """L'ordre de remplissage ne suit jamais l'ordre physique des pages : le
    moteur remplit des zones, pas des pages. D1/D2 (page 1, sous l'en-tête)
    sont remplies en premier, puis les 4 colonnes de la page 2, et seulement
    en dernier G1/G2 (page 1, au-dessus de la bannière) — jamais l'inverse,
    jamais une autre séquence.
    Si one_page_mode est True, le flux est restreint à la moitié droite de la
    première page (D1/D2) et la partie gauche de la seconde page (C1/C2)."""
    d1, d2 = construire_zone_d()
    g1, g2 = construire_zone_g(banniere_active)

    if one_page_mode:
        # En mode 1 page, C1/C2 sont dessinés sur la moitié gauche de la page 1
        y_c = Y0 + HAUTEUR_BANNIERE if banniere_active else Y0
        h_c = HAUTEUR_UTILE - HAUTEUR_BANNIERE if banniere_active else HAUTEUR_UTILE
        c1 = Zone("C1", page=1, x=_colonne_x(X0, 0, LARGEUR_COLONNE_P2), y=y_c, largeur=LARGEUR_COLONNE_P2, hauteur=h_c)
        c2 = Zone("C2", page=1, x=_colonne_x(X0, 1, LARGEUR_COLONNE_P2), y=y_c, largeur=LARGEUR_COLONNE_P2, hauteur=h_c)
        # c3 and c4 are unused in 1-page mode but initialized to avoid KeyError in toutes
        c3 = Zone("C3", page=1, x=_colonne_x(X0, 2, LARGEUR_COLONNE_P2), y=Y0, largeur=LARGEUR_COLONNE_P2, hauteur=HAUTEUR_UTILE)
        c4 = Zone("C4", page=1, x=_colonne_x(X0, 3, LARGEUR_COLONNE_P2), y=Y0, largeur=LARGEUR_COLONNE_P2, hauteur=HAUTEUR_UTILE)
        zones_p2 = [c1, c2, c3, c4]
    else:
        zones_p2 = construire_zones_page2()

    toutes = {z.nom: z for z in [d1, d2, g1, g2, *zones_p2]}

    if one_page_mode:
        # En mode 1 page, si la prière est active, elle occupe C2. Donc C2 est exclu du flux des chants.
        flow = [d1, d2, c1]
        if not priere_active:
            flow.append(c2)
    else:
        flow = [d1, d2, *zones_p2, g1]
        if not priere_active:
            flow.append(g2)
    return Grille(flow_order=flow, toutes=toutes)
