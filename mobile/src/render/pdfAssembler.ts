// Assemble le HTML final (2 pages paysage, ou 1 page unique selon
// one_page_mode) à partir de l'assignation zone->contenu déjà calculée par
// le LayoutEngine -- porté de backend/app/render/pdf.py::_dessiner_pdf, en
// remplaçant le Canvas ReportLab par des <div> positionnés en absolu (mêmes
// coordonnées mm) et le rendu final par expo-print plutôt qu'un Canvas
// dessiné directement (voir genererPdfLocal.ts).
import { Feuillet } from "../types";
import { Unite } from "./layoutEngine";
import { NomStyle, StyleParagraphe } from "./typography";
import { ParametresCache } from "../storage/parametresCache";
import { construireBanniere, construireEntete } from "./widgets";
import { Grille, HAUTEUR_UTILE_MM, LARGEUR_UTILE_MM, PAGE_H_MM, PAGE_W_MM, X0_MM, Y0_MM, Zone } from "./zones";

function topDepuisY(y: number, hauteur: number): number {
  return PAGE_H_MM - y - hauteur;
}

function styleZoneCss(style: StyleParagraphe): string {
  return `font-size:${style.fontSize}pt; line-height:${style.lineHeight}pt; `
    + `font-weight:${style.fontWeight ?? "normal"}; margin-top:${style.marginTop ?? 0}pt; margin-bottom:${style.marginBottom ?? 0}pt;`;
}

function contenuZone(unites: Unite[] | undefined, styles: Record<NomStyle, StyleParagraphe>): string {
  if (!unites || unites.length === 0) return "";
  return unites.map((u) => `<div style="${styleZoneCss(styles[u.nomStyle])}">${u.html}</div>`).join("");
}

function divZone(zone: Zone, contenuHtml: string): string {
  const top = topDepuisY(zone.y, zone.hauteur);
  return `<div class="zone" style="top:${top}mm; left:${zone.x}mm; width:${zone.largeur}mm; height:${zone.hauteur}mm; padding:${zone.padding}mm;">${contenuHtml}</div>`;
}

function divBordure(topPage: number): string {
  return `<div class="bordure" style="top:${topPage + Y0_MM}mm; left:${X0_MM}mm; width:${LARGEUR_UTILE_MM}mm; height:${HAUTEUR_UTILE_MM}mm;"></div>`;
}

const STYLE_COMMUN = `
  @page { size: 297mm 210mm; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Times New Roman', Times, serif; }
  .page { position: relative; width: ${PAGE_W_MM}mm; height: ${PAGE_H_MM}mm; page-break-after: always; overflow: hidden; }
  .page:last-child { page-break-after: auto; }
  .zone, .widget { position: absolute; overflow: hidden; }
  .bordure { position: absolute; border: 0.4pt solid #000; box-sizing: border-box; }
  .entete-logo { position: absolute; top: 0; height: 26mm; }
  .entete-logo-g { left: 0; }
  .entete-logo-d { right: 0; }
  .entete-paroisse { text-align: center; font-weight: bold; font-size: 11pt; color: #4a4a4a; }
  .entete-cadre { position: absolute; left: 50%; transform: translateX(-50%); top: 8mm; width: 70%; text-align: center; border: 1.2pt solid #b23b3b; padding: 2mm; }
  .entete-nom-chorale { font-weight: bold; font-size: 12pt; text-decoration: underline; }
  .entete-sous-titre { font-weight: bold; font-size: 10pt; text-decoration: underline; margin-top: 1mm; }
  .entete-lecture { font-weight: bold; font-size: 8pt; text-align: left; margin-top: 1mm; }
  .banniere-annonce { text-align: center; font-weight: bold; font-size: 13pt; color: #4a4a4a; }
  .banniere-image { display: block; margin: 1mm auto; max-height: 20mm; max-width: 100%; }
  .banniere-contact { text-align: center; font-style: italic; font-size: 8pt; }
`;

export interface DonneesAssemblage {
  feuillet: Feuillet;
  config: Record<string, any>;
  images: ParametresCache["images"];
  grille: Grille;
  assignation: Record<string, Unite[]>;
  styles: Record<NomStyle, StyleParagraphe>;
  contenuPriereHtml: string | null;
}

export function assemblerHtml(d: DonneesAssemblage): string {
  const { feuillet, config, images, grille, assignation, styles, contenuPriereHtml } = d;
  const onePageMode = !!feuillet.one_page_mode;
  const banniereActive = feuillet.banniere_active !== false;
  const priereActive = !!feuillet.priere_active;

  const zoneAvecContenu = (nom: string, contenuSupplementaire?: string) => {
    const zone = grille.toutes[nom];
    if (!zone) return "";
    const contenu = contenuSupplementaire ?? contenuZone(assignation[nom], styles);
    return divZone(zone, contenu);
  };

  let pagesHtml: string;
  if (onePageMode) {
    // Mode 1 page paysage : C1/C2 (gauche) + entête et D1/D2 (droite) --
    // PAS de bannière en mode 1 page (fidèle à pdf.py::_dessiner_pdf).
    // C2 est réservée à la prière si active (voir zones.construireGrille).
    const contenuC2 = priereActive ? contenuPriereHtml ?? "" : undefined;
    pagesHtml = `
      <div class="page">
        ${divBordure(0)}
        ${construireEntete(feuillet, config, images)}
        ${zoneAvecContenu("C1")}
        ${zoneAvecContenu("C2", contenuC2)}
        ${zoneAvecContenu("D1")}
        ${zoneAvecContenu("D2")}
      </div>`;
  } else {
    const contenuG2 = priereActive ? contenuPriereHtml ?? "" : undefined;
    pagesHtml = `
      <div class="page">
        ${divBordure(0)}
        ${construireEntete(feuillet, config, images)}
        ${banniereActive ? construireBanniere(config, images) : ""}
        ${zoneAvecContenu("D1")}
        ${zoneAvecContenu("D2")}
        ${zoneAvecContenu("G1")}
        ${zoneAvecContenu("G2", contenuG2)}
      </div>
      <div class="page">
        ${divBordure(0)}
        ${zoneAvecContenu("C1")}
        ${zoneAvecContenu("C2")}
        ${zoneAvecContenu("C3")}
        ${zoneAvecContenu("C4")}
      </div>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${STYLE_COMMUN}</style></head><body>${pagesHtml}</body></html>`;
}
