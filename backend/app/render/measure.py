"""Mesure la hauteur réelle qu'occupera une section (titre + refrain + couplets)
avant de décider dans quelle colonne la placer — en demandant à ReportLab de
calculer lui-même (`Flowable.wrap()`) plutôt qu'en estimant au pixel près."""
import re
from xml.sax.saxutils import escape

from reportlab.platypus import KeepTogether, Paragraph

from .model import Section

HAUTEUR_INFINIE = 10_000 * 72  # bien plus grand que n'importe quelle colonne

_NUMERO_DEJA_PRESENT = re.compile(r"^\s*\d+\s*[.\-–]")


def construire_flowables_section(section: Section, styles: dict) -> list:
    flowables = [Paragraph(f"<u>{escape(section.label)}</u>", styles["titre_section"])]

    song = section.song
    if song.titre:
        flowables.append(Paragraph(escape(song.titre), styles["titre_chant"]))
    if song.refrain:
        flowables.append(Paragraph(f"Réf : {escape(song.refrain)}", styles["refrain"]))

    plusieurs = len(song.couplets) > 1
    for i, couplet in enumerate(song.couplets, start=1):
        deja_numerote = bool(_NUMERO_DEJA_PRESENT.match(couplet))
        prefixe = f"{i}. " if (song.refrain or plusieurs) and not deja_numerote else ""
        flowables.append(Paragraph(f"{prefixe}{escape(couplet)}", styles["couplet"]))

    return flowables


def mesurer_hauteur(flowables: list, largeur: float) -> float:
    """Somme des hauteurs individuelles (mesure ReportLab réelle via wrap()),
    équivalent à la hauteur qu'occupera le groupe une fois rendu à la suite."""
    total = 0.0
    for f in flowables:
        _, h = f.wrap(largeur, HAUTEUR_INFINIE)
        total += h
    return total


def construire_section_mesuree(section: Section, styles: dict, largeur: float) -> tuple[float, list]:
    flowables = construire_flowables_section(section, styles)
    hauteur = mesurer_hauteur(flowables, largeur)
    return hauteur, [KeepTogether(flowables)]
