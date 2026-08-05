// Point d'entrée unique du moteur de rendu PDF hors-ligne -- orchestre les
// modules portés de backend/app/render/*.py (zones, typography, model,
// layoutEngine, measure, widgets, pdfAssembler) + le pont de mesure
// (MeasurementBridge, WebView cachée) + expo-print pour la génération réelle
// du fichier. Reproduit fidèlement render_feuillet_pdf_auto (pdf.py) :
// balaie ECHELLES_CORPS du plus grand au plus petit, teste (mesure + essaie
// de distribuer) avant de dessiner, jamais de réduction chant par chant,
// jamais de 3e page.
import * as Print from "expo-print";
import { MeasurementBridgeHandle } from "../components/MeasurementBridge";
import { Feuillet } from "../types";
import { telechargerFeuilletPdf, getFeuillet, PdfLocal } from "../api/feuillets";
import { ApiError } from "../api/client";
import { lireCache } from "../storage/chantsCache";
import { lireParametresCache } from "../storage/parametresCache";
import { buildSections, Section } from "./model";
import { construireUnites, UniteNonMesuree } from "./measure";
import { construireStyles, ECHELLES_CORPS, NomStyle, StyleParagraphe, TAILLE_TEXTE, TAILLE_TEXTE_PLAFOND } from "./typography";
import { DepassementImpossible, LayoutEngine, Unite } from "./layoutEngine";
import { construireGrille, Grille, LARGEUR_COLONNE_MM, PAGE_H_MM, PAGE_W_MM } from "./zones";
import { construireContenuPriere } from "./widgets";
import { assemblerHtml } from "./pdfAssembler";

export { DepassementImpossible } from "./layoutEngine";
export { ChantIntrouvableHorsLigne } from "./model";

export interface ResultatPdfLocal {
  uri: string;
  tailleTexte: number;
}

// 1mm ≈ 2.83465pt -- expo-print attend une largeur/hauteur en points, pas en mm.
const MM_VERS_PT = 2.83465;
const LARGEUR_PT = Math.round(PAGE_W_MM * MM_VERS_PT);
const HAUTEUR_PT = Math.round(PAGE_H_MM * MM_VERS_PT);

async function testerTaille(
  bridge: MeasurementBridgeHandle, unitesNonMesurees: UniteNonMesuree[], sections: Section[], grille: Grille, tailleTexte: number,
): Promise<{ styles: Record<NomStyle, StyleParagraphe>; assignation: Record<string, Unite[]> }> {
  const styles = construireStyles(tailleTexte);
  const demandes = unitesNonMesurees.map((u) => ({ html: u.html, nomStyle: u.nomStyle }));
  const hauteurs = await bridge.mesurer(demandes, styles, LARGEUR_COLONNE_MM);
  const unites: Unite[] = unitesNonMesurees.map((u, i) => ({
    html: u.html, nomStyle: u.nomStyle, hauteur: hauteurs[i], sectionOrdre: u.sectionOrdre, nature: u.nature,
  }));
  const engine = new LayoutEngine(grille.flowOrder);
  const assignation = engine.distribuer(unites, sections); // lève DepassementImpossible si ça ne rentre pas
  return { styles, assignation };
}

/** Génère le PDF d'un feuillet entièrement sur l'appareil, sans réseau.
 * `bridge` doit être le ref d'un <MeasurementBridge/> monté par l'écran
 * appelant (voir ComposerScreen.tsx/DepliantsScreen.tsx). */
export async function genererPdfFeuilletLocal(feuillet: Feuillet, bridge: MeasurementBridgeHandle): Promise<ResultatPdfLocal> {
  const chantsCache = await lireCache();
  const chantsParId = new Map(chantsCache.map((c) => [c.id, c] as const));
  const sections = buildSections(feuillet, chantsParId); // peut lever ChantIntrouvableHorsLigne

  const grille = construireGrille(!!feuillet.priere_active, !!feuillet.one_page_mode, feuillet.banniere_active !== false);
  const unitesNonMesurees = construireUnites(sections);

  const parametres = await lireParametresCache();
  const config = parametres?.donnees ?? {};
  const images = parametres?.images ?? {};

  async function assemblerEtEcrire(tailleTexte: number, styles: Record<NomStyle, StyleParagraphe>, assignation: Record<string, Unite[]>): Promise<ResultatPdfLocal> {
    const contenuPriereHtml = feuillet.priere_active ? construireContenuPriere(feuillet, styles, config) : null;
    const html = assemblerHtml({ feuillet, config, images, grille, assignation, styles, contenuPriereHtml });
    const { uri } = await Print.printToFileAsync({ html, width: LARGEUR_PT, height: HAUTEUR_PT, base64: false });
    return { uri, tailleTexte };
  }

  if (feuillet.taille_texte_manuelle != null) {
    const taille = Math.max(TAILLE_TEXTE, Math.min(TAILLE_TEXTE_PLAFOND, feuillet.taille_texte_manuelle));
    const { styles, assignation } = await testerTaille(bridge, unitesNonMesurees, sections, grille, taille);
    return assemblerEtEcrire(taille, styles, assignation);
  }

  let derniereErreur: DepassementImpossible | null = null;
  for (const tailleTexte of ECHELLES_CORPS) {
    let resultat: { styles: Record<NomStyle, StyleParagraphe>; assignation: Record<string, Unite[]> };
    try {
      resultat = await testerTaille(bridge, unitesNonMesurees, sections, grille, tailleTexte);
    } catch (exc) {
      if (exc instanceof DepassementImpossible) { derniereErreur = exc; continue; }
      throw exc;
    }
    return assemblerEtEcrire(tailleTexte, resultat.styles, resultat.assignation);
  }
  throw derniereErreur ?? new DepassementImpossible("Aucune taille de police ne convient.", []);
}

/** Enveloppe partagée par tous les écrans qui affichent/partagent un PDF de
 * feuillet (ComposerScreen, DepliantsScreen) : rendu 100% local ultra-rapide (< 500ms)
 * et 100% hors-ligne en priorité, avec repli sur le serveur uniquement si nécessaire. */
export async function obtenirPdfAvecRepliLocal(feuilletId: number, bridge: MeasurementBridgeHandle): Promise<PdfLocal> {
  try {
    const feuilletActuel = await getFeuillet(feuilletId);
    const resultat = await genererPdfFeuilletLocal(feuilletActuel, bridge);
    return { uri: resultat.uri };
  } catch (erreurLocale) {
    if (erreurLocale instanceof DepassementImpossible) throw erreurLocale;
    try {
      return await telechargerFeuilletPdf(feuilletId);
    } catch (erreurServeur) {
      throw erreurLocale || erreurServeur;
    }
  }
}
