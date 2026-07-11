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
from .typography import ECHELLES_CORPS, TAILLE_TEXTE, TAILLE_TEXTE_PLAFOND, construire_styles
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
    # Frame.addFromList() modifie sa liste en place (elle retire les éléments
    # consommés via `del drawlist[0]`) et NE RETOURNE RIEN (None) — les
    # éléments restants ne sont donc lisibles que dans la variable passée en
    # argument, jamais dans la valeur de retour. Il faut impérativement
    # conserver une référence à cette liste mutable pour détecter un
    # débordement ; l'affecter au retour (toujours None) masquait
    # silencieusement tout contenu qui ne rentrait pas dans la zone.
    restants = list(flowables)
    frame.addFromList(restants, c)
    if restants:
        # Ne devrait jamais arriver : le LayoutEngine a déjà mesuré chaque
        # unité avec le même moteur ReportLab avant de l'assigner à cette
        # zone. Si ça arrive malgré tout (arrondi de mise en page), on ne
        # perd pas le contenu en silence : on le signale.
        raise DepassementImpossible(
            f"Débordement inattendu dans la zone {zone.nom} après assignation.",
            moments_en_cause=[],
        )


def _tester_taille(feuillet: schemas.Feuillet, sections: list, grille, taille_texte: float):
    """Vérification bon marché (pure mesure ReportLab, sans dessiner de PDF) :
    retourne (styles, assignation) si cette taille remplit toutes les zones
    sans déborder, sinon lève DepassementImpossible. Utilisée pour balayer
    rapidement ECHELLES_CORPS (jusqu'à ~50 valeurs) sans payer le coût d'un
    rendu Canvas complet à chaque tentative — seule la taille retenue est
    effectivement dessinée, dans _dessiner_pdf."""
    styles = construire_styles(taille_texte)
    unites = construire_unites(sections, styles, LARGEUR_COLONNE)
    engine = LayoutEngine(grille.flow_order)
    assignation = engine.distribuer(unites, sections)
    if feuillet.priere_active:
        assignation[grille.toutes["G2"].nom] = construire_flowables_priere(feuillet, styles)
    return styles, assignation


def _dessiner_pdf(feuillet: schemas.Feuillet, config: dict, images: dict, grille, assignation: dict) -> bytes:
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


def render_feuillet_pdf_auto(feuillet: schemas.Feuillet, config: dict, images: Optional[dict] = None) -> tuple[bytes, float]:
    """Compose le feuillet dans la grille fixe et rend le PDF. Retourne
    (contenu_pdf, taille_texte_utilisee).

    Par défaut (feuillet.taille_texte_manuelle est None), la police du corps
    des chants n'est JAMAIS réduite en dessous du plancher (dernière valeur
    de ECHELLES_CORPS) — mais quand un feuillet léger laisse des zones à
    moitié vides, elle est agrandie uniformément (même taille partout,
    jamais chant par chant) jusqu'à la plus grande taille qui remplit
    encore toutes les zones sans déborder.

    Si l'utilisateur a choisi une taille manuelle (bouton +/- du Composer),
    seule cette taille est essayée : pas de repli automatique, pour que le
    réglage manuel soit honoré tel quel. Si même au plancher (mode auto) ou
    à la taille choisie (mode manuel) le contenu ne tient pas, lève
    DepassementImpossible plutôt que de déborder ou de trahir la maquette."""
    images = images or {}
    sections = build_sections(feuillet)
    grille = construire_grille(feuillet.priere_active)

    if feuillet.taille_texte_manuelle is not None:
        taille = max(TAILLE_TEXTE, min(TAILLE_TEXTE_PLAFOND, feuillet.taille_texte_manuelle))
        styles, assignation = _tester_taille(feuillet, sections, grille, taille)
        return _dessiner_pdf(feuillet, config, images, grille, assignation), taille

    derniere_erreur: Optional[DepassementImpossible] = None
    for taille_texte in ECHELLES_CORPS:
        try:
            styles, assignation = _tester_taille(feuillet, sections, grille, taille_texte)
        except DepassementImpossible as exc:
            derniere_erreur = exc
            continue
        try:
            return _dessiner_pdf(feuillet, config, images, grille, assignation), taille_texte
        except DepassementImpossible as exc:
            # Garde-fou improbable : la mesure a dit "ça tient" mais le rendu
            # réel (Frame.addFromList) a détecté un écart. On retente avec la
            # taille suivante plutôt que de renvoyer un PDF potentiellement
            # incomplet.
            derniere_erreur = exc
            continue
    raise derniere_erreur
