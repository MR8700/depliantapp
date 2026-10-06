// Assemble le HTML final (2 pages paysage, ou 1 page unique selon
// one_page_mode) à partir de l'assignation zone->contenu déjà calculée par
// le LayoutEngine -- porté de backend/app/render/pdf.py::_dessiner_pdf, en
// remplaçant le Canvas ReportLab par des <div> positionnés en absolu (mêmes
// coordonnées mm) et le rendu final par expo-print plutôt qu'un Canvas
// dessiné directement (voir genererPdfLocal.ts).
import { Feuillet } from "../types";
import { Unite } from "./layoutEngine";
import { StyleParagraphe } from "./typography";
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

// Chaque unité porte déjà son style résolu (voir genererPdfLocal.ts::testerTaille)
// -- plus besoin de le re-dériver depuis un `nomStyle`+registre partagé ici,
// ce qui permet à deux unités du même rôle (ex: deux "couplet") d'avoir des
// tailles différentes (agrandissement ciblé d'un chant, voir measure.ts).
function contenuZone(unites: Unite[] | undefined): string {
  if (!unites || unites.length === 0) return "";
  return unites.map((u) => `<div style="${styleZoneCss(u.style)}">${u.html}</div>`).join("");
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
  /* Logos : boîte FIXE 26mm x 26mm (comme ReportLab drawImage height=width=
     HAUTEUR_LOGO, preserveAspectRatio=True) -- object-fit:contain reproduit
     exactement ce "letterboxing" : l'image réelle, quel que soit son propre
     ratio, ne dépasse JAMAIS cette boîte. Sans largeur explicite (bug
     précédent), un logo non carré s'affichait à sa largeur naturelle et
     pouvait chevaucher le cadre central. */
  .entete-logo { position: absolute; top: 0; height: 26mm; width: 26mm; object-fit: contain; }
  .entete-logo-g { left: 0; }
  .entete-logo-d { right: 0; }
  .entete-paroisse { text-align:center; font-family:Impact,'Arial Narrow',sans-serif; font-weight:bold; font-size:16pt; line-height:16pt; letter-spacing:.2pt; color:#fff; text-shadow:-.6pt -.6pt 0 #111,.6pt -.6pt 0 #111,-.6pt .6pt 0 #111,.6pt .6pt 0 #111; white-space:nowrap; }
  .entete-ccb { text-align:center; font-size:8pt; color:#555; margin-top:.5mm; white-space:nowrap; }
  /* Largeur EXACTE de widgets.py::dessiner_entete (largeur_bloc = largeur
     totale - 2*HAUTEUR_LOGO - 8pt) -- un "70%" fixe précédent ne
     correspondait à rien de réel et pouvait chevaucher les logos selon la
     largeur effective de la demi-page. 8pt = 8/72*25.4mm ≈ 2.82mm. */
  .entete-cadre { position:absolute; left:50%; transform:translateX(-50%); top:12mm; width:calc(100% - 54.82mm); text-align:center; border:1.2pt solid #111; padding:1mm 2mm; box-sizing:border-box; }
  .entete-nom-chorale { font-weight: bold; font-size: 12pt; text-decoration: underline; }
  .entete-sous-titre { font-weight: bold; font-size: 10pt; text-decoration: underline; margin-top: 1mm; }
  .entete-lecture { font-weight: bold; font-size: 8pt; text-align: left; margin-top: 1mm; }
  .banniere-annonce { text-align:center; font-family:Impact,'Arial Narrow',sans-serif; font-weight:bold; font-size:16pt; color:#fff; text-shadow:-.6pt -.6pt 0 #555,.6pt -.6pt 0 #555,-.6pt .6pt 0 #555,.6pt .6pt 0 #555; }
  /* Hauteur FIXE 20mm (comme widgets.py::_image_dims -- hauteur imposée,
     largeur dérivée du ratio réel de l'image) -- "max-height" seul ne force
     rien : une image plus petite que 20mm en taille naturelle s'affichait
     minuscule au lieu d'être mise à l'échelle jusqu'à 20mm. */
  .banniere-image { display: block; margin: 1mm auto; height: 20mm; width: auto; max-width: 100%; }
  .banniere-sous-titre { position:relative; top:1.5mm; text-align:center; color:#06f; font-family:cursive; font-weight:bold; font-size:12pt; line-height:13pt; border:.5pt solid #c06; margin:.5mm auto; padding:.5mm; width:82%; }
  .banniere-contact { text-align: center; font-style: italic; font-size: 8pt; }
  .reference-liturgique { color:#06f; text-decoration:underline; }
`;

export interface DonneesAssemblage {
  feuillet: Feuillet;
  config: Record<string, any>;
  images: ParametresCache["images"];
  grille: Grille;
  assignation: Record<string, Unite[]>;
  contenuPriereHtml: string | null;
}

export function assemblerHtml(d: DonneesAssemblage): string {
  const { feuillet, config, images, grille, assignation, contenuPriereHtml } = d;
  const onePageMode = !!feuillet.one_page_mode;
  const banniereActive = feuillet.banniere_active !== false;
  const priereActive = !!feuillet.priere_active;

  const zoneAvecContenu = (nom: string, contenuSupplementaire?: string) => {
    const zone = grille.toutes[nom];
    if (!zone) return "";
    const contenu = contenuSupplementaire ?? contenuZone(assignation[nom]);
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
        ${banniereActive ? construireBanniere(feuillet, config, images) : ""}
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
