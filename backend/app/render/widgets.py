"""Widgets : blocs de contenu fixes, indépendants du flux des chants.
Chaque widget peut être activé ou retiré sans toucher au LayoutEngine :
- Header : toujours présent, ancré en haut de la demi-page droite (page 1).
- Bannière : toujours présente, ancrée en bas de la demi-page gauche (page 1).
- Prière : facultative, consomme la zone G2 entière quand active.
"""
from datetime import datetime
from pathlib import Path
from typing import Optional
from xml.sax.saxutils import escape

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.platypus import Paragraph

from .. import schemas
from .typography import INTERLIGNE_TEXTE, POLICE_GRAS, TAILLE_TEXTE
from .zones import HAUTEUR_BANNIERE, HAUTEUR_ENTETE, LARGEUR_DEMI, X_DROITE, X_GAUCHE, Y0, PAGE_H, HAUTEUR_UTILE

HAUTEUR_LOGO = 26 * 2.8346  # 26mm en pt, cohérent avec l'ancien moteur
HAUTEUR_BANNIERE_IMG = 20 * 2.8346

_JOURS_FR = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
_MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin",
            "juillet", "août", "septembre", "octobre", "novembre", "décembre"]


def formater_date_affichage(valeur: str) -> str:
    """Le champ `date` du feuillet est saisi via un sélecteur de date natif
    (ISO « AAAA-MM-JJ ») depuis le Composer, mais d'anciens feuillets créés
    avant ce changement stockent encore une chaîne libre déjà formatée
    (ex. « Dimanche 12 juillet 2026 ») : on tente d'abord un parsing ISO, et
    si ça échoue on renvoie la valeur telle quelle plutôt que de la
    corrompre — aucune donnée existante n'est perdue par cette évolution."""
    try:
        d = datetime.strptime(valeur, "%Y-%m-%d")
    except (ValueError, TypeError):
        return valeur
    jour = _JOURS_FR[d.weekday()]
    mois = _MOIS_FR[d.month - 1]
    return f"{jour.capitalize()} {d.day} {mois} {d.year}"

DEFAULT_PRIERE_TITRE = "Prière pour le Burkina Faso"
DEFAULT_PRIERE_TEXTE = (
    "Dieu notre père ce qu'il y a de meilleur dans ta création c'est l'homme. "
    "Tu l'as créé à ton image, afin qu'après le temps de sa vie Terrestre, il "
    "jouisse d'un bonheur éternel auprès de toi. Pour que notre pays soit le "
    "milieu de vie où nous obtenions cet unique nécessaire qu'est la vie "
    "éternelle nous t'adressons cette prière:\n\n"
    "Accorde à notre pays, le BURKINA FASO, des institutions qui lui "
    "garantissent le bien être, la liberté et la paix: Accorde lui avant "
    "tout des autorités religieuses et civiles qui se laissent guider par "
    "l'Esprit Saint, afin qu'elles exercent leurs charges, selon la justice "
    "et dans le seul soucis du bien de tous.\n\n"
    "Nous te le demandons par ton fils Jésus Christ notre Seigneur. Amen !"
)


def _image_dims(chemin: Path, hauteur_max: float) -> tuple[float, float]:
    with PILImage.open(chemin) as img:
        largeur_px, hauteur_px = img.size
    ratio = largeur_px / hauteur_px
    return hauteur_max * ratio, hauteur_max


