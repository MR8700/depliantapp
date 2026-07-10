"""Moteur de composition de dépliant A4 Portrait en 2 pages.

Utilise ReportLab Platypus avec une approche modulaire et orientée objet.
Gère le redimensionnement et le découpage automatique en colonnes.
"""

import io
import math
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate,
    Table,
    TableStyle,
    Paragraph,
    Spacer,
    KeepTogether,
    PageBreak,
    Flowable,
    Image as RLImage
)
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from PIL import Image as PILImage

from .. import schemas


class DepassementImpossible(Exception):
    """Exception levée lorsque le contenu ne peut pas tenir sur 2 pages."""
    def __init__(self, message: str, moments_en_cause: List[str]):
        super().__init__(message)
        self.moments_en_cause = moments_en_cause


class FontManager:
    """Gère l'enregistrement et la configuration des polices de caractères."""
    
    @staticmethod
    def get_font_name(bold: bool = False, italic: bool = False) -> str:
        """Retourne le nom de la police standard Times correspondante."""
        if bold and italic:
            return "Times-BoldItalic"
        elif bold:
            return "Times-Bold"
        elif italic:
            return "Times-Italic"
        else:
            return "Times-Roman"


class StyleManager:
    """Gère la cascade typographique et l'adaptation des tailles de texte."""

    def __init__(self, scale: float = 1.0):
        self.scale = scale
        self._styles = getSampleStyleSheet()
        self.leading_factor = 1.05

    def boldify_references(self, text: str) -> str:
        """Mets en gras les occurrences de Réf:, R:, 1-, 1. dans le texte."""
        # Mettre en gras Réf : ou Réf:
        text = re.sub(r"\b(Réf\s*:)", r"<b>\1</b>", text)
        # Mettre en gras R : ou R: lorsqu'il est en début de ligne ou précédé d'un espace
        text = re.sub(r"(^|\s)(R\s*:)", r"\1<b>\2</b>", text)
        # Mettre en gras les numéros de couplets (ex: 1-, 2-, 1., 2.)
        text = re.sub(r"(^|\s)(\d+[-.])(?=\s|$)", r"\1<b>\2</b>", text)
        return text

    def get_style(self, name: str) -> ParagraphStyle:
        """Génère un ParagraphStyle adapté à l'échelle courante."""
        font_main = FontManager.get_font_name(bold=False, italic=False)
        font_bold = FontManager.get_font_name(bold=True, italic=False)
        font_bold_italic = FontManager.get_font_name(bold=True, italic=True)

        if name == "titre_principal":
            size = 11.0 * self.scale
            return ParagraphStyle(
                "TitrePrincipal",
                parent=self._styles["Normal"],
                fontName=font_bold,
                fontSize=size,
                leading=size * self.leading_factor,
                alignment=TA_LEFT,
                spaceAfter=1.5 * self.scale,
            )
        elif name == "titre_secondaire":
            size = 10.0 * self.scale
            return ParagraphStyle(
                "TitreSecondaire",
                parent=self._styles["Normal"],
                fontName=font_bold,
                fontSize=size,
                leading=size * self.leading_factor,
                alignment=TA_LEFT,
                spaceAfter=1.5 * self.scale,
            )
        elif name == "texte":
            size = 9.0 * self.scale
            return ParagraphStyle(
                "Texte",
                parent=self._styles["Normal"],
                fontName=font_main,
                fontSize=size,
                leading=size * self.leading_factor,
                alignment=TA_JUSTIFY,
                spaceAfter=1.2 * self.scale,
            )
        elif name == "texte_centre":
            size = 9.0 * self.scale
            return ParagraphStyle(
                "TexteCentre",
                parent=self._styles["Normal"],
                fontName=font_main,
                fontSize=size,
                leading=size * self.leading_factor,
                alignment=TA_CENTER,
                spaceAfter=1.2 * self.scale,
            )
        elif name == "refrain":
            size = 9.0 * self.scale
            return ParagraphStyle(
                "Refrain",
                parent=self._styles["Normal"],
                fontName=font_bold_italic,
                fontSize=size,
                leading=size * self.leading_factor,
                alignment=TA_JUSTIFY,
                spaceAfter=1.2 * self.scale,
            )
        elif name == "reference":
            size = 8.0 * self.scale
            return ParagraphStyle(
                "Reference",
                parent=self._styles["Normal"],
                fontName=font_main,
                fontSize=size,
                leading=size * self.leading_factor,
                alignment=TA_LEFT,
                spaceAfter=1.0 * self.scale,
            )
        else:
            return self._styles["Normal"]


