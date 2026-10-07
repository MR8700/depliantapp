// Port TypeScript de backend/app/ingestion/common.py
// Couvre l'analyse et la segmentation hors-ligne pour l'application mobile.

export interface RawChant {
  titre: string;
  refrain: string | null;
  couplets: string[];
  codeReference: string | null;
  confiance: number;
  avertissements: string[];
  categorieDetectee: string | null;
}

const REF_RE = /^\s*(R[ée]f(?:rain)?\.?\s*\d*|R\s*\/[\.:\-]?|R\b|\(R[ée]f(?:rain)?\s*\d*\)|\(R\)|Ant(?:ienne)?\.?\s*\d*|\(Ant(?:ienne)?\s*\d*\)|Ch[oœ]ur|Tous|Assembl[ée]e|Ch\s*\/)\s*[:;/.\-)]?\s*(.*)$/i;
const VERSE_RE = /^\s*(?:(?:Couplet|Strophe|Verset|C\.|v\.)\s*)?(\d+(?:\s*(?:&|,|\-)\s*\d+)*|[IVXivx]+|V\s*\/?)\s*[.\-)–—:/]\s*(.+)$/i;
const CODE_REFERENCE_RE = /^([A-Z]{1,2}\s?\d{1,3}\s?[a-z]?)\s+(.+)$/;
const CODED_TITLE_RE = /^([A-ZÀÂÉÈÊËÎÏÔÙÛÜÇ]{2,25})\s*(\d{0,3})\s*(?:[:.\-]\s*(.*))?$/i;

const SECTION_MOMENTS_MAP: Record<string, string> = {
  ENTREE: "Entree", "ENTREE DE LA MESSE": "Entree", OUVERTURE: "Entree",
  "CHANT D ENTREE": "Entree", "CHANTS D ENTREE": "Entree", "CHANTS D OUVERTURE": "Entree",
  KYRIE: "Kyrie", "KYRIE ELEISON": "Kyrie", "ACTE PENITENTIEL": "Kyrie",
  "PRENDS PITIE": "Kyrie", PENITENCE: "Kyrie",
  GLORIA: "Gloria", "GLOIRE A DIEU": "Gloria", "HYMNE DE LOUANGE": "Gloria",
  PSAUME: "Psaume", PSAUMES: "Psaume", "PSAUME RESPONSORIAL": "Psaume",
  GRADUEL: "Psaume", GRADUELS: "Psaume",
  ACCLAMATION: "Acclamation", ACCLAMATIONS: "Acclamation", ALLELUIA: "Acclamation",
  "ACCLAMATION DE L EVANGILE": "Acclamation", EVANGILE: "Acclamation",
  CREDO: "Credo", "PROFESSION DE FOI": "Credo", "SYMBOLE DES APOTRES": "Credo",
  "PRIERE UNIVERSELLE": "Priere_universelle", "PRIERES UNIVERSELLES": "Priere_universelle",
  PU: "Priere_universelle", INTENTIONS: "Priere_universelle",
  OFFERTOIRE: "Offertoire", OFFERTOIRES: "Offertoire", "PRESENTATION DES DONS": "Offertoire",
  QUETE: "Offertoire", OFFRANDE: "Offertoire", OFFRANDES: "Offertoire", "CHANTS D OFFERTOIRE": "Offertoire",
  SANCTUS: "Sanctus", SAINT: "Sanctus", "SAINT LE SEIGNEUR": "Sanctus",
  ANAMNESE: "Anamnese", "MYSTERE DE LA FOI": "Anamnese",
  "NOTRE PERE": "Notre_Pere", PATER: "Notre_Pere", "PATER NOSTER": "Notre_Pere",
  AGNUS: "Agnus", "AGNUS DEI": "Agnus", "AGNEAU DE DIEU": "Agnus", "FRACTION DU PAIN": "Agnus",
  COMMUNION: "Communion", COMMUNIONS: "Communion", "CHANTS DE COMMUNION": "Communion", "CHANT DE COMMUNION": "Communion",
  "ACTION DE GRACE": "Action_de_grace", "ACTIONS DE GRACE": "Action_de_grace",
  REMERCIEMENT: "Action_de_grace", REMERCIEMENTS: "Action_de_grace", "POST COMMUNION": "Action_de_grace",
  SORTIE: "Sortie", SORTIES: "Sortie", "CHANTS DE SORTIE": "Sortie", "CHANT DE SORTIE": "Sortie",
  ENVOI: "Sortie", ENVOIS: "Sortie", "CHANT D ENVOI": "Sortie", "CHANTS D ENVOI": "Sortie",
  "ENVOI ET MISSION": "Sortie", "CHANT FINAL": "Sortie",
  MARIAL: "Marial", MARIAUX: "Marial", "CHANTS MARIAUX": "Marial", "CHANT MARIAL": "Marial",
  MARIE: "Marial", "VIERGE MARIE": "Marial", "SAINTE VIERGE": "Marial", "CHANTS A MARIE": "Marial",
  AVENT: "Avent", "TEMPS DE L AVENT": "Avent",
  NOEL: "Noel", "TEMPS DE NOEL": "Noel",
  CAREME: "Careme", "TEMPS DU CAREME": "Careme", PASSION: "Careme", "SEMAINE SAINTE": "Careme",
  PAQUES: "Paques", "TEMPS PASCAL": "Paques", RESURRECTION: "Paques",
  MARIAGE: "Mariage", MARIAGES: "Mariage",
  DEFUNTS: "Defunts", OBSEQUES: "Defunts",
  BAPTEME: "Bapteme_Confirmation", CONFIRMATION: "Bapteme_Confirmation", "BAPTEME ET CONFIRMATION": "Bapteme_Confirmation",
};

