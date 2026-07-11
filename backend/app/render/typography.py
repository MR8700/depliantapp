"""Typographie fixe et invariable — jamais de cascade, jamais de réduction
de police pour faire tenir le texte. Si le contenu ne tient pas dans les
zones disponibles, le moteur le signale (DepassementImpossible) plutôt que
de trahir la maquette."""
import re
from dataclasses import dataclass
from xml.sax.saxutils import escape

from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet

_styles = getSampleStyleSheet()

POLICE = "Times-Roman"
POLICE_GRAS = "Times-Bold"
POLICE_ITALIQUE = "Times-Italic"

TAILLE_TEXTE = 8.0
TAILLE_TITRE = 9.0
FACTEUR_INTERLIGNE = 0.95

INTERLIGNE_TEXTE = round(TAILLE_TEXTE * FACTEUR_INTERLIGNE, 2)
INTERLIGNE_TITRE = round(TAILLE_TITRE * FACTEUR_INTERLIGNE, 2)

_NUMERO_DEJA_PRESENT = re.compile(r"^\s*(\d+)\s*([.\-–&]+)\s*")
_MARQUEUR_REF = re.compile(r"\b(R[ée]f\s*:)", re.IGNORECASE)
_MARQUEUR_R = re.compile(r"(^|\s)(R\s*:)")


def mettre_en_gras_numero(texte_brut: str, numero: int) -> str:
    """Met le numéro de couplet en gras (« 1. », « 1&2- » etc.), qu'il soit
    déjà présent dans le texte source ou ajouté par le moteur.

    Prend le texte BRUT (non échappé XML) : la détection du préfixe doit
    voir les vrais caractères (ex: un « & » réel dans « 1&2- »), pas leur
    forme échappée « &amp; » — sinon le « & » de l'entité est relu comme un
    séparateur de numéro et le « amp; » qui suit se retrouve affiché tel
    quel. `escape()` n'est donc appliqué qu'après la détection, séparément
    sur le préfixe et sur le reste."""
    m = _NUMERO_DEJA_PRESENT.match(texte_brut)
    if m:
        prefixe = escape(texte_brut[: m.end()].strip())
        reste = escape(texte_brut[m.end():])
        return f"<b>{prefixe}</b> {reste}"
    return f"<b>{numero}.</b> {escape(texte_brut)}"


def mettre_en_gras_refrain(texte_echappe: str) -> str:
    """Met en gras le préfixe « Réf : » et les rappels de refrain intégrés
    au milieu d'un couplet (ex : Kyrie alterné avec « R: »)."""
    if not _MARQUEUR_REF.search(texte_echappe) and not _MARQUEUR_R.search(texte_echappe):
        texte_echappe = f"<b>Réf :</b> {texte_echappe}"
    else:
        texte_echappe = _MARQUEUR_REF.sub(r"<b>\1</b>", texte_echappe)
        texte_echappe = _MARQUEUR_R.sub(r"\1<b>\2</b>", texte_echappe)
    return texte_echappe


def construire_styles() -> dict:
    return {
        "titre_section": ParagraphStyle(
            "TitreSection", parent=_styles["Normal"],
            fontName=POLICE_GRAS, fontSize=TAILLE_TITRE, leading=INTERLIGNE_TITRE,
            alignment=TA_LEFT, spaceAfter=2.5, spaceBefore=4,
        ),
        "titre_chant": ParagraphStyle(
            "TitreChant", parent=_styles["Normal"],
            fontName=POLICE_GRAS, fontSize=TAILLE_TEXTE, leading=INTERLIGNE_TEXTE,
            alignment=TA_LEFT, spaceAfter=1.5,
        ),
        "refrain": ParagraphStyle(
            "Refrain", parent=_styles["Normal"],
            fontName=POLICE, fontSize=TAILLE_TEXTE, leading=INTERLIGNE_TEXTE,
            alignment=TA_LEFT, spaceAfter=2.0,
        ),
        "couplet": ParagraphStyle(
            "Couplet", parent=_styles["Normal"],
            fontName=POLICE, fontSize=TAILLE_TEXTE, leading=INTERLIGNE_TEXTE,
            alignment=TA_LEFT, spaceAfter=2.0,
        ),
        "priere_corps": ParagraphStyle(
            "PriereCorps", parent=_styles["Normal"],
            fontName=POLICE, fontSize=TAILLE_TEXTE, leading=INTERLIGNE_TEXTE,
            alignment=TA_LEFT, spaceAfter=2.0,
        ),
    }
