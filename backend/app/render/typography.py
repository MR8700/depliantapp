"""Cascade typographique : la plus grande taille de police (parmi une échelle
fine, 11pt → 8pt par pas de 0.2) permettant à tout le contenu de tenir ; si
même 8pt ne suffit pas, réduction de l'interligne ; si ça ne suffit toujours
pas, réduction de l'espacement entre couplets — jamais l'inverse, et jamais de
police sous 8pt. Police Times (standard PDF, aucun fichier à embarquer) pour un
rendu "carnet imprimé" plutôt que le sans-serif d'un brouillon HTML."""
from dataclasses import dataclass

from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet

_styles = getSampleStyleSheet()

ECHELLE_POLICE_CORPS = [11.0, 10.8, 10.5, 10.2, 10.0, 9.8, 9.6, 9.4, 9.2, 9.0, 8.8, 8.6, 8.4, 8.2, 8.0]
FACTEURS_INTERLIGNE = [1.02, 0.98, 0.95]
ESPACEMENTS_COUPLET_MM = [3.0, 2.2, 1.5]


@dataclass(frozen=True)
class Typographie:
    police_corps: float
    facteur_interligne: float
    espacement_couplet_mm: float

    @property
    def police_titre(self) -> float:
        return round(self.police_corps * 1.05, 1)

    @property
    def interligne(self) -> float:
        return round(self.police_corps * self.facteur_interligne, 2)


def cascade_typographies():
    """Ordre exact demandé : d'abord toute l'échelle de police à interligne et
    espacement normaux, puis (seulement si 8pt ne suffit toujours pas) réduction
    de l'interligne à police minimale, puis réduction de l'espacement."""
    for police in ECHELLE_POLICE_CORPS:
        yield Typographie(police, FACTEURS_INTERLIGNE[0], ESPACEMENTS_COUPLET_MM[0])
    police_min = ECHELLE_POLICE_CORPS[-1]
    for facteur in FACTEURS_INTERLIGNE[1:]:
        yield Typographie(police_min, facteur, ESPACEMENTS_COUPLET_MM[0])
    for espacement in ESPACEMENTS_COUPLET_MM[1:]:
        yield Typographie(police_min, FACTEURS_INTERLIGNE[-1], espacement)


def construire_styles(typo: Typographie) -> dict:
    espacement_pt = typo.espacement_couplet_mm * 2.8346
    return {
        "titre_section": ParagraphStyle(
            f"TitreSection{id(typo)}", parent=_styles["Normal"],
            fontName="Times-Bold", fontSize=typo.police_titre, leading=typo.police_titre * 1.15,
            alignment=0, spaceAfter=espacement_pt, spaceBefore=espacement_pt * 1.3,
        ),
        "titre_chant": ParagraphStyle(
            f"TitreChant{id(typo)}", parent=_styles["Normal"],
            fontName="Times-Bold", fontSize=typo.police_corps, leading=typo.interligne,
            spaceAfter=espacement_pt * 0.6,
        ),
        "refrain": ParagraphStyle(
            f"Refrain{id(typo)}", parent=_styles["Normal"],
            fontName="Times-BoldItalic", fontSize=typo.police_corps, leading=typo.interligne,
            alignment=0, spaceAfter=espacement_pt,
        ),
        "couplet": ParagraphStyle(
            f"Couplet{id(typo)}", parent=_styles["Normal"],
            fontName="Times-Roman", fontSize=typo.police_corps, leading=typo.interligne,
            alignment=0, spaceAfter=espacement_pt,
        ),
        "contact": ParagraphStyle(
            f"Contact{id(typo)}", parent=_styles["Normal"],
            fontName="Times-Italic", fontSize=max(typo.police_corps - 1, 7), alignment=1,
        ),
        "espacement_pt": espacement_pt,
    }
