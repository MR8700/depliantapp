// Point d'entrée unique du moteur de rendu PDF hors-ligne -- orchestre les
// modules portés de backend/app/render/*.py (zones, typography, model,
// layoutEngine, measure, widgets, pdfAssembler) + le pont de mesure
// (MeasurementBridge, WebView cachée) + expo-print pour la génération réelle
// du fichier. Reproduit fidèlement render_feuillet_pdf_auto (pdf.py) :
// balaie ECHELLES_CORPS du plus grand au plus petit, teste (mesure + essaie
// de distribuer) avant de dessiner, jamais de réduction chant par chant,
// jamais de 3e page.
import * as Print from "expo-print";
import * as FileSystem from "expo-file-system/legacy";
import { MeasurementBridgeHandle } from "../components/MeasurementBridge";
import { Feuillet } from "../types";
import { telechargerFeuilletPdf, getFeuillet, PdfLocal } from "../api/feuillets";
import { ApiError } from "../api/client";
import { lireCache } from "../storage/chantsCache";
import { listerChantsLocaux } from "../storage/chantsLocal";
import { lireParametresCache } from "../storage/parametresCache";
import { getLicenceLocale } from "../storage/secureStore";
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

// Print.printToFileAsync() rend le HTML dans un contexte isolé (WebView
// interne côté Android, UIPrintPageRenderer côté iOS) qui n'a PAS accès au
// système de fichiers de l'app pour résoudre des <img src="file://...">
// -- contrairement à MeasurementBridge (react-native-webview classique),
// l'image y reste silencieusement invisible, sans erreur ni avertissement,
// que l'appareil soit en ligne ou non (le PDF local "réussit" quand même,
// donc obtenirPdfAvecRepliLocal ne bascule jamais sur le réseau pour
// autant). Seule solution fiable : encoder l'image en data URI (base64),
// autonome et indépendant du bac à sable de fichiers.
async function fichierVersDataUri(uriFichier: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uriFichier, { encoding: FileSystem.EncodingType.Base64 });
  // Signature du contenu réellement décodé plutôt que l'extension du fichier
  // (téléchargé sous un nom générique "parametres_<slot>.img", voir
  // storage/parametresCache.ts) -- suffisant pour les deux formats produits
  // par le picker/upload de l'app (PNG depuis un export/capture, JPEG depuis
  // une photo). La plupart des moteurs de rendu sniffent de toute façon le
  // contenu réel d'une data URI, mais autant être exact.
  const type = base64.startsWith("iVBOR") ? "image/png" : base64.startsWith("/9j/") ? "image/jpeg" : "image/png";
  return `data:${type};base64,${base64}`;
}

async function imagesEnDataUri<T extends Record<string, string | undefined>>(images: T): Promise<T> {
  const resultat = { ...images };
  await Promise.all(
    (Object.keys(images) as (keyof T)[]).map(async (slot) => {
      const uri = images[slot];
      if (!uri) return;
      try {
        resultat[slot] = (await fichierVersDataUri(uri as string)) as T[keyof T];
      } catch {
        // Fichier illisible/disparu -- on retire plutôt que de garder un
        // file:// mort qui ne s'afficherait de toute façon pas.
        delete resultat[slot];
      }
    }),
  );
  return resultat;
}

// Un seul jeu de styles concrets par taille EFFECTIVE distincte rencontrée
// (normalement 2 : la taille de base, et base+supplément pour le chant
// ciblé -- voir measure.ts::UniteNonMesuree.supplement) -- mémoïsé pour ne
// pas recalculer construireStyles() une fois par unité.
function stylesPourTaille(cache: Map<number, Record<NomStyle, StyleParagraphe>>, taille: number): Record<NomStyle, StyleParagraphe> {
  let s = cache.get(taille);
  if (!s) { s = construireStyles(taille); cache.set(taille, s); }
  return s;
}

