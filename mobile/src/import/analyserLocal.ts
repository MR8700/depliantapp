import { lireParagraphesDocx } from "./parseDocx";
import { lireParagraphesPdf } from "./parsePdf";
import { segmenterParagraphesDocx } from "./segmentation";
import { detecterLangueLocal } from "./detecterLangue";
import { lireCache } from "../storage/chantsCache";
import { listerChantsLocaux } from "../storage/chantsLocal";
import { getLicenceLocale } from "../storage/secureStore";
import { normaliserTitre } from "../utils/normaliserTitre";
import { ChantExtrait, ReponseUpload } from "../api/import";

/** Analyse locale DOCX/PDF : dézippage ou extraction puis segmentation.
 * Prend en charge la détection automatique de la langue et des moments liturgiques. */
type ParametresAnalyse = { categorieDefaut: string; occasions: string; langue: string; auteur: string };

const REGLES_MOMENTS_LOCALES: [RegExp, string][] = [
  [/\b(kyrie\s+eleison|prends\s+pitie|christe\s+eleison|miserere\s+nobis|mokonzi\s+yoka\s+mawa)\b/i, "Kyrie"],
  [/\b(gloria\s+in\s+excelsis|gloire\s+a\s+dieu|kembo\s+na\s+nzambe|in\s+terra\s+pax)\b/i, "Gloria"],
  [/\b(sanctus|saint\s+le\s+seigneur|dieu\s+de\s+l\s*univers|hosanna\s+au\s+plus\s+haut|dominus\s+deus\s+sabaoth|mosantu\s+mosantu)\b/i, "Sanctus"],
  [/\b(anamnese|mystere\s+de\s+la\s+foi|proclamons\s+ta\s+mort|christ\s+est\s+venu)\b/i, "Anamnese"],
  [/\b(notre\s+pere|pater\s+noster|qui\s+es\s+aux\s+cieux|panem\s+nostrum|tata\s+wa\s+biso)\b/i, "Notre_Pere"],
  [/\b(agneau\s+de\s+dieu|agnus\s+dei|qui\s+enleves\s+le\s+peche|tollis\s+peccata|mwana\s+mpate|dona\s+nobis\s+pacem)\b/i, "Agnus"],
  [/\b(alleluia|all[eé]luia|acclamation|aleluya)\b/i, "Acclamation"],
  [/\b(credo|je\s+crois\s+en\s+un\s+seul\s+dieu|profession\s+de\s+foi|credo\s+in\s+unum)\b/i, "Credo"],
  [/\b(priere\s+universelle|entends\s+nos\s+prieres|exauce[\s\-]nous)\b/i, "Priere_universelle"],
  [/\b(offrande|voici\s+nos\s+dons|recois\s+seigneur|pain\s+et\s+le?\s*vin|fruit\s+de\s+la\s+terre)\b/i, "Offertoire"],
  [/\b(pain\s+vivant|pain\s+de\s+vie|corps\s+du\s+christ|mangez\s+et\s+buvez|table\s+du\s+banquet|communion|panis\s+angelicus|corpus\s+christi)\b/i, "Communion"],
  [/\b(action\s+de\s+grace|rendons\s+grace|merci\s+seigneur)\b/i, "Action_de_grace"],
  [/\b(allez\s+dans\s+la\s+paix|envoyes\s+dans\s+le\s+monde|chant\s+d\s*envoi|bonne\s+nouvelle)\b/i, "Sortie"],
  [/\b(ave\s+maria|je\s+vous\s+salue\s+marie|vierge\s+marie|sainte\s+mere|reine\s+du\s+ciel|magnificat|salve\s+regina)\b/i, "Marial"],
  [/\b(psaume|le\s+seigneur\s+est\s+mon\s+berger|graduel)\b/i, "Psaume"],
  [/\b(peuple\s+de\s+dieu|chantez\s+au\s+seigneur|nous\s+marchons|entrons\s+dans\s+sa\s+maison)\b/i, "Entree"],
];

function suggererCategorieLocale(titre: string, refrain: string | null, couplets: string[]): string | null {
  const texte = `${titre} ${refrain || ""} ${couplets.join(" ")}`;
  for (const [re, cat] of REGLES_MOMENTS_LOCALES) {
    if (re.test(texte)) return cat;
  }
  return null;
}

async function analyserParagraphesLocaux(
  paragraphes: string[],
  nomFichier: string,
  params: ParametresAnalyse,
): Promise<ReponseUpload> {
  const chantsBruts = segmenterParagraphesDocx(paragraphes);

  const occasionsListe = params.occasions.split(",").map((o) => o.trim()).filter(Boolean);
  const licence = await getLicenceLocale();
  const bibliotheque = licence ? await listerChantsLocaux() : await lireCache();
  const indexParTitre = new Map<string, { id: number; titre: string }>();
  for (const c of bibliotheque) indexParTitre.set(normaliserTitre(c.titre), { id: c.id, titre: c.titre });

  const chants: ChantExtrait[] = chantsBruts.map((raw) => {
    const doublon = indexParTitre.get(normaliserTitre(raw.titre));

    let cat = raw.categorieDetectee;
    if (!cat || cat === "Autre" || cat === params.categorieDefaut) {
      cat = suggererCategorieLocale(raw.titre, raw.refrain, raw.couplets) || raw.categorieDetectee || params.categorieDefaut || "Autre";
    }

    const langueChant = detecterLangueLocal(raw.titre, raw.refrain, raw.couplets, params.langue || "fr");
    const occasionsChant = [...occasionsListe];
    if (cat === "Marial" && !occasionsChant.includes("Marial")) {
      occasionsChant.push("Marial");
    }

    return {
      titre: raw.titre,
      refrain: raw.refrain || "",
      couplets: raw.couplets,
      code_reference: raw.codeReference,
      confiance: raw.confiance,
      categorie: cat,
      occasions: occasionsChant,
      langue: langueChant,
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

export async function analyserPdfLocal(
  uri: string,
  nomFichier: string,
  params: ParametresAnalyse,
): Promise<ReponseUpload> {
  const paragraphes = await lireParagraphesPdf(uri);
  return analyserParagraphesLocaux(paragraphes, nomFichier, params);
}
