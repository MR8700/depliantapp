"""Typographie du corps des chants : jamais réduite en dessous du plancher,
jamais de cascade de rétrécissement pour faire tenir le texte. En revanche,
quand un feuillet est léger et laisse des zones à moitié vides, le moteur
peut agrandir uniformément la police (voir ECHELLES_CORPS / pdf.py) plutôt
que de livrer une page clairsemée — jamais l'inverse, et jamais en dessous
du plancher. Si même au plancher le contenu ne tient pas, le moteur le
signale (DepassementImpossible) plutôt que de trahir la maquette.

Les widgets (en-tête, bannière) restent à taille strictement fixe — voir
TAILLE_TEXTE/TAILLE_TITRE ci-dessous, utilisées telles quelles par
widgets.py — puisqu'ils sont indépendants du flux des chants et ne
participent jamais à cet agrandissement."""
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

# Tailles de corps essayées par le moteur, de la plus grande à la plus
# petite (le plancher TAILLE_TEXTE en dernier) : render_feuillet_pdf_auto
# retient la première qui remplit toutes les zones sans déborder. Le titre
# de chaque chant garde toujours +1pt sur le corps, comme au plancher.
ECHELLES_CORPS = [11.0, 10.5, 10.0, 9.5, 9.0, 8.5, TAILLE_TEXTE]

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


def construire_styles(taille_texte: float = TAILLE_TEXTE) -> dict:
    """Construit les styles du corps des chants à une taille donnée (l'une
    des valeurs de ECHELLES_CORPS). Le titre garde toujours +1pt sur le
    corps ; interligne et marges inter-paragraphes sont mis à l'échelle
    dans les mêmes proportions que TAILLE_TEXTE -> taille_texte, pour que
    l'agrandissement reste visuellement cohérent (pas juste du texte plus
    gros avec le même espacement serré)."""
    ratio = taille_texte / TAILLE_TEXTE
    taille_titre = round(TAILLE_TITRE * ratio, 2)
    interligne_texte = round(taille_texte * FACTEUR_INTERLIGNE, 2)
    interligne_titre = round(taille_titre * FACTEUR_INTERLIGNE, 2)

    def marge(base: float) -> float:
        return round(base * ratio, 2)

    return {
        "titre_section": ParagraphStyle(
            "TitreSection", parent=_styles["Normal"],
            fontName=POLICE_GRAS, fontSize=taille_titre, leading=interligne_titre,
            alignment=TA_LEFT, spaceAfter=marge(2.5), spaceBefore=marge(4),
        ),
        "titre_chant": ParagraphStyle(
            "TitreChant", parent=_styles["Normal"],
            fontName=POLICE_GRAS, fontSize=taille_texte, leading=interligne_texte,
            alignment=TA_LEFT, spaceAfter=marge(1.5),
        ),
        "refrain": ParagraphStyle(
            "Refrain", parent=_styles["Normal"],
            fontName=POLICE, fontSize=taille_texte, leading=interligne_texte,
            alignment=TA_LEFT, spaceAfter=marge(2.0),
        ),
        "couplet": ParagraphStyle(
            "Couplet", parent=_styles["Normal"],
            fontName=POLICE, fontSize=taille_texte, leading=interligne_texte,
            alignment=TA_LEFT, spaceAfter=marge(2.0),
        ),
        "priere_corps": ParagraphStyle(
            "PriereCorps", parent=_styles["Normal"],
            fontName=POLICE, fontSize=taille_texte, leading=interligne_texte,
            alignment=TA_LEFT, spaceAfter=marge(2.0),
        ),
    }
