"""Moteur de composition du feuillet : mesure réelle du contenu (measure.py),
répartition en colonnes sans jamais couper une section (layout.py), cascade
typographique police → interligne → espacement (typography.py) — plutôt qu'un
simple empilement de blocs comme avant. Voir le plan de refonte pour le détail
des mesures prises sur le dépliant de référence (A4 paysage, 4 colonnes/page,
corps 11pt). Génère n'importe quelle liste de moments (pas une mise en page
figée pour un feuillet précis)."""
import io
import math
from pathlib import Path
from typing import Optional
from xml.sax.saxutils import escape

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.platypus import BaseDocTemplate, Frame, FrameBreak, Image, NextPageTemplate, PageTemplate, Paragraph

from .. import schemas
from .layout import SectionTropHaute, assigner_colonnes
from .measure import construire_section_mesuree
from .model import Section, build_sections
from .typography import cascade_typographies, construire_styles

PAGE_SIZE = landscape(A4)
PAGE_W, PAGE_H = PAGE_SIZE

MARGE_EXTERIEURE = 10 * mm
MARGE_HAUTE = 9 * mm
MARGE_BASSE = 8 * mm
ENTRE_PANNEAUX = 6 * mm
N_COLONNES = 4
PAGES_MAX = 2

HAUTEUR_ENTETE = 46 * mm
HAUTEUR_LOGO = 26 * mm
HAUTEUR_BANNIERE = 20 * mm
HAUTEUR_PIED = HAUTEUR_BANNIERE + 16  # bannière + ligne de contact + marge, toujours réservé pour ne jamais chevaucher le texte

LARGEUR_COLONNE = (PAGE_W - 2 * MARGE_EXTERIEURE - (N_COLONNES - 1) * ENTRE_PANNEAUX) / N_COLONNES
Y_BAS_COLONNES = MARGE_BASSE + HAUTEUR_PIED
HAUTEUR_COLONNE_P1 = PAGE_H - MARGE_HAUTE - HAUTEUR_ENTETE - Y_BAS_COLONNES
HAUTEUR_COLONNE_SUITE = PAGE_H - MARGE_HAUTE - Y_BAS_COLONNES


class DepassementImpossible(Exception):
    """Levée quand le contenu ne tient toujours pas sur PAGES_MAX pages même à
    la typographie la plus resserrée autorisée — le moteur ne supprime jamais
    de contenu automatiquement, il signale plutôt quels moments réduire."""

    def __init__(self, message: str, moments_en_cause: list[str]):
        super().__init__(message)
        self.moments_en_cause = moments_en_cause


def _x_colonne(i: int) -> float:
    return MARGE_EXTERIEURE + i * (LARGEUR_COLONNE + ENTRE_PANNEAUX)


def _construire_frames(y_bas: float, hauteurs: list[float], prefix: str) -> list[Frame]:
    return [
        Frame(_x_colonne(i), y_bas, LARGEUR_COLONNE, hauteurs[i], leftPadding=2, rightPadding=2,
              topPadding=2, bottomPadding=2, id=f"{prefix}{i}", showBoundary=0)
        for i in range(N_COLONNES)
    ]


def _x_panneau(premiere_colonne: int) -> tuple[float, float]:
    """Bornes horizontales d'un panneau de 2 colonnes (0 = gauche, 2 = droite)."""
    x0 = _x_colonne(premiere_colonne)
    x1 = _x_colonne(premiere_colonne + 1) + LARGEUR_COLONNE
    return x0, x1


def _image_ajustee(chemin: Optional[Path], hauteur_max: float) -> Optional[Image]:
    if not chemin:
        return None
    try:
        with PILImage.open(chemin) as img:
            largeur_px, hauteur_px = img.size
        ratio = largeur_px / hauteur_px
        return Image(str(chemin), width=hauteur_max * ratio, height=hauteur_max)
    except Exception:
        return None


def _texte_ombre(canvas, x: float, y: float, texte: str, police: str, taille: float,
                  couleur=colors.HexColor("#4a4a4a"), ombre=colors.HexColor("#d8d8d8"),
                  decalage: float = 0.9) -> None:
    """Dessine un texte centré avec une légère ombre portée (effet WordArt),
    comme le bandeau paroisse du dépliant de référence."""
    canvas.setFont(police, taille)
    canvas.setFillColor(ombre)
    canvas.drawCentredString(x + decalage, y - decalage, texte)
    canvas.setFillColor(couleur)
    canvas.drawCentredString(x, y, texte)