class ImageManager:
    """Gère l'importation et le redimensionnement automatique des images."""

    @staticmethod
    def draw_logo(path: Optional[Path], width: float, height: float) -> Optional[RLImage]:
        """Importe un logo en conservant ses proportions."""
        if not path or not path.exists():
            return None
        try:
            with PILImage.open(path) as img:
                orig_w, orig_h = img.size
            ratio = orig_w / orig_h
            # Ajustement pour respecter le cadre maximal
            if ratio > 1.0:
                # Plus large que haut
                dest_w = width
                dest_h = width / ratio
            else:
                dest_h = height
                dest_w = height * ratio
            return RLImage(str(path), width=dest_w, height=dest_h)
        except Exception:
            return None


class Section:
    """Classe de base représentant un bloc rectangulaire de la page."""

    def __init__(self, moment: str, label: str):
        self.moment = moment
        self.label = label
        self.flowables: List[Flowable] = []

    def draw_section(self, width: float, style_manager: StyleManager) -> Table:
        """Wrappe le contenu dans un tableau avec bordure noire et padding interne de 3 mm."""
        # 3 mm = 8.5 pt environ
        padding = 3.0 * mm
        t = Table([[self.flowables]], colWidths=[width])
        t.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 0.5, colors.black),
            ('TOPPADDING', (0, 0), (-1, -1), padding),
            ('BOTTOMPADDING', (0, 0), (-1, -1), padding),
            ('LEFTPADDING', (0, 0), (-1, -1), padding),
            ('RIGHTPADDING', (0, 0), (-1, -1), padding),
        ]))
        return t


class SongSection(Section):
    """Section dédiée aux chants liturgiques."""

    def draw_song(self, title: Optional[str], refrain: Optional[str], couplets: List[str], style_manager: StyleManager):
        """Remplit la section avec le formatage requis pour les chants."""
        # Titre en gras, majuscules et souligné
        titre_style = style_manager.get_style("titre_principal")
        if title:
            self.flowables.append(Paragraph(f"<b><u>{title.upper()}</u></b>", titre_style))

        # Refrain
        if refrain:
            refrain_styled = style_manager.boldify_references(refrain)
            refrain_style = style_manager.get_style("refrain")
            self.flowables.append(Paragraph(refrain_styled, refrain_style))

        # Couplets
        couplet_style = style_manager.get_style("texte")
        for couplet in couplets:
            couplet_styled = style_manager.boldify_references(couplet)
            # Remplacement des retours à la ligne par <br/>
            couplet_html = couplet_styled.replace("\n", "<br/>")
            self.flowables.append(Paragraph(couplet_html, couplet_style))


class PrayerSection(Section):
    """Section dédiée aux prières (Burkina, Notre Père, Credo)."""

    def draw_prayer(self, title: str, content: str, style_manager: StyleManager):
        """Remplit la section avec le formatage des prières (centré)."""
        titre_style = style_manager.get_style("titre_principal")
        self.flowables.append(Paragraph(f"<b><u>{title.upper()}</u></b>", titre_style))

        texte_style = style_manager.get_style("texte_centre")
        for para in content.split("\n\n"):
            if not para.strip():
                continue
            para_html = para.replace("\n", "<br/>")
            self.flowables.append(Paragraph(para_html, texte_style))


class ReadingSection(Section):
    """Section pour les lectures de la messe."""

    def draw_readings(self, readings: dict, style_manager: StyleManager):
        """Remplit la section avec les textes des lectures."""
        titre_style = style_manager.get_style("titre_principal")
        self.flowables.append(Paragraph("<b><u>LECTURES</u></b>", titre_style))

        texte_style = style_manager.get_style("texte")
        for label, ref in readings.items():
            if not ref:
                continue
            self.flowables.append(Paragraph(f"<b>{label} :</b> {ref}", texte_style))


class CommunionSection(Section):
    """Section pour le moment de la communion."""

    def draw_communion(self, title: str, content: str, style_manager: StyleManager):
        """Remplit la section communion."""
        titre_style = style_manager.get_style("titre_principal")
        self.flowables.append(Paragraph(f"<b><u>{title.upper()}</u></b>", titre_style))

        texte_style = style_manager.get_style("texte")
        for para in content.split("\n\n"):
            if not para.strip():
                continue
            para_html = para.replace("\n", "<br/>")
            self.flowables.append(Paragraph(para_html, texte_style))


class TableSection(Section):
    """Section générique contenant un tableau."""
    pass