def dessiner_entete(canvas, config: dict, images: dict, feuillet: schemas.Feuillet) -> None:
    """Bloc fixe : logos + titre paroisse, nom de la chorale, date, lectures.
    Toujours ancré en haut de la demi-page droite — jamais déplacé."""
    canvas.saveState()
    x0 = X_DROITE
    x1 = X_DROITE + LARGEUR_DEMI
    y_haut = PAGE_H - Y0
    y_bas = y_haut - HAUTEUR_ENTETE
    centre_x = (x0 + x1) / 2

    logo_g = images.get("logo_gauche")
    logo_d = images.get("logo_droit")
    if logo_g:
        try:
            canvas.drawImage(str(logo_g), x0, y_bas + (HAUTEUR_ENTETE - HAUTEUR_LOGO) / 2,
                              height=HAUTEUR_LOGO, width=HAUTEUR_LOGO, preserveAspectRatio=True, mask="auto")
        except Exception:
            pass
    if logo_d:
        try:
            canvas.drawImage(str(logo_d), x1 - HAUTEUR_LOGO, y_bas + (HAUTEUR_ENTETE - HAUTEUR_LOGO) / 2,
                              height=HAUTEUR_LOGO, width=HAUTEUR_LOGO, preserveAspectRatio=True, mask="auto")
        except Exception:
            pass

    paroisse = config.get("paroisse", "")
    if paroisse:
        canvas.setFont(POLICE_GRAS, 11)
        largeur_texte = canvas.stringWidth(paroisse, POLICE_GRAS, 11)
        ty = y_haut - 12
        canvas.setFillColor(colors.HexColor("#d8d8d8"))
        canvas.drawCentredString(centre_x + 0.7, ty - 0.7, paroisse)
        canvas.setFillColor(colors.HexColor("#4a4a4a"))
        canvas.drawCentredString(centre_x, ty, paroisse)
    canvas.setFillColor(colors.black)

    largeur_bloc = (x1 - x0) - 2 * HAUTEUR_LOGO - 8
    cadre_y_haut = y_haut - 20
    cadre_y_bas = y_bas + 4
    canvas.setStrokeColor(colors.HexColor("#b23b3b"))
    canvas.setLineWidth(1.2)
    canvas.rect(centre_x - largeur_bloc / 2, cadre_y_bas, largeur_bloc, cadre_y_haut - cadre_y_bas)

    def _souligner(texte: str, taille: float, y: float) -> None:
        largeur = canvas.stringWidth(texte, canvas._fontname, taille)
        canvas.line(centre_x - largeur / 2, y - 1.5, centre_x + largeur / 2, y - 1.5)

    texte_y = cadre_y_haut - 13
    canvas.setFont(POLICE_GRAS, 12)
    nom_chorale = config.get("chorale", "")
    canvas.drawCentredString(centre_x, texte_y, nom_chorale)
    _souligner(nom_chorale, 12, texte_y)

    texte_y -= 15
    canvas.setFont(POLICE_GRAS, 10)
    date_affichee = formater_date_affichage(feuillet.date)
    sous_titre = date_affichee if not feuillet.lieu else f"{date_affichee} — {feuillet.lieu}"
    canvas.drawCentredString(centre_x, texte_y, sous_titre)
    _souligner(sous_titre, 10, texte_y)

    lectures = feuillet.lectures
    lecture_lines = [
        ("1ère lecture", lectures.premiere_lecture),
        ("Psaume", lectures.psaume),
        ("2ème lecture", lectures.deuxieme_lecture),
        ("Évangile", lectures.evangile),
    ]
    x_gauche_texte = centre_x - largeur_bloc / 2 + 6
    canvas.setFont(POLICE_GRAS, TAILLE_TEXTE)
    for label, ref in lecture_lines:
        if not ref:
            continue
        texte_y -= 11
        if texte_y < cadre_y_bas + 4:
            break
        canvas.drawString(x_gauche_texte, texte_y, f"{label} : {ref}")

    canvas.restoreState()


def dessiner_banniere(canvas, config: dict, images: dict) -> None:
    """Bande fixe en bas de la demi-page gauche : annonce, bannière
    décorative (raisins/colombe), coordonnées. Toujours centrée. N'est
    jamais utilisée pour les chants."""
    canvas.saveState()
    x0 = X_GAUCHE
    x1 = X_GAUCHE + LARGEUR_DEMI
    centre_x = (x0 + x1) / 2
    y_haut = Y0 + HAUTEUR_BANNIERE

    annonce = config.get("annonce", "")
    y = y_haut - 16
    if annonce:
        canvas.setFont(POLICE_GRAS, 13)
        canvas.setFillColor(colors.HexColor("#d8d8d8"))
        canvas.drawCentredString(centre_x + 0.7, y - 0.7, annonce)
        canvas.setFillColor(colors.HexColor("#4a4a4a"))
        canvas.drawCentredString(centre_x, y, annonce)
        canvas.setFillColor(colors.black)
        y -= 18

    banniere_img = images.get("banniere_bas")
    if banniere_img:
        try:
            largeur, hauteur = _image_dims(banniere_img, HAUTEUR_BANNIERE_IMG)
            canvas.drawImage(str(banniere_img), centre_x - largeur / 2, y - hauteur,
                              width=largeur, height=hauteur, preserveAspectRatio=True, mask="auto")
            y -= hauteur + 6
        except Exception:
            pass

    contact = config.get("contact")
    if contact:
        canvas.setFont("Times-Italic", TAILLE_TEXTE)
        canvas.drawCentredString(
            centre_x, max(y, Y0 + 6),
            f"Pour de plus amples informations sur votre chorale, veuillez nous contacter au : {contact}",
        )
    canvas.restoreState()


def construire_flowables_priere(feuillet: schemas.Feuillet, styles: dict, config: Optional[dict] = None) -> list:
    """Construit le contenu de la Prière comme des flowables Platypus
    classiques, pour qu'elle soit injectée directement dans la zone G2
    comme n'importe quel bloc de la grille. Priorité au texte propre au
    feuillet ; à défaut, au texte par défaut configuré dans Réglages
    (config.priere_texte_defaut) ; à défaut, au texte figé ci-dessus."""
    titre = escape(DEFAULT_PRIERE_TITRE)
    texte = feuillet.priere_texte or (config or {}).get("priere_texte_defaut") or DEFAULT_PRIERE_TEXTE
    flowables = [Paragraph(f"<u>{titre.upper()}</u>", styles["titre_section"])]
    for paragraphe in texte.split("\n\n"):
        paragraphe = paragraphe.strip()
        if not paragraphe:
            continue
        flowables.append(Paragraph(escape(paragraphe).replace("\n", "<br/>"), styles["priere_corps"]))
    return flowables