def _dessiner_entete(canvas, config: dict, images: dict, feuillet: schemas.Feuillet):
    """L'en-tête n'occupe que le panneau de droite (colonnes 3-4), pas toute la
    largeur de la page — le panneau de gauche démarre tout en haut, sans
    en-tête au-dessus, comme sur le dépliant de référence."""
    canvas.saveState()
    x_gauche_panneau, x_droite_panneau = _x_panneau(2)
    y_haut = PAGE_H - MARGE_HAUTE
    y_bas = y_haut - HAUTEUR_ENTETE

    logo_g = images.get("logo_gauche")
    logo_d = images.get("logo_droit")
    if logo_g:
        canvas.drawImage(str(logo_g), x_gauche_panneau, y_bas + (HAUTEUR_ENTETE - HAUTEUR_LOGO) / 2,
                          height=HAUTEUR_LOGO, width=HAUTEUR_LOGO, preserveAspectRatio=True, mask="auto")
    if logo_d:
        canvas.drawImage(str(logo_d), x_droite_panneau - HAUTEUR_LOGO,
                          y_bas + (HAUTEUR_ENTETE - HAUTEUR_LOGO) / 2,
                          height=HAUTEUR_LOGO, width=HAUTEUR_LOGO, preserveAspectRatio=True, mask="auto")

    centre_x = (x_gauche_panneau + x_droite_panneau) / 2
    largeur_bloc = (x_droite_panneau - x_gauche_panneau) - 2 * HAUTEUR_LOGO - 8

    paroisse = config.get("paroisse", "")
    if paroisse:
        _texte_ombre(canvas, centre_x, y_haut - 14, paroisse, "Times-Bold", 14)
    canvas.setFillColor(colors.black)

    cadre_y_haut = y_haut - 22
    cadre_y_bas = y_bas + 4
    canvas.setStrokeColor(colors.HexColor("#b23b3b"))
    canvas.setLineWidth(1.2)
    canvas.rect(centre_x - largeur_bloc / 2, cadre_y_bas, largeur_bloc, cadre_y_haut - cadre_y_bas)

    def _souligner(texte: str, taille: float, y: float) -> None:
        largeur_texte = canvas.stringWidth(texte, canvas._fontname, taille)
        canvas.line(centre_x - largeur_texte / 2, y - 1.5, centre_x + largeur_texte / 2, y - 1.5)

    texte_y = cadre_y_haut - 14
    canvas.setFont("Times-Bold", 13)
    nom_chorale = config.get("chorale", "")
    canvas.drawCentredString(centre_x, texte_y, nom_chorale)
    _souligner(nom_chorale, 13, texte_y)

    texte_y -= 16
    canvas.setFont("Times-Bold", 11)
    sous_titre = feuillet.date if not feuillet.lieu else f"{feuillet.date} — {feuillet.lieu}"
    canvas.drawCentredString(centre_x, texte_y, sous_titre)
    _souligner(sous_titre, 11, texte_y)

    lectures = feuillet.lectures
    lecture_lines = [
        ("1ère lecture", lectures.premiere_lecture),
        ("Psaume", lectures.psaume),
        ("2ème lecture", lectures.deuxieme_lecture),
        ("Évangile", lectures.evangile),
    ]
    x_gauche = centre_x - largeur_bloc / 2 + 6
    canvas.setFont("Times-Bold", 9)
    for label, ref in lecture_lines:
        if not ref:
            continue
        texte_y -= 12
        if texte_y < cadre_y_bas + 4:
            break
        canvas.drawString(x_gauche, texte_y, f"{label} : {ref}")

    canvas.restoreState()


def _dessiner_encadres_panneaux(canvas, y_bas: float, hauteur_gauche: float, hauteur_droite: float) -> None:
    """Un seul encadré par panneau de 2 colonnes (gauche = colonnes 0+1, droite
    = colonnes 2+3), sur toute la hauteur disponible — comme sur le dépliant de
    référence, où l'encadré n'entoure pas chaque chant mais tout le panneau.
    Les deux panneaux peuvent avoir des hauteurs différentes (page 1 : le
    panneau droit est plus bas car l'en-tête occupe le dessus)."""
    canvas.saveState()
    canvas.setStrokeColor(colors.black)
    canvas.setLineWidth(1.0)
    for premiere_colonne, hauteur in ((0, hauteur_gauche), (2, hauteur_droite)):
        x0, x1 = _x_panneau(premiere_colonne)
        canvas.rect(x0, y_bas, x1 - x0, hauteur, fill=0, stroke=1)
    canvas.restoreState()


def _dessiner_pied(canvas, config: dict, images: dict):
    """Pied de page toujours collé en bas de la dernière page, même police,
    même alignement — dessiné directement (pas un flowable qui « atterrit » là
    où le flux s'arrête)."""
    canvas.saveState()
    y = MARGE_BASSE
    banniere = images.get("banniere_bas")
    if banniere:
        try:
            with PILImage.open(banniere) as img:
                largeur_px, hauteur_px = img.size
            largeur = HAUTEUR_BANNIERE * largeur_px / hauteur_px
            canvas.drawImage(str(banniere), (PAGE_W - largeur) / 2, y,
                              width=largeur, height=HAUTEUR_BANNIERE, preserveAspectRatio=True, mask="auto")
            y += HAUTEUR_BANNIERE + 3
        except Exception:
            pass
    if config.get("contact"):
        canvas.setFont("Times-Italic", 8.5)
        canvas.drawCentredString(
            PAGE_W / 2, y,
            f"Pour de plus amples informations sur votre chorale, veuillez nous contacter au : {config['contact']}",
        )
    canvas.restoreState()


