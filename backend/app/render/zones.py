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


def construire_zone_g(hauteur_priere_reservee: float = 0.0) -> tuple[Zone, Zone]:
    """G1 et G2 : demi-page gauche de la page 1, au-dessus de la bannière.
    Si la Prière pour le Burkina Faso est active, elle consomme toute la
    zone G2 (hauteur_priere_reservee > 0 signale juste que G2 est réservée ;
    le calcul de hauteur des zones G1/G2 pour les chants reste identique,
    seule leur inclusion dans le flux change)."""
    y = Y0 + HAUTEUR_BANNIERE
    hauteur = HAUTEUR_UTILE - HAUTEUR_BANNIERE
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


def construire_grille(priere_active: bool) -> Grille:
    """L'ordre de remplissage ne suit jamais l'ordre physique des pages : le
    moteur remplit des zones, pas des pages. D1/D2 (page 1, sous l'en-tête)
    sont remplies en premier, puis les 4 colonnes de la page 2, et seulement
    en dernier G1/G2 (page 1, au-dessus de la bannière) — jamais l'inverse,
    jamais une autre séquence."""
    d1, d2 = construire_zone_d()
    zones_p2 = construire_zones_page2()
    g1, g2 = construire_zone_g()

    toutes = {z.nom: z for z in [d1, d2, g1, g2, *zones_p2]}

    flow = [d1, d2, *zones_p2, g1]
    if not priere_active:
        flow.append(g2)
    return Grille(flow_order=flow, toutes=toutes)