const CODED_TITLE_CATEGORIES: Record<string, string> = {
  ...SECTION_MOMENTS_MAP,
  ACCLAMTION: "Acclamation",
  PRIERE: "Priere_universelle",
};

const TITRE_LONGUEUR_SUSPECTE = 60;
const LONGUEUR_ANORMALE = 500;

const DIACRITIQUES_RE = new RegExp("[\\u0300-\\u036f]", "g");
const PREFIX_DECO_RE = /^(?:[0-9]+|[IVXivx]+|[A-Za-z])\s*[.\-)–—:]\s*|^[=\-*#_\[\]]{2,}\s*|\s*[=\-*#_\[\]]{2,}$/;

function normaliserAccents(texte: string): string {
  return texte.normalize("NFKD").replace(DIACRITIQUES_RE, "");
}

function normaliserSection(texte: string): string {
  return normaliserAccents(texte || "")
    .toUpperCase()
    .replace(/['’`´]/g, " ")
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchSectionHeader(ligne: string): string | null {
  const raw = ligne.trim();
  if (!raw || raw.length > 55) return null;
  const hasDeco = PREFIX_DECO_RE.test(raw);
  const cleanedNoDeco = raw.replace(/^[=\-*#_\[\]:()]+|[=\-*#_\[\]:()]+$/g, "").trim();
  const hadPrefix = /^(?:[0-9]+|[IVXivx]+|[A-Za-z])\s*[.\-)–—:]\s*/.test(cleanedNoDeco);
  const cleaned = cleanedNoDeco.replace(/^(?:[0-9]+|[IVXivx]+|[A-Za-z])\s*[.\-)–—:]\s*/, "").trim();
  const norm = normaliserSection(cleaned);

  if (SECTION_MOMENTS_MAP[norm]) {
    if (["PRENDS PITIE", "ALLELUIA", "SAINT", "MARIE"].includes(norm) && !(hadPrefix || hasDeco || raw === raw.toUpperCase())) {
      return null;
    }
    return SECTION_MOMENTS_MAP[norm];
  }

  // Correspondance préfixée UNIQUEMENT pour les lignes qui sont de réels en-têtes
  // (majuscules, numérotation, décorations, ou mots-clés "Chants de...") pour ne jamais
  // confondre une phrase de chant ordinaire avec un en-tête de section.
  const isHeading = hadPrefix || hasDeco || raw === raw.toUpperCase() || norm.startsWith("CHANTS D ") || norm.startsWith("CHANTS DE ") || norm.startsWith("CHANT D ") || norm.startsWith("CHANT DE ") || norm.startsWith("TEMPS DE ") || norm.startsWith("TEMPS DU ");
  if (isHeading) {
    for (const [k, cat] of Object.entries(SECTION_MOMENTS_MAP)) {
      if (norm.startsWith(`${k} `) && !["PRENDS PITIE", "ALLELUIA", "SAINT", "MARIE"].includes(k)) {
        return cat;
      }
      if (norm.endsWith(` ${k}`)) {
        return cat;
      }
    }
  }

  return null;
}

function matchCodedTitle(ligne: string): { categorie: string; titre: string } | null {
  const cleaned = ligne.trim();
  const m = CODED_TITLE_RE.exec(cleaned);
  if (!m) return null;
  const catRaw = normaliserSection(m[1]);
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

/** Segmente une liste de paragraphes en chants individuels avec gestion des moments de section. */
export function segmenterParagraphesDocx(paragraphs: string[]): RawChant[] {
  const chants: RawChant[] = [];

  let titreCourant: string | null = null;
  let categorieSection: string | null = null;
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

    const catFinale = categorieCourante || categorieSection;
    const chant: RawChant = {
      titre: titreCourant || "(sans titre)",
      refrain: null,
      couplets: [],
      codeReference: null,
      confiance: 1.0,
      avertissements: [],
      categorieDetectee: catFinale,
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

    let refConfiance = 1.0;
    if (refParts.length) {
      chant.refrain = refParts.join(" / ");
    } else if (blocks.length >= 2) {
      // Détection refrain implicite : bloc répété ou première strophe non numérotée courte
      const nonNumerotes = blocks.filter((b) => b.type !== "ref" && !b.num);
      if (nonNumerotes.length > 0 && nonNumerotes[0].lignes.join(" ").length <= 220) {
        const candidat = nonNumerotes[0].lignes.join(" / ");
        chant.refrain = candidat;
        refConfiance = 0.6;
        const idx = couplets.indexOf(candidat);
        if (idx !== -1) couplets.splice(idx, 1);
      }
    }

    chant.couplets = couplets;
    chant.confiance = calculerConfiance(chant, refConfiance, blocks.some((b) => b.type === "couplet" && b.num));
    chants.push(finaliser(chant));

    titreCourant = null;
    // On conserve la catégorie de section pour tous les chants suivants
    categorieCourante = categorieSection;
    blocks = [];
    blockFinished = false;
  }

  for (const pRaw of paragraphs) {
    const pClean = pRaw.trim();
    if (!pClean) {
      blockFinished = true;
      continue;
    }

    const secCat = matchSectionHeader(pClean);
    if (secCat) {
      flushSong();
      categorieSection = secCat;
      categorieCourante = secCat;
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
      const texteRef = refM[2]?.trim();
      currentBlock = { type: "ref", num: null, lignes: texteRef ? [texteRef] : [] };
      blockFinished = false;
    } else if (verseM) {
      if (currentBlock) blocks.push(currentBlock);
      const numCouplet = verseM[1];
      const texteCouplet = verseM[2]?.trim();
      currentBlock = { type: "couplet", num: numCouplet, lignes: texteCouplet ? [texteCouplet] : [] };
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