async function testerTaille(
  bridge: MeasurementBridgeHandle, unitesNonMesurees: UniteNonMesuree[], sections: Section[], grille: Grille, tailleTexteBase: number,
  feuillet: Feuillet, config: Record<string, any>,
): Promise<{ stylesBase: Record<NomStyle, StyleParagraphe>; assignation: Record<string, Unite[]> }> {
  const cache = new Map<number, Record<NomStyle, StyleParagraphe>>();
  const stylesBase = stylesPourTaille(cache, tailleTexteBase);
  const demandes = unitesNonMesurees.map((u) => {
    // Le supplément ne s'applique qu'au contenu du chant ciblé (voir
    // measure.ts) -- jamais au-delà du plafond, comme la taille de base
    // elle-même.
    const tailleEffective = u.supplement ? Math.min(TAILLE_TEXTE_PLAFOND, tailleTexteBase + u.supplement) : tailleTexteBase;
    const styleBase = stylesPourTaille(cache, tailleEffective)[u.nomStyle];
    const style = u.continuation ? { ...styleBase, marginTop: 0, marginBottom: 0 } : styleBase;
    return { html: u.html, style };
  });
  const hauteurs = await bridge.mesurer(demandes, LARGEUR_COLONNE_MM);
  const unites: Unite[] = unitesNonMesurees.map((u, i) => ({
    html: u.html, nomStyle: u.nomStyle, style: demandes[i].style, hauteur: hauteurs[i], sectionOrdre: u.sectionOrdre, nature: u.nature,
  }));
  const engine = new LayoutEngine(grille.flowOrder);
  const assignation = engine.distribuer(unites, sections); // lève DepassementImpossible si ça ne rentre pas
  if (feuillet.priere_active) {
    const zonePriere = grille.toutes[feuillet.one_page_mode ? "C2" : "G2"];
    const htmlPriere = construireContenuPriere(feuillet, stylesBase, config);
    const [hauteurPriere] = await bridge.mesurer(
      [{ html: htmlPriere, style: stylesBase.priere_corps }],
      zonePriere.largeur - 2 * zonePriere.padding,
    );
    if (hauteurPriere > zonePriere.hauteur - 2 * zonePriere.padding) {
      throw new DepassementImpossible(
        "La prière pour le Burkina Faso ne tient pas dans sa colonne. Réduis la taille du texte ou raccourcis la prière.",
        ["Prière pour le Burkina Faso"],
      );
    }
  }
  return { stylesBase, assignation };
}

/** Génère le PDF d'un feuillet entièrement sur l'appareil, sans réseau.
 * `bridge` doit être le ref d'un <MeasurementBridge/> monté par l'écran
 * appelant (voir ComposerScreen.tsx/DepliantsScreen.tsx). */