class ShadowText(Flowable):
    """Flowable personnalisé pour dessiner le texte avec une ombre portée légère."""

    def __init__(self, text: str, font_name: str, font_size: float, color: colors.Color, shadow_color: colors.Color):
        super().__init__()
        self.text = text
        self.font_name = font_name
        self.font_size = font_size
        self.color = color
        self.shadow_color = shadow_color

    def wrap(self, availWidth, availHeight):
        return availWidth, self.font_size * 1.3

    def draw(self):
        self.canv.saveState()
        self.canv.setFont(self.font_name, self.font_size)
        width = self.canv.stringWidth(self.text, self.font_name, self.font_size)
        x = (self.width - width) / 2
        y = 0.2 * self.font_size
        # Ombre
        self.canv.setFillColor(self.shadow_color)
        self.canv.drawString(x + 1.2, y - 1.2, self.text)
        # Texte principal
        self.canv.setFillColor(self.color)
        self.canv.drawString(x, y, self.text)
        self.canv.restoreState()


class HeaderBuilder:
    """Gère la construction graphique de l'en-tête de la paroisse (haut droit page 1)."""

    def __init__(self, config: dict, lectures: dict, images: dict):
        self.config = config
        self.lectures = lectures
        self.images = images

    def draw_header(self, width: float, style_manager: StyleManager) -> Table:
        """Dessine le bloc d'en-tête de la paroisse avec logos et lectures."""
        flowables: List[Flowable] = []

        # Paroisse
        paroisse_style = ParagraphStyle(
            "ParoisseHeader",
            parent=style_manager.get_style("reference"),
            fontName=FontManager.get_font_name(bold=True),
            fontSize=7.0 * style_manager.scale,
            leading=7.5 * style_manager.scale,
            alignment=TA_CENTER,
            spaceAfter=3,
        )
        paroisse_txt = self.config.get("paroisse", "")
        flowables.append(Paragraph(paroisse_txt, paroisse_style))

        # Logos et Titre Chorale Sainte Cécile
        logo_g_path = self.images.get("logo_gauche")
        logo_d_path = self.images.get("logo_droit")
        
        logo_w = 12 * mm
        logo_h = 12 * mm
        logo_g = ImageManager.draw_logo(logo_g_path, logo_w, logo_h)
        logo_d = ImageManager.draw_logo(logo_d_path, logo_w, logo_h)

        # Boite Chorale Sainte Cécile
        chorale_style = ParagraphStyle(
            "ChoraleHeader",
            parent=style_manager.get_style("titre_principal"),
            fontSize=9.0 * style_manager.scale,
            leading=10.0 * style_manager.scale,
            alignment=TA_CENTER,
        )
        chorale_p = Paragraph(f"<b><u>{self.config.get('chorale', '').upper()}</u></b>", chorale_style)
        
        # Grid logos
        grid_data = [[logo_g or "", chorale_p, logo_d or ""]]
        # La largeur nette intérieure est de width - 6mm padding.
        net_width = width - 6 * mm
        col_w = [logo_w, net_width - 2 * logo_w, logo_w]
        
        grid_table = Table(grid_data, colWidths=col_w)
        grid_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('BOX', (1, 0), (1, 0), 0.5, colors.HexColor("#b23b3b")), # Bordure rouge autour de la Chorale
            ('TOPPADDING', (0, 0), (-1, -1), 1),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 1),
            ('LEFTPADDING', (0, 0), (-1, -1), 2),
            ('RIGHTPADDING', (0, 0), (-1, -1), 2),
        ]))
        flowables.append(grid_table)
        flowables.append(Spacer(1, 4))

        # Date
        date_style = ParagraphStyle(
            "DateHeader",
            parent=style_manager.get_style("reference"),
            fontName=FontManager.get_font_name(bold=True),
            fontSize=8.5 * style_manager.scale,
            leading=9.0 * style_manager.scale,
            alignment=TA_CENTER,
            spaceAfter=4,
        )
        date_txt = self.config.get("date", "")
        flowables.append(Paragraph(date_txt, date_style))

        # Lectures
        lectures_style = ParagraphStyle(
            "LecturesHeader",
            parent=style_manager.get_style("reference"),
            fontSize=7.5 * style_manager.scale,
            leading=8.0 * style_manager.scale,
            alignment=TA_LEFT,
        )
        lectures_items = [
            ("1er lecture", self.lectures.get("lecture1")),
            ("Graduel", self.lectures.get("psaume")),
            ("2ème lecture", self.lectures.get("lecture2")),
            ("Evangile", self.lectures.get("evangile")),
        ]
        for label, val in lectures_items:
            if val:
                flowables.append(Paragraph(f"<b>{label} :</b> {val}", lectures_style))

        # Box
        section = Section("header", "PAROISSE")
        section.flowables = flowables
        return section.draw_section(width, style_manager)


