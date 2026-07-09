import io
from pathlib import Path
from typing import Optional
from xml.sax.saxutils import escape

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    NextPageTemplate,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from .. import crud, schemas
from .labels import label_for

PAGE_SIZE = landscape(A4)
PAGE_W, PAGE_H = PAGE_SIZE
MARGE = 0.6 * cm
N_COLONNES = 4
ESPACE_COLONNES = 0.3 * cm
HAUTEUR_ENTETE = 4.6 * cm
HAUTEUR_LOGO = 2.6 * cm
PAGES_MAX = 2

# Échelles de police essayées dans l'ordre jusqu'à ce que le feuillet tienne sur
# PAGES_MAX pages. 1.0 = tailles normales ; en dessous de ~0.65 le texte devient
# difficilement lisible en colonnes de ~6.8cm, donc on s'arrête là au pire.
ECHELLES = [1.0, 0.9, 0.82, 0.74, 0.68, 0.62]

_styles = getSampleStyleSheet()


def _construire_styles(echelle: float) -> dict:
    def taille(pt: float) -> float:
        return round(pt * echelle, 1)

    return {
        "moment": ParagraphStyle(
            f"Moment{echelle}", parent=_styles["Normal"], fontSize=taille(10.5),
            fontName="Helvetica-Bold", spaceAfter=taille(3),
        ),
        "refrain": ParagraphStyle(
            f"Refrain{echelle}", parent=_styles["Normal"], fontSize=taille(9.5),
            fontName="Helvetica-Bold", spaceAfter=taille(3), leading=taille(12),
        ),
        "couplet": ParagraphStyle(
            f"Couplet{echelle}", parent=_styles["Normal"], fontSize=taille(9.5),
            spaceAfter=taille(3), leading=taille(12),
        ),
        "contact": ParagraphStyle(
            f"Contact{echelle}", parent=_styles["Normal"], fontSize=max(taille(9), 7),
            alignment=1, spaceBefore=taille(8),
        ),
        "espacement_bloc": max(taille(6), 3),
    }


MOMENT_BOX_STYLE = TableStyle([
    ("BOX", (0, 0), (-1, -1), 0.8, colors.black),
    ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ("TOPPADDING", (0, 0), (-1, -1), 4),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
])


def _colonnes_frames(y_bas: float, hauteur: float, id_prefix: str) -> list[Frame]:
    largeur_col = (PAGE_W - 2 * MARGE - (N_COLONNES - 1) * ESPACE_COLONNES) / N_COLONNES
    frames = []
    for i in range(N_COLONNES):
        x = MARGE + i * (largeur_col + ESPACE_COLONNES)
        frames.append(Frame(x, y_bas, largeur_col, hauteur, leftPadding=2, rightPadding=2,
                             topPadding=2, bottomPadding=2, id=f"{id_prefix}{i}", showBoundary=0))
    return frames


def _image_ajustee(chemin: Optional[Path], hauteur_max: float) -> Optional[Image]:
    if not chemin:
        return None
    try:
        with PILImage.open(chemin) as img:
            largeur_px, hauteur_px = img.size
        ratio = largeur_px / hauteur_px
        hauteur = hauteur_max
        largeur = hauteur * ratio
        image = Image(str(chemin), width=largeur, height=hauteur)
        return image
    except Exception:
        return None


def _dessiner_entete(canvas, doc, config: dict, images: dict, feuillet: schemas.Feuillet):
    """Bande d'en-tête de la page 1 : logo gauche, bloc identité (paroisse,
    chorale encadrée en rouge, date, lectures), logo droit — reproduisant la
    disposition des dépliants existants."""
    canvas.saveState()
    y_haut = PAGE_H - MARGE
    y_bas = y_haut - HAUTEUR_ENTETE

    logo_g = images.get("logo_gauche")
    logo_d = images.get("logo_droit")
    if logo_g:
        canvas.drawImage(
            str(logo_g), MARGE, y_bas + (HAUTEUR_ENTETE - HAUTEUR_LOGO) / 2,
            height=HAUTEUR_LOGO, width=HAUTEUR_LOGO, preserveAspectRatio=True, mask="auto",
        )
    if logo_d:
        canvas.drawImage(
            str(logo_d), PAGE_W - MARGE - HAUTEUR_LOGO, y_bas + (HAUTEUR_ENTETE - HAUTEUR_LOGO) / 2,
            height=HAUTEUR_LOGO, width=HAUTEUR_LOGO, preserveAspectRatio=True, mask="auto",
        )

    centre_x = PAGE_W / 2
    largeur_bloc = 10 * cm
    canvas.setFont("Helvetica-Bold", 14)
    canvas.setFillColor(colors.HexColor("#8a6d1a"))
    canvas.drawCentredString(centre_x, y_haut - 14, config.get("paroisse", ""))
    canvas.setFillColor(colors.black)

    cadre_y_haut = y_haut - 22
    cadre_y_bas = y_bas + 4
    cadre_x_gauche = centre_x - largeur_bloc / 2
    canvas.setStrokeColor(colors.HexColor("#b23b3b"))
    canvas.setLineWidth(1.2)
    canvas.rect(cadre_x_gauche, cadre_y_bas, largeur_bloc, cadre_y_haut - cadre_y_bas)

    texte_y = cadre_y_haut - 14
    canvas.setFont("Helvetica-BoldOblique", 12)
    canvas.setFillColor(colors.HexColor("#b23b3b"))
    canvas.drawCentredString(centre_x, texte_y, config.get("chorale", ""))
    canvas.setFillColor(colors.black)

    texte_y -= 16
    canvas.setFont("Helvetica-Bold", 10)
    sous_titre = feuillet.date if not feuillet.lieu else f"{feuillet.date} — {feuillet.lieu}"
    canvas.drawCentredString(centre_x, texte_y, sous_titre)

    lectures = feuillet.lectures
    lecture_lines = [
        ("1ère lecture", lectures.premiere_lecture),
        ("Psaume", lectures.psaume),
        ("2ème lecture", lectures.deuxieme_lecture),
        ("Évangile", lectures.evangile),
    ]
    canvas.setFont("Helvetica", 8.5)
    for label, ref in lecture_lines:
        if not ref:
            continue
        texte_y -= 11
        if texte_y < cadre_y_bas + 4:
            break
        canvas.drawCentredString(centre_x, texte_y, f"{label} : {ref}")

    canvas.restoreState()