def _tenter_typographie(sections: list[Section], typo) -> tuple[list[list], int, dict]:
    styles = construire_styles(typo)
    sections_mesurees = [
        (section, *construire_section_mesuree(section, styles, LARGEUR_COLONNE))
        for section in sections
    ]

    def hauteur_pour_colonne(i: int) -> float:
        # Page 1 : colonnes 0-1 (panneau gauche) pleine hauteur, colonnes 2-3
        # (panneau droit) réduites par l'en-tête. Pages suivantes : pleine hauteur.
        if i < 2:
            return HAUTEUR_COLONNE_SUITE
        if i < N_COLONNES:
            return HAUTEUR_COLONNE_P1
        return HAUTEUR_COLONNE_SUITE

    colonnes = assigner_colonnes(sections_mesurees, hauteur_pour_colonne)
    pages_necessaires = max(1, math.ceil(len(colonnes) / N_COLONNES))
    return colonnes, pages_necessaires, styles


def _rendre_pdf(feuillet: schemas.Feuillet, config: dict, images: dict, colonnes: list[list], pages_necessaires: int) -> bytes:
    buffer = io.BytesIO()
    doc = BaseDocTemplate(buffer, pagesize=PAGE_SIZE)

    def on_page1(canvas, doc_):
        _dessiner_entete(canvas, config, images, feuillet)
        _dessiner_encadres_panneaux(canvas, Y_BAS_COLONNES, HAUTEUR_COLONNE_SUITE, HAUTEUR_COLONNE_P1)
        if doc_.page == pages_necessaires:
            _dessiner_pied(canvas, config, images)

    def on_autre_page(canvas, doc_):
        _dessiner_encadres_panneaux(canvas, Y_BAS_COLONNES, HAUTEUR_COLONNE_SUITE, HAUTEUR_COLONNE_SUITE)
        if doc_.page == pages_necessaires:
            _dessiner_pied(canvas, config, images)

    hauteurs_page1 = [HAUTEUR_COLONNE_SUITE, HAUTEUR_COLONNE_SUITE, HAUTEUR_COLONNE_P1, HAUTEUR_COLONNE_P1]
    hauteurs_suite = [HAUTEUR_COLONNE_SUITE] * N_COLONNES
    doc.addPageTemplates([
        PageTemplate(id="Page1", frames=_construire_frames(Y_BAS_COLONNES, hauteurs_page1, "p1c"), onPage=on_page1),
        PageTemplate(id="AutresPages", frames=_construire_frames(Y_BAS_COLONNES, hauteurs_suite, "pnc"), onPage=on_autre_page),
    ])

    story = [NextPageTemplate("AutresPages")]
    for i, colonne in enumerate(colonnes):
        story.extend(colonne)
        if i < len(colonnes) - 1:
            story.append(FrameBreak())

    doc.build(story)
    return buffer.getvalue()


def render_feuillet_pdf_auto(feuillet: schemas.Feuillet, config: dict, images: Optional[dict] = None) -> bytes:
    """Essaie la cascade typographique (police puis interligne puis espacement,
    jamais l'inverse) et rend le PDF dès qu'une combinaison tient sur
    PAGES_MAX pages, sans jamais couper une section entre deux colonnes. Si
    rien ne convient même au plancher, lève DepassementImpossible plutôt que
    de renvoyer un PDF qui déborde silencieusement."""
    images = images or {}
    sections = build_sections(feuillet)

    derniere_exception: Optional[SectionTropHaute] = None
    for typo in cascade_typographies():
        try:
            colonnes, pages_necessaires, _ = _tenter_typographie(sections, typo)
        except SectionTropHaute as exc:
            derniere_exception = exc
            continue
        if pages_necessaires <= PAGES_MAX:
            return _rendre_pdf(feuillet, config, images, colonnes, pages_necessaires)

    if derniere_exception is not None:
        s = derniere_exception.section
        raise DepassementImpossible(
            f"Le chant « {s.song.titre or s.label} » ({s.label}) est trop long pour tenir "
            "dans une colonne même à la police minimale (8pt).",
            moments_en_cause=[s.moment],
        )
    raise DepassementImpossible(
        f"Le contenu du feuillet est trop volumineux pour tenir sur {PAGES_MAX} pages, "
        "même à la police minimale. Réduis le nombre de couplets d'un ou plusieurs chants.",
        moments_en_cause=[s.moment for s in sections],
    )
