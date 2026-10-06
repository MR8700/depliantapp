// Grille fixe du dépliant, portée de backend/app/render/zones.py -- le
// document n'est jamais pensé comme un flux de texte, mais comme une page
// imprimée composée de zones à coordonnées fixes (comme InDesign/Scribus) :
// le contenu (chants) est injecté DANS ces zones, jamais l'inverse.
//
// Coordonnées en mm directement (CSS supporte l'unité `mm` nativement,
// contrairement à ReportLab qui travaille en points) -- mêmes valeurs mm que
// le fichier Python, sans conversion. `y` suit la convention ReportLab
// (origine en bas de page, y croît vers le haut) ; la conversion vers le
// repère CSS (origine en haut) se fait au moment de l'assemblage HTML, voir
// pdfAssembler.ts, jamais ici.

export const PAGE_W_MM = 297; // A4 paysage
export const PAGE_H_MM = 210;

export const MARGE_MM = 5;
export const ENTRE_COLONNES_MM = 6;

export const HAUTEUR_ENTETE_MM = 46;
export const HAUTEUR_BANNIERE_MM = 45;

export const X0_MM = MARGE_MM;
export const Y0_MM = MARGE_MM;
export const LARGEUR_UTILE_MM = PAGE_W_MM - 2 * MARGE_MM;
export const HAUTEUR_UTILE_MM = PAGE_H_MM - 2 * MARGE_MM;

export const LARGEUR_DEMI_MM = (LARGEUR_UTILE_MM - ENTRE_COLONNES_MM) / 2;
export const LARGEUR_COLONNE_MM = (LARGEUR_DEMI_MM - ENTRE_COLONNES_MM) / 2;
// Sur la page 2, 4 colonnes égales occupent toute la largeur utile -- avec le
// même entre-colonnes, elles tombent exactement à la même largeur que les
// demi-colonnes de la page 1, assurant une grille identique sur les 2 pages.
export const LARGEUR_COLONNE_P2_MM = (LARGEUR_UTILE_MM - 3 * ENTRE_COLONNES_MM) / 4;

export const X_GAUCHE_MM = X0_MM;
export const X_DROITE_MM = X0_MM + LARGEUR_DEMI_MM + ENTRE_COLONNES_MM;

// Retrait de sécurité entre le texte et chaque bordure : 0,5 pt.
const PADDING_MM = 0.5 / 2.8346;

export interface Zone {
  nom: string;
  page: 1 | 2;
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
  padding: number;
}

function colonneX(xBase: number, i: number, largeur: number): number {
  return xBase + i * (largeur + ENTRE_COLONNES_MM);
}

function zone(nom: string, page: 1 | 2, x: number, y: number, largeur: number, hauteur: number): Zone {
  return { nom, page, x, y, largeur, hauteur, padding: PADDING_MM };
}

/** G1/G2 : demi-page gauche de la page 1, au-dessus de la bannière (ou
 * jusqu'en bas si elle est désactivée). */
export function construireZoneG(banniereActive = true): [Zone, Zone] {
  const y = banniereActive ? Y0_MM + HAUTEUR_BANNIERE_MM : Y0_MM;
  const hauteur = banniereActive ? HAUTEUR_UTILE_MM - HAUTEUR_BANNIERE_MM : HAUTEUR_UTILE_MM;
  return [
    zone("G1", 1, colonneX(X_GAUCHE_MM, 0, LARGEUR_COLONNE_MM), y, LARGEUR_COLONNE_MM, hauteur),
    zone("G2", 1, colonneX(X_GAUCHE_MM, 1, LARGEUR_COLONNE_MM), y, LARGEUR_COLONNE_MM, hauteur),
  ];
}

/** D1/D2 : demi-page droite de la page 1, sous l'en-tête fixe. */
export function construireZoneD(): [Zone, Zone] {
  const y = Y0_MM;
  const hauteur = HAUTEUR_UTILE_MM - HAUTEUR_ENTETE_MM;
  return [
    zone("D1", 1, colonneX(X_DROITE_MM, 0, LARGEUR_COLONNE_MM), y, LARGEUR_COLONNE_MM, hauteur),
    zone("D2", 1, colonneX(X_DROITE_MM, 1, LARGEUR_COLONNE_MM), y, LARGEUR_COLONNE_MM, hauteur),
  ];
}

/** 4 colonnes strictement identiques occupant toute la page 2. */
export function construireZonesPage2(): Zone[] {
  return [0, 1, 2, 3].map((i) =>
    zone(`C${i + 1}`, 2, colonneX(X0_MM, i, LARGEUR_COLONNE_P2_MM), Y0_MM, LARGEUR_COLONNE_P2_MM, HAUTEUR_UTILE_MM));
}

export interface Grille {
  /** Ordre exact de remplissage des chants : D1 -> D2 -> page2 -> G1 -> G2
   * (G2 exclue si la Prière est active). Jamais l'ordre physique des pages. */
  flowOrder: Zone[];
  /** Toutes les zones par nom, y compris celles hors du flux -- pour que le
   * rendu puisse toujours les localiser (ex: G2 quand la Prière l'occupe). */
  toutes: Record<string, Zone>;
}

/** Si onePageMode est vrai, le flux est restreint à D1/D2 (page 1, moitié
 * droite) et C1/C2 (page 1, moitié gauche) -- jamais de page 2. */
export function construireGrille(priereActive: boolean, onePageMode = false, banniereActive = true): Grille {
  const [d1, d2] = construireZoneD();
  const [g1, g2] = construireZoneG(banniereActive);

  let zonesP2: Zone[];
  let c1: Zone | undefined, c2: Zone | undefined;
  if (onePageMode) {
    const yC = banniereActive ? Y0_MM + HAUTEUR_BANNIERE_MM : Y0_MM;
    const hC = banniereActive ? HAUTEUR_UTILE_MM - HAUTEUR_BANNIERE_MM : HAUTEUR_UTILE_MM;
    c1 = zone("C1", 1, colonneX(X0_MM, 0, LARGEUR_COLONNE_P2_MM), yC, LARGEUR_COLONNE_P2_MM, hC);
    c2 = zone("C2", 1, colonneX(X0_MM, 1, LARGEUR_COLONNE_P2_MM), yC, LARGEUR_COLONNE_P2_MM, hC);
    const c3 = zone("C3", 1, colonneX(X0_MM, 2, LARGEUR_COLONNE_P2_MM), Y0_MM, LARGEUR_COLONNE_P2_MM, HAUTEUR_UTILE_MM);
    const c4 = zone("C4", 1, colonneX(X0_MM, 3, LARGEUR_COLONNE_P2_MM), Y0_MM, LARGEUR_COLONNE_P2_MM, HAUTEUR_UTILE_MM);
    zonesP2 = [c1, c2, c3, c4];
  } else {
    zonesP2 = construireZonesPage2();
  }

  const toutes: Record<string, Zone> = {};
  for (const z of [d1, d2, g1, g2, ...zonesP2]) toutes[z.nom] = z;

  let flow: Zone[];
  if (onePageMode) {
    flow = [d1, d2, c1!];
    if (!priereActive) flow.push(c2!);
  } else {
    flow = [d1, d2, ...zonesP2, g1];
    if (!priereActive) flow.push(g2);
  }
  return { flowOrder: flow, toutes };
}