def _resolve_moment(moment: schemas.MomentContenu) -> dict:
    chant = None
    if moment.type == "chant" and moment.chant_id is not None:
        chant = crud.get_chant(moment.chant_id)
    elif moment.type == "reference" and moment.code_reference:
        chant = crud.get_chant_by_reference(moment.code_reference)

    if chant:
        couplets = chant.couplets
        if moment.couplet_limit is not None:
            couplets = couplets[: moment.couplet_limit]
        return {"titre": chant.titre, "refrain": chant.refrain, "couplets": couplets}

    return {
        "titre": moment.titre_libre,
        "refrain": None,
        "couplets": [moment.texte_libre] if moment.texte_libre else [],
    }


def _bloc_moment(moment: schemas.MomentContenu, styles: dict) -> Table:
    """Une ligne de tableau par paragraphe (plutôt qu'une seule cellule) pour que
    Platypus puisse scinder le bloc entre colonnes/pages quand un chant est trop
    long pour tenir dans une seule colonne — un Table à cellule unique ne sait pas
    se scinder et provoque une LayoutError sur les chants avec beaucoup de couplets."""
    contenu = _resolve_moment(moment)
    label = f"<u>{escape(label_for(moment.moment))} :</u>"
    if contenu["titre"]:
        label += f" {escape(contenu['titre'])}"
    lignes = [[Paragraph(label, styles["moment"])]]
    if contenu.get("refrain"):
        lignes.append([Paragraph(f"Réf : {escape(contenu['refrain'])}", styles["refrain"])])
    for i, couplet in enumerate(contenu.get("couplets") or [], start=1):
        prefix = f"{i}. " if contenu.get("refrain") or len(contenu.get("couplets") or []) > 1 else ""
        lignes.append([Paragraph(f"{prefix}{escape(couplet)}", styles["couplet"])])

    table = Table(lignes, colWidths=[None], splitByRow=1)
    table.setStyle(MOMENT_BOX_STYLE)
    return table


def render_feuillet_pdf(
    feuillet: schemas.Feuillet, config: dict, images: Optional[dict] = None, echelle: float = 1.0
) -> tuple[bytes, int]:
    """Reproduit la mise en page réelle des dépliants : paysage, 4 colonnes
    continues façon journal, sections encadrées, en-tête avec logos sur la
    première page, bloc de contact en pied de dernière section.

    Retourne (pdf_bytes, nombre_de_pages) — le nombre de pages sert à
    render_feuillet_pdf_auto pour décider si l'échelle de police doit être réduite.
    """
    images = images or {}
    styles = _construire_styles(echelle)
    buffer = io.BytesIO()
    doc = BaseDocTemplate(buffer, pagesize=PAGE_SIZE)

    frames_page1 = _colonnes_frames(MARGE, PAGE_H - 2 * MARGE - HAUTEUR_ENTETE, "p1c")
    frames_suite = _colonnes_frames(MARGE, PAGE_H - 2 * MARGE, "pnc")

    def on_page1(canvas, doc_):
        _dessiner_entete(canvas, doc_, config, images, feuillet)

    doc.addPageTemplates([
        PageTemplate(id="Page1", frames=frames_page1, onPage=on_page1),
        PageTemplate(id="AutresPages", frames=frames_suite),
    ])

    story = [NextPageTemplate("AutresPages")]

    for moment in feuillet.moments:
        story.append(_bloc_moment(moment, styles))
        story.append(Spacer(1, styles["espacement_bloc"]))

    banniere = _image_ajustee(images.get("banniere_bas"), 2.2 * cm)
    if banniere:
        banniere.hAlign = "CENTER"
        story.append(banniere)

    if config.get("contact"):
        story.append(Paragraph(
            f"Pour de plus amples informations sur votre chorale, veuillez nous contacter au : "
            f"{escape(config['contact'])}",
            styles["contact"],
        ))

    doc.build(story)
    return buffer.getvalue(), doc.page


def render_feuillet_pdf_auto(feuillet: schemas.Feuillet, config: dict, images: Optional[dict] = None) -> bytes:
    """Essaie l'échelle de police normale, puis la réduit progressivement tant que
    le feuillet dépasse PAGES_MAX pages — garantit que le texte ne déborde jamais
    en sacrifiant la taille de police plutôt que le contenu, jusqu'à un plancher
    de lisibilité raisonnable."""
    dernier_resultat = None
    for echelle in ECHELLES:
        pdf_bytes, nb_pages = render_feuillet_pdf(feuillet, config, images, echelle=echelle)
        dernier_resultat = pdf_bytes
        if nb_pages <= PAGES_MAX:
            return pdf_bytes
    return dernier_resultat
