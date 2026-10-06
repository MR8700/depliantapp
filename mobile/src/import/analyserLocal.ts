import { lireParagraphesDocx } from "./parseDocx";
import { lireParagraphesPdf } from "./parsePdf";
import { segmenterParagraphesDocx } from "./segmentation";
import { lireCache } from "../storage/chantsCache";
import { listerChantsLocaux } from "../storage/chantsLocal";
import { getLicenceLocale } from "../storage/secureStore";
import { normaliserTitre } from "../utils/normaliserTitre";
import { ChantExtrait, ReponseUpload } from "../api/import";

/** Analyse locale DOCX/PDF : dézippage ou extraction puis segmentation.
 * La détection de doublons ici est
 * VOLONTAIREMENT plus simple que côté serveur (correspondance de titre
 * EXACTE après normalisation, pas une similarité floue) -- elle ne fait
 * que suggérer, la chorale reste libre de choisir "remplacer"/"ignorer"
 * comme pour un import en ligne ; une fois reconnectée, une synchronisation
 * normale recoupera de toute façon avec la bibliothèque complète. */
type ParametresAnalyse = { categorieDefaut: string; occasions: string; langue: string; auteur: string };

async function analyserParagraphesLocaux(
  paragraphes: string[],
  nomFichier: string,
  params: ParametresAnalyse,
): Promise<ReponseUpload> {
  const chantsBruts = segmenterParagraphesDocx(paragraphes);

  const occasionsListe = params.occasions.split(",").map((o) => o.trim()).filter(Boolean);
  // Compte chorale (licence locale) : dédoublonnage contre la bibliothèque
  // locale (voir storage/chantsLocal.ts). Compte super-admin : contre le
  // cache réseau (storage/chantsCache.ts), comme avant.
  const licence = await getLicenceLocale();
  const bibliotheque = licence ? await listerChantsLocaux() : await lireCache();
  const indexParTitre = new Map<string, { id: number; titre: string }>();
  for (const c of bibliotheque) indexParTitre.set(normaliserTitre(c.titre), { id: c.id, titre: c.titre });

  const chants: ChantExtrait[] = chantsBruts.map((raw) => {
    const doublon = indexParTitre.get(normaliserTitre(raw.titre));
    return {
      titre: raw.titre,
      refrain: raw.refrain || "",
      couplets: raw.couplets,
      code_reference: raw.codeReference,
      confiance: raw.confiance,
      categorie: raw.categorieDetectee || params.categorieDefaut,
      occasions: occasionsListe,
      langue: params.langue,
      auteur: params.auteur || null,
      doublons: doublon ? [{ id: doublon.id, titre: doublon.titre, similarite: 1.0 }] : [],
      avertissements: raw.avertissements,
    };
  });

  return { fichier: nomFichier, chants };
}

export async function analyserDocxLocal(
  uri: string,
  nomFichier: string,
  params: ParametresAnalyse,
): Promise<ReponseUpload> {
  return analyserParagraphesLocaux(await lireParagraphesDocx(uri), nomFichier, params);
}

/** Même segmentation locale que DOCX, après extraction du texte du PDF. */
export async function analyserPdfLocal(
  uri: string, nomFichier: string,
  params: ParametresAnalyse,
): Promise<ReponseUpload> {
  const paragraphes = await lireParagraphesPdf(uri);
  // On réutilise le pipeline DOCX : il ne dépend que d'une liste de lignes.
  const temporaire = await analyserParagraphesLocaux(paragraphes, nomFichier, params);
  return temporaire;
}
