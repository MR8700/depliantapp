// Port TypeScript de backend/app/ingestion/common.py::segment_paragraphs_docx_clean
// (et SEULEMENT cette variante -- pas le moteur générique à 700 lignes,
// utilisé côté serveur uniquement pour le PDF, hors périmètre ici) : les
// imports DOCX/DOC passent tous les deux par `is_clean_paragraphs=True`
// côté serveur (backend/app/ingestion/generic.py), donc par CETTE fonction,
// jamais l'autre -- la porter fidèlement suffit à couvrir l'import DOCX
// hors-ligne à l'identique du serveur, sans le risque d'un portage partiel
// du moteur générique (voir memory : le PDF reste analysé en ligne).
//
// Toute divergence avec common.py doit être reportée ici ET là-bas.

export interface RawChant {
  titre: string;
  refrain: string | null;
  couplets: string[];
  codeReference: string | null;
  confiance: number;
  avertissements: string[];
  categorieDetectee: string | null;
}

const REF_RE = /^\s*(R[ée]f(?:rain)?\.?\s*\d*|R)\s*[:;]\s*(.*)$/i;
const VERSE_RE = /^\s*(\d+(?:\s*&\s*\d+)*|[IVXivx]+)\s*[.\-)–—:]\s*(.+)$/;
const CODE_REFERENCE_RE = /^([A-Z]{1,2}\s?\d{1,3}\s?[a-z]?)\s+(.+)$/;
const SECTION_HEAD_RE = /^[A-Z]\.?\s*([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ ]{3,30})$/;
const CODED_TITLE_RE = /^([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ]{2,25})\s*(\d{0,3})\s*(?:[:.\-]\s*(.*))?$/i;

const SECTION_KEYWORDS = new Set([
  "ENTREE", "ENTRÉE", "KYRIE", "PRENDS PITIE", "PRENDS PITIÉ", "GLORIA", "PSAUME",
  "ALLELUIA", "ALLÉLUIA", "ACCLAMATION", "CREDO", "PRIERE UNIVERSELLE", "PRIÈRE UNIVERSELLE",
  "PU", "OFFERTOIRE", "SANCTUS", "ANAMNESE", "ANAMNÈSE", "NOTRE PERE", "NOTRE PÈRE",
  "PATER", "AGNUS", "COMMUNION", "ACTION DE GRACE", "ACTION DE GRÂCE", "SORTIE",
  "CHANTS MARIAUX", "MARIAUX",
]);

const CODED_TITLE_CATEGORIES: Record<string, string> = {
  ENTREE: "Entree", KYRIE: "Kyrie", GLORIA: "Gloria", PSAUME: "Psaume",
  ACCLAMATION: "Acclamation", ACCLAMTION: "Acclamation", ALLELUIA: "Acclamation",
  CREDO: "Credo", "PRIERE UNIVERSELLE": "Priere_universelle", PU: "Priere_universelle",
  PRIERE: "Priere_universelle", OFFERTOIRE: "Offertoire", SANCTUS: "Sanctus",
  ANAMNESE: "Anamnese", "NOTRE PERE": "Notre_Pere", PATER: "Notre_Pere", AGNUS: "Agnus",
  COMMUNION: "Communion", "ACTION DE GRACE": "Action_de_grace", SORTIE: "Sortie",
  NOEL: "Noel", CAREME: "Careme", AVENT: "Avent", PAQUES: "Paques", MARIAGE: "Mariage",
  DEFUNTS: "Defunts", BAPTEME: "Bapteme_Confirmation",
};

const TITRE_LONGUEUR_SUSPECTE = 60;
const LONGUEUR_ANORMALE = 500;

const DIACRITIQUES_RE = new RegExp("[\\u0300-\\u036f]", "g");

function normaliserAccents(texte: string): string {
  return texte.normalize("NFKD").replace(DIACRITIQUES_RE, "");
}

function estLigneSection(ligne: string): boolean {
  const cleaned = ligne.trim().toUpperCase().replace(/[:.]+$/, "");
  if (SECTION_KEYWORDS.has(cleaned)) return true;
  const m = SECTION_HEAD_RE.exec(cleaned);
  if (m) {
    const val = m[1].trim();
    if (SECTION_KEYWORDS.has(val) || SECTION_KEYWORDS.has(val.replace(/ /g, ""))) return true;
  }
  return false;
}

