// Widgets : blocs de contenu fixes, indépendants du flux des chants, portés
// de backend/app/render/widgets.py.
// - En-tête : toujours présent, ancré en haut de la demi-page droite (page 1).
// - Bannière : toujours présente, ancrée en bas de la demi-page gauche (page 1).
// - Prière : facultative, occupe la zone G2/C2 entière quand active (son
//   contenu n'est jamais mesuré/distribué par le LayoutEngine, il occupe
//   la zone en entier, sans condition).
import { Feuillet } from "../types";
import { escapeHtml, formaterTexteLiturgique } from "./texteUtils";
import { NomStyle, StyleParagraphe } from "./typography";
import {
  HAUTEUR_BANNIERE_MM, HAUTEUR_ENTETE_MM, LARGEUR_DEMI_MM, PAGE_H_MM,
  X_DROITE_MM, X_GAUCHE_MM, Y0_MM,
} from "./zones";
import { ParametresCache } from "../storage/parametresCache";

const JOURS_FR = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const MOIS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** Porté de widgets.py::formater_date_affichage -- tableaux figés plutôt que
 * toLocaleDateString(), pour ne jamais dépendre des données ICU disponibles
 * sur l'appareil (souvent absentes/partielles sous Hermes). */
export function formaterDateAffichage(valeur: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur || "");
  if (!m) return valeur || "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const jour = JOURS_FR[(d.getDay() + 6) % 7]; // getDay(): 0=dimanche -> décale pour 0=lundi comme weekday() Python
  const mois = MOIS_FR[d.getMonth()];
  return `${jour.charAt(0).toUpperCase()}${jour.slice(1)} ${d.getDate()} ${mois} ${d.getFullYear()}`;
}

export const DEFAULT_PRIERE_TITRE = "Prière pour le Burkina Faso";
export const DEFAULT_PRIERE_TEXTE =
  "Dieu notre père ce qu'il y a de meilleur dans ta création c'est l'homme. " +
  "Tu l'as créé à ton image, afin qu'après le temps de sa vie Terrestre, il " +
  "jouisse d'un bonheur éternel auprès de toi. Pour que notre pays soit le " +
  "milieu de vie où nous obtenions cet unique nécessaire qu'est la vie " +
  "éternelle nous t'adressons cette prière:\n\n" +
  "Accorde à notre pays, le BURKINA FASO, des institutions qui lui " +
  "garantissent le bien être, la liberté et la paix: Accorde lui avant " +
  "tout des autorités religieuses et civiles qui se laissent guider par " +
  "l'Esprit Saint, afin qu'elles exercent leurs charges, selon la justice " +
  "et dans le seul soucis du bien de tous.\n\n" +
  "Nous te le demandons par ton fils Jésus Christ notre Seigneur. Amen !";

/** En-tête : logos + titre paroisse, nom de la chorale, date, lectures.
 * Toujours ancré en haut de la demi-page droite -- jamais déplacé. */