class FooterBuilder:
    """Gère la construction graphique du bas de la page 1."""

    def __init__(self, config: dict, images: dict):
        self.config = config
        self.images = images

    def draw_footer(self, width: float, style_manager: StyleManager) -> Table:
        """Dessine la bande horizontale du bas avec contact, message et décors."""
        flowables: List[Flowable] = []

        # 1. Message Bon Dimanche
        msg_size = 14.0 * style_manager.scale
        msg_font = FontManager.get_font_name(bold=True)
        shadow_txt = ShadowText(
            "Bon Dimanche à toutes et à tous !!",
            font_name=msg_font,
            font_size=msg_size,
            color=colors.HexColor("#4a4a4a"), # Gris foncé
            shadow_color=colors.HexColor("#d0d0d0"), # Gris clair
        )
        flowables.append(shadow_txt)
        flowables.append(Spacer(1, 4))

        # 2. Images décorations : Raisin, Colombe, Raisin
        decor_r_path = self.images.get("decor_raisin")
        decor_c_path = self.images.get("decor_colombe")

        dec_w = 12 * mm
        dec_h = 10 * mm
        dec_r1 = ImageManager.draw_logo(decor_r_path, dec_w, dec_h)
        dec_c = ImageManager.draw_logo(decor_c_path, dec_w, dec_h)
        dec_r2 = ImageManager.draw_logo(decor_r_path, dec_w, dec_h)

        net_width = width - 6 * mm
        decor_data = [[dec_r1 or "", dec_c or "", dec_r2 or ""]]
        decor_table = Table(decor_data, colWidths=[net_width/3.0]*3)
        decor_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))
        flowables.append(decor_table)
        flowables.append(Spacer(1, 4))

        # 3. Contact Chorale
        contact_style = ParagraphStyle(
            "ContactFooter",
            parent=style_manager.get_style("reference"),
            fontSize=7.5 * style_manager.scale,
            leading=8.0 * style_manager.scale,
            alignment=TA_CENTER,
        )
        contact_txt = (
            "Pour de plus amples informations sur votre Chorale, Veuillez nous contacter au :\n"
            f"{self.config.get('contact', '')}"
        )
        flowables.append(Paragraph(contact_txt.replace("\n", "<br/>"), contact_style))

        section = Section("footer", "FOOTER")
        section.flowables = flowables
        return section.draw_section(width, style_manager)


class ColumnLayout:
    """Gère la répartition physique du contenu en colonnes et les découpes."""

    @staticmethod
    def calculate_heights(flowables: List[Flowable], width: float) -> float:
        """Calcule la hauteur totale cumulée d'une liste de flowables."""
        total = 0.0
        for f in flowables:
            _, h = f.wrap(width, 100000)
            total += h
        return total

    @staticmethod
    def split_song(
        song_section: SongSection,
        available_height: float,
        width: float,
        style_manager: StyleManager
    ) -> Tuple[Optional[List[Flowable]], Optional[List[Flowable]]]:
        """Découpe un chant liturgique pour qu'il tienne dans la hauteur disponible.
        
        Retourne (partie1, partie2) sous forme de listes de flowables.
        """
        # Construction de tous les flowables individuels du chant
        # Titre
        title_flow = []
        titre_style = style_manager.get_style("titre_principal")
        if song_section.moment != "gloria" or song_section.label:
            title_flow.append(Paragraph(f"<b><u>{song_section.label}</u></b>", titre_style))
        if song_section.song.titre:
            title_flow.append(Paragraph(f"<b><u>{song_section.song.titre.upper()}</u></b>", titre_style))

        # Refrain
        refrain_flow = []
        if song_section.song.refrain:
            refrain_styled = style_manager.boldify_references(song_section.song.refrain)
            refrain_flow.append(Paragraph(refrain_styled, style_manager.get_style("refrain")))

        # Couplets
        couplets_flow = []
        couplet_style = style_manager.get_style("texte")
        for couplet in song_section.song.couplets:
            couplet_styled = style_manager.boldify_references(couplet)
            couplet_html = couplet_styled.replace("\n", "<br/>")
            couplets_flow.append(Paragraph(couplet_html, couplet_style))

        # Mesure de base
        # Le padding interne du bloc rectangulaire est de 3mm en haut et 3mm en bas (soit 6mm = 17pt)
        padding_h = 6.0 * mm
        base_h = ColumnLayout.calculate_heights(title_flow + refrain_flow, width) + padding_h

        if base_h > available_height:
            # Même le titre + refrain ne rentrent pas
            return None, None

        # Recherche du point de découpe des couplets
        current_h = base_h
        split_idx = 0
        for idx, f in enumerate(couplets_flow):
            _, fh = f.wrap(width, 100000)
            if current_h + fh > available_height:
                break
            current_h += fh
            split_idx = idx + 1

        if couplets_flow and split_idx == 0:
            # Aucun couplet ne peut être ajouté
            return None, None

        part1 = title_flow + refrain_flow + couplets_flow[:split_idx]
        part2 = couplets_flow[split_idx:]
        return part1, part2