function matchCodedTitle(ligne: string): { categorie: string; titre: string } | null {
  const cleaned = ligne.trim();
  const m = CODED_TITLE_RE.exec(cleaned);
  if (!m) return null;
  const catRaw = normaliserAccents(m[1]).toUpperCase();
  const categorie = CODED_TITLE_CATEGORIES[catRaw];
  if (!categorie) return null;
  const number = m[2] || "";
  let reste = (m[3] || "").trim();
  reste = reste.replace(/^[«"'\s]+|[»"'\s]+$/g, "");
  if (reste.includes("..") || reste.includes("…")) return null;
  const sansPonctuation = reste.replace(/[.\s\d]/g, "");
  let titre: string;
  if (sansPonctuation.length < 2) {
    const capitalise = m[1].trim().charAt(0).toUpperCase() + m[1].trim().slice(1).toLowerCase();
    titre = number ? `${capitalise} ${number}` : capitalise;
  } else {
    titre = reste;
  }
  return { categorie, titre };
}

function estTitreMajuscules(texte: string): boolean {
  const lettres = [...texte].filter((c) => /\p{L}/u.test(c));
  return texte.length <= 60 && lettres.length >= 3 && lettres.every((c) => c === c.toUpperCase());
}

function extraireCodeReference(titre: string): { code: string | null; titre: string } {
  const m = CODE_REFERENCE_RE.exec(titre);
  if (m) return { code: m[1].trim(), titre: m[2].trim() };
  return { code: null, titre };
}

function calculerConfiance(chant: RawChant, refrainConfiance: number, avaitNumerotation: boolean): number {
  let base: number;
  if (chant.refrain && chant.couplets.length) {
    base = refrainConfiance >= 0.95 ? 1.0 : Math.max(0.6, refrainConfiance);
  } else if (chant.couplets.length >= 2) {
    base = avaitNumerotation ? 0.95 : 0.6;
  } else if (chant.refrain || chant.couplets.length) {
    base = 0.5;
  } else {
    base = 0.3;
  }

  if (chant.refrain && chant.refrain.length > LONGUEUR_ANORMALE) {
    base = Math.min(base, 0.35);
    chant.avertissements.push("Refrain anormalement long — probable fusion de plusieurs couplets.");
  }
  for (const c of chant.couplets) {
    if (c.length > LONGUEUR_ANORMALE) {
      base = Math.min(base, 0.35);
      chant.avertissements.push("Un couplet anormalement long — probable fusion de plusieurs couplets.");
      break;
    }
  }
  if (chant.titre.length > TITRE_LONGUEUR_SUSPECTE) {
    base = Math.min(base, 0.4);
    chant.avertissements.push("Titre anormalement long — probablement plusieurs paragraphes fusionnés à tort.");
  }
  return Math.round(base * 100) / 100;
}

function finaliser(chant: RawChant): RawChant {
  const { code, titre } = extraireCodeReference(chant.titre);
  chant.titre = titre;
  chant.codeReference = code;
  return chant;
}

type Bloc = { type: "ref" | "couplet"; num: string | null; lignes: string[] };

/** Port fidèle de segment_paragraphs_docx_clean (common.py). */
export function segmenterParagraphesDocx(paragraphs: string[]): RawChant[] {
  const chants: RawChant[] = [];

  let titreCourant: string | null = null;
  let categorieCourante: string | null = null;
  let blocks: Bloc[] = [];
  let currentBlock: Bloc | null = null;
  let blockFinished = false;

  function flushSong() {
    if (currentBlock) {
      blocks.push(currentBlock);
      currentBlock = null;
    }
    if (titreCourant === null && blocks.length === 0) return;

    const chant: RawChant = {
      titre: titreCourant || "(sans titre)",
      refrain: null,
      couplets: [],
      codeReference: null,
      confiance: 1.0,
      avertissements: [],
      categorieDetectee: categorieCourante,
    };

    const refParts: string[] = [];
    const couplets: string[] = [];
    for (const b of blocks) {
      const texte = b.lignes.join(" / ");
      if (b.type === "ref") {
        refParts.push(texte);
      } else if (b.num) {
        couplets.push(`${b.num}- ${texte}`);
      } else {
        couplets.push(texte);
      }
    }
    if (refParts.length) chant.refrain = refParts.join(" / ");
    chant.couplets = couplets;
    chant.confiance = calculerConfiance(chant, 1.0, blocks.some((b) => b.type === "couplet" && b.num));
    chants.push(finaliser(chant));

    titreCourant = null;
    categorieCourante = null;
    blocks = [];
    blockFinished = false;
  }

  for (const pRaw of paragraphs) {
    const pClean = pRaw.trim();
    if (!pClean) {
      blockFinished = true;
      continue;
    }

    if (estLigneSection(pClean)) {
      flushSong();
      continue;
    }

    const coded = matchCodedTitle(pClean);
    if (coded) {
      flushSong();
      categorieCourante = coded.categorie;
      titreCourant = coded.titre;
      continue;
    }

    if (estTitreMajuscules(pClean)) {
      flushSong();
      titreCourant = pClean;
      continue;
    }

    if (titreCourant === null) titreCourant = "(sans titre)";

    const refM = REF_RE.exec(pClean);
    const verseM = VERSE_RE.exec(pClean);

    if (refM) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = { type: "ref", num: null, lignes: [refM[2].trim()] };
      blockFinished = false;
    } else if (verseM) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = { type: "couplet", num: verseM[1], lignes: [verseM[2].trim()] };
      blockFinished = false;
    } else if (currentBlock && !blockFinished) {
      currentBlock.lignes.push(pClean);
    } else {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = { type: "couplet", num: null, lignes: [pClean] };
      blockFinished = false;
    }
  }

  flushSong();
  return chants;
}
