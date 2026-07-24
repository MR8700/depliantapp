"""Construit les unités atomiques d'une section (titre, refrain, chaque
couplet) et mesure leur hauteur réelle via ReportLab (`Flowable.wrap()`).
Chaque unité est indivisible : le LayoutEngine ne coupe jamais un couplet,
il déplace l'unité entière vers la zone suivante si elle ne rentre pas."""
from dataclasses import dataclass
from xml.sax.saxutils import escape

from reportlab.platypus import Paragraph

from .model import Section
from .typography import POLICE_ITALIQUE, mettre_en_gras_numero, mettre_en_gras_refrain

HAUTEUR_INFINIE = 10_000 * 72


@dataclass
class Unite:
    flowable: Paragraph
    hauteur: float
    section_ordre: int
    nature: str  # "titre" | "refrain" | "couplet"


def construire_unites_section(section: Section, styles: dict, largeur: float) -> list[Unite]:
    unites: list[Unite] = []

    def ajouter(flowable: Paragraph, nature: str) -> None:
        _, h = flowable.wrap(largeur, HAUTEUR_INFINIE)
        # `wrap()` ne renvoie que la hauteur intrinsèque du texte : ReportLab
        # ajoute séparément spaceBefore/spaceAfter au moment du rendu réel
        # (Frame._add, avec un "collapsing" qui prend le max entre deux
        # marges adjacentes). On additionne ici les deux marges plutôt que
        # de les fusionner : ça surestime légèrement l'espace nécessaire,
        # jamais l'inverse — condition nécessaire pour que le LayoutEngine
        # ne décide jamais qu'une unité tient alors que le rendu réel la
        # rejetterait silencieusement.
        style = flowable.style
        marges = (style.spaceBefore or 0) + (style.spaceAfter or 0)
        unites.append(Unite(flowable=flowable, hauteur=h + marges, section_ordre=section.ordre, nature=nature))

    titre_texte = f"<u>{escape(section.label).upper()}</u>"
    ajouter(Paragraph(titre_texte, styles["titre_section"]), "titre")

    song = section.song
    if song.titre:
        titre_html = escape(song.titre)
        if song.auteur_compositeur:
            # Sous-ligne auteur/compositeur intégrée au MÊME Paragraph (pas
            # une unité séparée) : une unité est indivisible (voir docstring
            # de fichier) -- il ne faut jamais que le titre et son auteur se
            # retrouvent séparés par un saut de zone/colonne.
            taille_auteur = max(styles["titre_chant"].fontSize - 1.5, 6)
            titre_html += f'<br/><font face="{POLICE_ITALIQUE}" size="{taille_auteur}">{escape(song.auteur_compositeur)}</font>'
        ajouter(Paragraph(titre_html, styles["titre_chant"]), "titre")

    if song.refrain:
        texte = mettre_en_gras_refrain(escape(song.refrain))
        ajouter(Paragraph(texte, styles["refrain"]), "refrain")

    for i, couplet in enumerate(song.couplets, start=1):
        texte = mettre_en_gras_numero(couplet, i)
        ajouter(Paragraph(texte, styles["couplet"]), "couplet")

    return unites


def construire_unites(sections: list[Section], styles: dict, largeur: float) -> list[Unite]:
    """Concatène les unités de toutes les sections, déjà triées par ordre —
    c'est cette liste plate que le LayoutEngine distribue zone par zone."""
    unites: list[Unite] = []
    for section in sections:
        unites.extend(construire_unites_section(section, styles, largeur))
    return unites