export async function genererPdfFeuilletLocal(feuillet: Feuillet, bridge: MeasurementBridgeHandle): Promise<ResultatPdfLocal> {
  // Compte chorale (licence locale) : bibliothèque de chants 100% locale
  // (voir storage/chantsLocal.ts) -- storage/chantsCache.ts reste vide pour
  // ce compte (c'est le cache réseau du super-admin, jamais alimenté par
  // une chorale). Sans cette branche, un feuillet chorale se rendrait avec
  // TOUS ses chants marqués introuvables.
  const licence = await getLicenceLocale();
  const bibliothequeChants = licence ? await listerChantsLocaux() : await lireCache();
  const chantsParId = new Map(bibliothequeChants.map((c) => [c.id, c] as const));
  const sections = buildSections(feuillet, chantsParId); // peut lever ChantIntrouvableHorsLigne

  const grille = construireGrille(!!feuillet.priere_active, !!feuillet.one_page_mode, feuillet.banniere_active !== false);
  const unitesNonMesurees = construireUnites(sections);

  const parametres = await lireParametresCache();
  const config = parametres?.donnees ?? {};
  const images = await imagesEnDataUri(parametres?.images ?? {});

  async function assemblerEtEcrire(tailleTexte: number, styles: Record<NomStyle, StyleParagraphe>, assignation: Record<string, Unite[]>): Promise<ResultatPdfLocal> {
    const contenuPriereHtml = feuillet.priere_active ? construireContenuPriere(feuillet, styles, config) : null;
    const html = assemblerHtml({ feuillet, config, images, grille, assignation, contenuPriereHtml });
    const { uri } = await Print.printToFileAsync({ html, width: LARGEUR_PT, height: HAUTEUR_PT, base64: false });
    return { uri, tailleTexte };
  }

  // Chant(s) avec un agrandissement ciblé actif -- sert uniquement à clarifier
  // le message d'erreur si le feuillet ne tient plus (voir plus bas), pas au
  // calcul lui-même (déjà géré unité par unité dans testerTaille).
  const sectionsAvecSupplement = sections.filter((s) => s.song.tailleTexteSupplement > 0);

  if (feuillet.taille_texte_manuelle != null) {
    const taille = Math.max(TAILLE_TEXTE, Math.min(TAILLE_TEXTE_PLAFOND, feuillet.taille_texte_manuelle));
    const { stylesBase, assignation } = await testerTaille(bridge, unitesNonMesurees, sections, grille, taille, feuillet, config);
    return assemblerEtEcrire(taille, stylesBase, assignation);
  }

  let derniereErreur: DepassementImpossible | null = null;
  for (const tailleTexte of ECHELLES_CORPS) {
    let resultat: { stylesBase: Record<NomStyle, StyleParagraphe>; assignation: Record<string, Unite[]> };
    try {
      resultat = await testerTaille(bridge, unitesNonMesurees, sections, grille, tailleTexte, feuillet, config);
    } catch (exc) {
      if (exc instanceof DepassementImpossible) { derniereErreur = exc; continue; }
      throw exc;
    }
    return assemblerEtEcrire(tailleTexte, resultat.stylesBase, resultat.assignation);
  }
  if (derniereErreur && sectionsAvecSupplement.length > 0) {
    const noms = sectionsAvecSupplement.map((s) => s.song.titre || s.label).join(", ");
    throw new DepassementImpossible(
      `${derniereErreur.message} L'agrandissement ciblé de « ${noms} » y contribue probablement -- réduis-le ou retire-le si besoin.`,
      derniereErreur.momentsEnCause,
    );
  }
  throw derniereErreur ?? new DepassementImpossible("Aucune taille de police ne convient.", []);
}

/** Enveloppe partagée par tous les écrans qui affichent/partagent un PDF de
 * feuillet (ComposerScreen, DepliantsScreen) : rendu 100% local ultra-rapide
 * (< 500ms). Compte chorale (licence locale) : JAMAIS de repli serveur --
 * même si le rendu local échoue de façon inattendue, tenter le réseau
 * enfreindrait la règle "100% hors-ligne, sauf Messagerie" (une chorale
 * dont l'appareil a par ailleurs du réseau, ex. pour la Messagerie,
 * verrait sinon sa génération PDF repartir en silence côté serveur).
 * Compte super-admin (toujours en ligne) : repli sur le serveur conservé,
 * comportement inchangé. */
export async function obtenirPdfAvecRepliLocal(feuilletId: number, bridge: MeasurementBridgeHandle): Promise<PdfLocal> {
  const licenceLocale = await getLicenceLocale();
  try {
    const feuilletActuel = await getFeuillet(feuilletId);
    const resultat = await genererPdfFeuilletLocal(feuilletActuel, bridge);
    return { uri: resultat.uri };
  } catch (erreurLocale) {
    if (erreurLocale instanceof DepassementImpossible || licenceLocale) throw erreurLocale;
    try {
      return await telechargerFeuilletPdf(feuilletId);
    } catch (erreurServeur) {
      throw erreurLocale || erreurServeur;
    }
  }
}
