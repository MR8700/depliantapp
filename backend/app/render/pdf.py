"""PdfRenderer : dessine la grille fixe (bordures, en-tête, bannière) puis
injecte, zone par zone, le contenu déjà distribué par le LayoutEngine.

Le rendu ne suit JAMAIS un flux séquentiel de type Platypus/BaseDocTemplate
(qui ne peut qu'avancer page après page) : l'ordre de remplissage exigé
(D1 -> D2 -> page 2 -> G1 -> G2) revient en arrière sur la page 1 après être
passé par la page 2, ce qu'un flux linéaire ne permet pas. Le moteur calcule
donc d'abord, en pur Python, quelle unité va dans quelle zone (LayoutEngine),
puis dessine chaque page indépendamment en insérant directement le contenu
déjà assigné à ses zones (Frame.addFromList), dans n'importe quel ordre."""
import io
from typing import Optional

from reportlab.lib import colors
from reportlab.platypus import Frame

from .. import schemas
from .layout_engine import DepassementImpossible, LayoutEngine
from .measure import construire_unites
from .model import build_sections
from .typography import construire_styles
from .widgets import construire_flowables_priere, dessiner_banniere, dessiner_entete
from .zones import (EPAISSEUR_BORDURE, HAUTEUR_UTILE, LARGEUR_COLONNE, LARGEUR_UTILE, PAGE_SIZE,
                     X0, Y0, construire_grille)

try:
    from reportlab.pdfgen.canvas import Canvas
except ImportError:  # pragma: no cover
    Canvas = None

__all__ = ["DepassementImpossible", "render_feuillet_pdf_auto"]


def _dessiner_bordure(c) -> None:
    """Bordure noire 0.4pt sur toute la zone imprimable — sur chaque page."""
    c.saveState()
    c.setStrokeColor(colors.black)
    c.setLineWidth(EPAISSEUR_BORDURE)
    c.rect(X0, Y0, LARGEUR_UTILE, HAUTEUR_UTILE, fill=0, stroke=1)
    c.restoreState()


def _remplir_zone(c, zone, flowables: list) -> None:
    if not flowables:
        return
    frame = Frame(zone.x, zone.y, zone.largeur, zone.hauteur,
                  leftPadding=zone.padding, rightPadding=zone.padding,
                  topPadding=zone.padding, bottomPadding=zone.padding,
                  showBoundary=0)
    restants = frame.addFromList(list(flowables), c)
    if restants:
        # Ne devrait jamais arriver : le LayoutEngine a déjà mesuré chaque
        # unité avec le même moteur ReportLab avant de l'assigner à cette
        # zone. Si ça arrive malgré tout (arrondi de mise en page), on ne
        # perd pas le contenu en silence : on le signale.
        raise DepassementImpossible(
            f"Débordement inattendu dans la zone {zone.nom} après assignation.",
            moments_en_cause=[],
        )


def render_feuillet_pdf_auto(feuillet: schemas.Feuillet, config: dict, images: Optional[dict] = None) -> bytes:
    """Compose le feuillet dans la grille fixe et rend le PDF. Typographie et
    marges invariables (jamais de réduction de police, jamais de 3e page) —
    si le contenu ne tient pas, lève DepassementImpossible plutôt que de
    déborder ou de trahir la maquette."""
    images = images or {}
    sections = build_sections(feuillet)
    styles = construire_styles()
    unites = construire_unites(sections, styles, LARGEUR_COLONNE)

    grille = construire_grille(feuillet.priere_active)
    engine = LayoutEngine(grille.flow_order)
    assignation = engine.distribuer(unites, sections)

    if feuillet.priere_active:
        assignation[grille.toutes["G2"].nom] = construire_flowables_priere(feuillet, styles)

    buffer = io.BytesIO()
    c = Canvas(buffer, pagesize=PAGE_SIZE)

    # ---- Page 1 : demi-page droite (en-tête + D1/D2), demi-page gauche (G1/G2 + bannière) ----
    _dessiner_bordure(c)
    dessiner_entete(c, config, images, feuillet)
    dessiner_banniere(c, config, images)
    for nom in ("D1", "D2", "G1", "G2"):
        _remplir_zone(c, grille.toutes[nom], assignation.get(nom, []))
    c.showPage()

    # ---- Page 2 : 4 colonnes identiques, entièrement dédiées aux chants ----
    _dessiner_bordure(c)
    for nom in ("C1", "C2", "C3", "C4"):
        _remplir_zone(c, grille.toutes[nom], assignation.get(nom, []))
    c.showPage()

    c.save()
    return buffer.getvalue()