class PdfBuilder:
    """Orchestrateur de la construction du document PDF final."""

    def __init__(self, feuillet: schemas.Feuillet, config: dict, images: Optional[dict] = None):
        self.feuillet = feuillet
        self.config = config
        self.images = images or {}
        
        # Marges de la page
        self.margin = 5 * mm
        self.page_w, self.page_h = A4
        self.printable_w = self.page_w - 2 * self.margin
        self.printable_h = self.page_h - 2 * self.margin

        # Préparation des données du feuillet
        self.lectures = {
            "lecture1": feuillet.lectures.premiere_lecture,
            "psaume": feuillet.lectures.psaume,
            "lecture2": feuillet.lectures.deuxieme_lecture,
            "evangile": feuillet.lectures.evangile,
        }

        # Dictionnaire indexé pour les chants du feuillet
        self.moments_chants = {}
        for m in feuillet.moments:
            # Résolution du chant
            from .model import _resolve_song
            song = _resolve_song(m)
            self.moments_chants[m.moment.lower()] = {
                "titre": song.titre,
                "refrain": song.refrain,
                "couplets": song.couplets,
                "label": m.titre_libre or m.moment.replace("_", " ").upper(),
            }

    def _build_song_section(self, moment_key: str, label_fallback: str) -> SongSection:
        info = self.moments_chants.get(moment_key, {
            "titre": "",
            "refrain": "",
            "couplets": [],
            "label": label_fallback,
        })
        sec = SongSection(moment_key, info["label"])
        sec.song = schemas.Chant(
            id=0,
            titre=info["titre"] or "",
            refrain=info["refrain"],
            couplets=info["couplets"],
        )
        return sec

    def _tenter_mise_en_page(self, scale: float) -> Tuple[List[Flowable], bool]:
        """Tente de générer le document à une échelle typographique donnée."""
        style_manager = StyleManager(scale=scale)
        story: List[Flowable] = []

        # --- PAGE 1 ---
        # 1. Haut : 3 colonnes. Proportions: 30%, 35%, 35% de la largeur nette imprimable (sans les gaps)
        gap_w = 4.0 * mm
        net_w = self.printable_w - 2 * gap_w
        w_col1 = net_w * 0.30
        w_col2 = net_w * 0.35
        w_col3 = net_w * 0.35

        # Colonne gauche : SORTIE
        sortie_sec = self._build_song_section("sortie", "SORTIE")
        sortie_sec.draw_song(sortie_sec.song.titre, sortie_sec.song.refrain, sortie_sec.song.couplets, style_manager)
        sortie_table = sortie_sec.draw_section(w_col1, style_manager)

        # Colonne centrale : PRIERE POUR LE BURKINA FASO
        priere_sec = PrayerSection("priere", "PRIERE POUR LE BURKINA FASO")
        # Récupération du texte de prière depuis config ou moments
        priere_txt = self.config.get("priere", "")
        if not priere_txt and "priere" in self.moments_chants:
            couplets = self.moments_chants["priere"]["couplets"]
            priere_txt = "\n\n".join(couplets)
        if not priere_txt:
            # Texte par défaut
            priere_txt = (
                "Dieu notre père ce qu'il y a de meilleur dans ta création c'est l'homme. "
                "Tu l'as créé à ton image, afin qu'après le temps de sa vie Terrestre, il jouisse "
                "d'un bonheur éternel auprès de toi. Pour que notre pays soit le milieu de vie où nous "
                "obtenions cet unique nécessaire qu'est la vie éternelle nous t'adressons cette prière: "
                "Accorde à notre pays, le BURKINA FASO, des institutions qui lui garantissent le bien être, "
                "la liberté et la paix: Accorde lui avant tout des autorités religieuses et civiles qui se "
                "laissent guider par l'Esprit Saint, afin qu'elles exercent leurs charges, selon la justice "
                "et dans le seul soucis du bien de tous. Nous te le demandons par ton fils Jésus Christ notre "
                "Seigneur. Amen !"
            )
        priere_sec.draw_prayer("Prière pour le Burkina Faso", priere_txt, style_manager)
        priere_table = priere_sec.draw_section(w_col2, style_manager)

        # Colonne droite : En-tête Paroisse
        header_builder = HeaderBuilder(self.config, self.lectures, self.images)
        header_table = header_builder.draw_header(w_col3, style_manager)

        # Calcul hauteur de la Row 1
        _, h_c1 = sortie_table.wrap(w_col1, 100000)
        _, h_c2 = priere_table.wrap(w_col2, 100000)
        _, h_c3 = header_table.wrap(w_col3, 100000)
        h_row1 = max(h_c1, h_c2, h_c3)

        # Row 1 Table
        row1_data = [[sortie_table, "", priere_table, "", header_table]]
        row1_table = Table(row1_data, colWidths=[w_col1, gap_w, w_col2, gap_w, w_col3])
        row1_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))

        # 2. Bas de page 1 : Bande horizontale
        footer_builder = FooterBuilder(self.config, self.images)
        footer_table = footer_builder.draw_footer(self.printable_w, style_manager)
        _, h_row3 = footer_table.wrap(self.printable_w, 100000)

        # Espacements verticaux
        v_gap = 4.0 * mm
        # Calcul de la hauteur disponible pour la Row 2 (les 2 grandes colonnes du milieu)
        h_row2_avail = self.printable_h - h_row1 - h_row3 - 2 * v_gap
        if h_row2_avail <= 20.0 * mm:
            return [], False # Pas assez de place

        # 3. Milieu de page 1 : 2 grandes colonnes (largeur 50% chacune, séparées par une ligne)
        w_col_m = self.printable_w / 2.0
        
        # Préparation du contenu de la colonne gauche de Row 2: ENTREE, KYRIE
        entree_sec = self._build_song_section("entree", "ENTRÉE")
        entree_sec.draw_song(entree_sec.song.titre, entree_sec.song.refrain, entree_sec.song.couplets, style_manager)
        
        kyrie_sec = self._build_song_section("kyrie", "KYRIE")
        kyrie_sec.draw_song(kyrie_sec.song.titre, kyrie_sec.song.refrain, kyrie_sec.song.couplets, style_manager)
        
        # Préparation du contenu de la colonne droite de Row 2: GRADUEL
        graduel_sec = self._build_song_section("graduel", "GRADUEL")
        graduel_sec.draw_song(graduel_sec.song.titre, graduel_sec.song.refrain, graduel_sec.song.couplets, style_manager)

        # Gloria est l'élément splittable
        gloria_sec = self._build_song_section("gloria", "GLORIA")

        # Calcul hauteur cumulée hors Gloria
        h_entree = ColumnLayout.calculate_heights(entree_sec.flowables, w_col_m - 6*mm) + 6*mm
        h_kyrie = ColumnLayout.calculate_heights(kyrie_sec.flowables, w_col_m - 6*mm) + 6*mm
        h_graduel = ColumnLayout.calculate_heights(graduel_sec.flowables, w_col_m - 6*mm) + 6*mm

        h_left_occupied = h_entree + h_kyrie + 4 # Spacing
        h_right_occupied = h_graduel

        h_gloria_avail_left = h_row2_avail - h_left_occupied - 6*mm # padding table
        if h_gloria_avail_left < 15.0 * mm:
            return [], False

        # Découpage du Gloria
        gloria_p1, gloria_p2 = ColumnLayout.split_song(gloria_sec, h_gloria_avail_left, w_col_m - 6*mm, style_manager)
        if gloria_p1 is None:
            return [], False # Gloria ne rentre pas du tout à gauche

        # Vérification si le reste du Gloria + Graduel rentre à droite
        h_gloria_p2 = ColumnLayout.calculate_heights(gloria_p2, w_col_m - 6*mm)
        if h_gloria_p2 + h_right_occupied > h_row2_avail - 6*mm:
            return [], False # Débordement à droite

        # Assemblage des colonnes du milieu
        flow_left = entree_sec.flowables + [Spacer(1, 4)] + kyrie_sec.flowables + [Spacer(1, 4)] + gloria_p1
        flow_right = gloria_p2 + [Spacer(1, 4)] + graduel_sec.flowables

        # On crée le tableau double colonne du milieu
        row2_table = Table([[flow_left, flow_right]], colWidths=[w_col_m, w_col_m])
        # Box extérieur + ligne de séparation centrale
        row2_table.setStyle(TableStyle([
            ('BOX', (0, 0), (-1, -1), 0.5, colors.black),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.black),
            ('TOPPADDING', (0, 0), (-1, -1), 3*mm),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3*mm),
            ('LEFTPADDING', (0, 0), (-1, -1), 3*mm),
            ('RIGHTPADDING', (0, 0), (-1, -1), 3*mm),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))

        # Construction du story de la Page 1
        story.append(row1_table)
        story.append(Spacer(1, v_gap))
        story.append(row2_table)
        story.append(Spacer(1, v_gap))
        story.append(footer_table)
        story.append(PageBreak())

        # --- PAGE 2 ---
        # 3 colonnes égales de largeur 64mm, gaps de 4mm. Hauteur max = printable_h
        w_p2_col = 64.0 * mm
        h_p2_avail = self.printable_h - 6*mm # moins le padding du tableau

        # Liste ordonnée de tous les moments sur la Page 2
        # Col 1: Psaume, Acclamation, Credo, PU, Offertoire (start)
        # Col 2: Offertoire (suite), Sanctus, Pater, Agnus, Communion (start)
        # Col 3: Communion (suite), Action de Grâce

        psaume_sec = self._build_song_section("psaume", "PSAUME")
        psaume_sec.draw_song(psaume_sec.song.titre, psaume_sec.song.refrain, psaume_sec.song.couplets, style_manager)

        acclamation_sec = self._build_song_section("acclamation", "ACCLAMATION")
        acclamation_sec.draw_song(acclamation_sec.song.titre, acclamation_sec.song.refrain, acclamation_sec.song.couplets, style_manager)

        credo_sec = PrayerSection("credo", "CREDO")
        credo_txt = self.config.get("credo", "Récité")
        if "credo" in self.moments_chants:
            credo_txt = "\n\n".join(self.moments_chants["credo"]["couplets"]) or credo_txt
        credo_sec.draw_prayer("Credo", credo_txt, style_manager)

        pu_sec = PrayerSection("pu", "PRIERE UNIVERSELLE")
        pu_txt = self.config.get("pu", "Intentions libres")
        if "pu" in self.moments_chants:
            pu_txt = "\n\n".join(self.moments_chants["pu"]["couplets"]) or pu_txt
        pu_sec.draw_prayer("Prière Universelle", pu_txt, style_manager)

        offertoire_sec = self._build_song_section("offertoire", "OFFERTOIRE")

        sanctus_sec = self._build_song_section("sanctus", "SANCTUS")
        sanctus_sec.draw_song(sanctus_sec.song.titre, sanctus_sec.song.refrain, sanctus_sec.song.couplets, style_manager)

        pater_sec = PrayerSection("pater", "PATER")
        pater_txt = self.config.get("pater", "Récité")
        if "pater" in self.moments_chants:
            pater_txt = "\n\n".join(self.moments_chants["pater"]["couplets"]) or pater_txt
        pater_sec.draw_prayer("Pater", pater_txt, style_manager)

        agnus_sec = self._build_song_section("agnus", "AGNUS")
        agnus_sec.draw_song(agnus_sec.song.titre, agnus_sec.song.refrain, agnus_sec.song.couplets, style_manager)

        communion_sec = self._build_song_section("communion", "COMMUNION")

        action_grace_sec = self._build_song_section("action_grace", "ACTION DE GRÂCE")
        action_grace_sec.draw_song(action_grace_sec.song.titre, action_grace_sec.song.refrain, action_grace_sec.song.couplets, style_manager)

        # Calcul des hauteurs fixes de Col 1, Col 2, Col 3 (sans les chants découpés)
        h_col1_fixed = ColumnLayout.calculate_heights(
            psaume_sec.flowables + acclamation_sec.flowables + credo_sec.flowables + pu_sec.flowables,
            w_p2_col - 6*mm
        )
        h_col2_fixed = ColumnLayout.calculate_heights(
            sanctus_sec.flowables + pater_sec.flowables + agnus_sec.flowables,
            w_p2_col - 6*mm
        )
        h_col3_fixed = ColumnLayout.calculate_heights(
            action_grace_sec.flowables,
            w_p2_col - 6*mm
        )

        # Recherche de points de découpe pour Offertoire et Communion
        # Offertoire se découpe entre Col 1 et Col 2
        avail_off_col1 = h_p2_avail - h_col1_fixed - 16 # spacing
        if avail_off_col1 < 10.0 * mm:
            return [], False
        
        off_p1, off_p2 = ColumnLayout.split_song(offertoire_sec, avail_off_col1, w_p2_col - 6*mm, style_manager)
        if off_p1 is None:
            return [], False

        h_off_p2 = ColumnLayout.calculate_heights(off_p2, w_p2_col - 6*mm)
        # Communion se découpe entre Col 2 et Col 3
        avail_com_col2 = h_p2_avail - h_col2_fixed - h_off_p2 - 24 # spacing
        if avail_com_col2 < 10.0 * mm:
            return [], False

        com_p1, com_p2 = ColumnLayout.split_song(communion_sec, avail_com_col2, w_p2_col - 6*mm, style_manager)
        if com_p1 is None:
            return [], False

        h_com_p2 = ColumnLayout.calculate_heights(com_p2, w_p2_col - 6*mm)
        if h_com_p2 + h_col3_fixed > h_p2_avail:
            return [], False # Communion P2 + Action de Grace déborde à droite de la Page 2

        # Construction finale des 3 colonnes de la Page 2
        col1_flow = psaume_sec.flowables + [Spacer(1, 4)] + acclamation_sec.flowables + [Spacer(1, 4)] + credo_sec.flowables + [Spacer(1, 4)] + pu_sec.flowables + [Spacer(1, 4)] + off_p1
        col2_flow = off_p2 + [Spacer(1, 4)] + sanctus_sec.flowables + [Spacer(1, 4)] + pater_sec.flowables + [Spacer(1, 4)] + agnus_sec.flowables + [Spacer(1, 4)] + com_p1
        col3_flow = com_p2 + [Spacer(1, 4)] + action_grace_sec.flowables

        # Construction des 3 Tables distinctes avec bordures (pour avoir la séparation)
        padding = 3 * mm
        table_style = TableStyle([
            ('BOX', (0, 0), (-1, -1), 0.5, colors.black),
            ('TOPPADDING', (0, 0), (-1, -1), padding),
            ('BOTTOMPADDING', (0, 0), (-1, -1), padding),
            ('LEFTPADDING', (0, 0), (-1, -1), padding),
            ('RIGHTPADDING', (0, 0), (-1, -1), padding),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ])

        t_col1 = Table([[col1_flow]], colWidths=[w_p2_col], rowHeights=[h_p2_avail])
        t_col1.setStyle(table_style)
        
        t_col2 = Table([[col2_flow]], colWidths=[w_p2_col], rowHeights=[h_p2_avail])
        t_col2.setStyle(table_style)

        t_col3 = Table([[col3_flow]], colWidths=[w_p2_col], rowHeights=[h_p2_avail])
        t_col3.setStyle(table_style)

        # Table globale de mise en page pour Page 2 avec gaps
        page2_layout = Table([[t_col1, "", t_col2, "", t_col3]], colWidths=[w_p2_col, gap_w, w_p2_col, gap_w, w_p2_col])
        page2_layout.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))

        story.append(page2_layout)
        return story, True

    def auto_resize(self) -> Tuple[List[Flowable], float]:
        """Cherche la plus grande échelle typographique (entre 1.0 et 0.6) qui fait tenir le livret."""
        scale = 1.0
        while scale >= 0.6:
            story, success = self._tenter_mise_en_page(scale)
            if success:
                return story, scale
            scale -= 0.02

        # Si aucun ne convient, on lève l'exception
        moments_list = list(self.moments_chants.keys())
        raise DepassementImpossible(
            "Le contenu du feuillet est trop volumineux pour tenir sur 2 pages, même à la taille de police minimale.",
            moments_en_cause=moments_list
        )

    def build(self) -> bytes:
        """Génère le PDF final dans un buffer mémoire."""
        buffer = io.BytesIO()
        
        # Configuration du document de base simple
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            leftMargin=self.margin,
            rightMargin=self.margin,
            topMargin=self.margin,
            bottomMargin=self.margin,
        )

        story, scale = self.auto_resize()

        # Dessin des bordures de page
        def draw_page_decorations(canvas, doc_):
            canvas.saveState()
            canvas.setStrokeColor(colors.black)
            canvas.setLineWidth(0.5)
            # Bordure à 5mm du bord (donc aux marges exactes)
            canvas.rect(self.margin, self.margin, self.page_w - 2 * self.margin, self.page_h - 2 * self.margin)
            canvas.restoreState()

        # Construction du PDF avec le callback onPage
        doc.build(
            story,
            onFirstPage=draw_page_decorations,
            onLaterPages=draw_page_decorations,
        )
        
        return buffer.getvalue()


def render_feuillet_pdf_auto(feuillet: schemas.Feuillet, config: dict, images: Optional[dict] = None) -> bytes:
    """Fonction principale appelée par le routeur de l'application FastAPI."""
    builder = PdfBuilder(feuillet, config, images=images)
    return builder.build()