export function construireEntete(feuillet: Feuillet, config: Record<string, any>, images: ParametresCache["images"]): string {
  const top = Y0_MM;
  const left = X_DROITE_MM;
  const largeur = LARGEUR_DEMI_MM;
  const hauteurLogo = 26; // mm, identique au HAUTEUR_LOGO ReportLab (widgets.py)

  const logoG = images.logo_gauche ? `<img src="${images.logo_gauche}" class="entete-logo entete-logo-g" />` : "";
  const logoD = images.logo_droit ? `<img src="${images.logo_droit}" class="entete-logo entete-logo-d" />` : "";

  const paroisse = config?.paroisse ? `<div class="entete-paroisse">${escapeHtml(config.paroisse)}</div>` : "";
  const ccb = config?.ccb ? `<div class="entete-ccb">${escapeHtml(config.ccb)}</div>` : "";
  const nomChorale = escapeHtml(config?.chorale ?? "");

  const dateAffichee = formaterDateAffichage(feuillet.date);
  const sousTitre = feuillet.lieu ? `${dateAffichee} — ${escapeHtml(feuillet.lieu)}` : dateAffichee;

  const lectures = feuillet.lectures;
  const lignesLecture: string[] = [];
  const ajouterLecture = (label: string, valeur?: string | null) => {
    if (valeur) lignesLecture.push(`<div class="entete-lecture">${label} : ${formaterTexteLiturgique(valeur)}</div>`);
  };
  ajouterLecture("1ère lecture", lectures?.premiere_lecture);
  ajouterLecture("Psaume", lectures?.psaume);
  ajouterLecture("2ème lecture", lectures?.deuxieme_lecture);
  ajouterLecture("Évangile", lectures?.evangile);

  return `
    <div class="widget entete" style="top:${top}mm; left:${left}mm; width:${largeur}mm; height:${HAUTEUR_ENTETE_MM}mm;">
      ${logoG}${logoD}
      ${paroisse}
      ${ccb}
      <div class="entete-cadre">
        <div class="entete-nom-chorale">${nomChorale}</div>
        <div class="entete-sous-titre">${sousTitre}</div>
        ${lignesLecture.join("")}
      </div>
    </div>`;
}

/** Bannière : annonce, image décorative, coordonnées. Toujours ancrée en bas
 * de la demi-page gauche -- jamais utilisée pour les chants. */
export function construireBanniere(feuillet: Feuillet, config: Record<string, any>, images: ParametresCache["images"]): string {
  const top = PAGE_H_MM - Y0_MM - HAUTEUR_BANNIERE_MM;
  const left = X_GAUCHE_MM;
  const largeur = LARGEUR_DEMI_MM;

  const annonce = config?.annonce ? `<div class="banniere-annonce">${escapeHtml(config.annonce)}</div>` : "";
  const sousTitre = config?.banniere_sous_titre
    ? `<div class="banniere-sous-titre">${formaterTexteLiturgique(config.banniere_sous_titre)}</div>`
    : `<div class="banniere-sous-titre">${escapeHtml(formaterDateAffichage(feuillet.date))}</div>`;
  const image = images.banniere_bas ? `<img src="${images.banniere_bas}" class="banniere-image" />` : "";
  const contact = config?.contact
    ? `<div class="banniere-contact">Pour de plus amples informations sur votre chorale, veuillez nous contacter au : ${escapeHtml(config.contact)}</div>`
    : "";

  return `
    <div class="widget banniere" style="top:${top}mm; left:${left}mm; width:${largeur}mm; height:${HAUTEUR_BANNIERE_MM}mm;">
      ${annonce}${image}${sousTitre}${contact}
    </div>`;
}

/** Contenu de la Prière -- injecté tel quel dans la zone G2/C2 en entier,
 * jamais mesuré/distribué par le LayoutEngine comme les unités de chant.
 * Priorité au texte propre au feuillet ; à défaut, au texte par défaut
 * configuré dans Réglages ; à défaut, au texte figé ci-dessus. */
export function construireContenuPriere(
  feuillet: Feuillet, styles: Record<NomStyle, StyleParagraphe>, config?: Record<string, any> | null,
): string {
  const titre = escapeHtml(config?.priere_titre || DEFAULT_PRIERE_TITRE).toUpperCase();
  const texte: string = feuillet.priere_texte || config?.priere_texte_defaut || DEFAULT_PRIERE_TEXTE;
  const st = styles.titre_section;
  const sp = styles.priere_corps;

  const paragraphesHtml = texte
    .split("\n\n")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const contenu = formaterTexteLiturgique(p);
      return `<div style="font-size:${sp.fontSize}pt; line-height:${sp.lineHeight}pt; margin-bottom:${sp.marginBottom ?? 0}pt;">${contenu}</div>`;
    })
    .join("");

  return `
    <div style="font-size:${st.fontSize}pt; line-height:${st.lineHeight}pt; font-weight:bold; margin-top:${st.marginTop ?? 0}pt; margin-bottom:${st.marginBottom ?? 0}pt;">
      <u>${titre}</u>
    </div>
    ${paragraphesHtml}
  `;
}
