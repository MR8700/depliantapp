"""Construit les unités atomiques d'une section (titre, refrain, chaque
couplet) et mesure leur hauteur réelle via ReportLab (`Flowable.wrap()`).
Chaque unité est indivisible : le LayoutEngine ne coupe jamais un couplet,
il déplace l'unité entière vers la zone suivante si elle ne rentre pas."""
import re
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

    song = section.song
    moment_upper = escape(section.label).upper() if section.label else ""

    # Titre ou précision du chant
    titre_chant = (song.titre or "").strip()
    refrain_chant = (song.refrain or "").strip()

    # Déterminer si le titre du chant est redondant avec le refrain
    est_redondant_refrain = False
    if titre_chant and refrain_chant:
        t_clean = re.sub(r"^(r[ée]f|ref)\s*:\s*", "", titre_chant, flags=re.IGNORECASE).strip().lower()
        r_clean = re.sub(r"^(r[ée]f|ref)\s*:\s*", "", refrain_chant, flags=re.IGNORECASE).strip().lower()
        if len(t_clean) >= 6 and (t_clean[:18] in r_clean or r_clean[:18] in t_clean):
            est_redondant_refrain = True

    est_meme_que_moment = titre_chant.lower() == section.label.lower() if titre_chant else False

    complement = ""
    if titre_chant and not est_redondant_refrain and not est_meme_que_moment:
        complement = titre_chant

    if song.auteur_compositeur:
        if complement and song.auteur_compositeur not in complement:
            complement += f" ({song.auteur_compositeur})"
        elif not complement:
            complement = song.auteur_compositeur

    est_deuxieme_chant = " 2" in moment_upper or "_2" in moment_upper

    if est_deuxieme_chant:
        en_tete_texte = f"<b>{escape(complement or titre_chant)}</b>" if (complement or titre_chant) else ""
    elif moment_upper and complement:
        en_tete_texte = f"<u>{moment_upper}</u> : {escape(complement)}"
    elif moment_upper:
        en_tete_texte = f"<u>{moment_upper}</u> :"
    elif complement:
        en_tete_texte = f"<b>{escape(complement)}</b>"
    else:
        en_tete_texte = ""

    if en_tete_texte:
        ajouter(Paragraph(en_tete_texte, styles["titre_section"]), "titre")

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
