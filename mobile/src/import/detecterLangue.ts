/**
 * Détection automatique de la langue des chants pour l'import local/hors-ligne.
 * Port TypeScript fidèle de backend/app/ml/languages.py.
 */

const TAGS_TITRE: [RegExp, string][] = [
  [/\b(dioula|djula)\b/i, "dioula"],
  [/\b(bissa|bisa)\b/i, "bissa"],
  [/\b(gulmancema|gulmatchema|gourmantche)\b/i, "gulmancema"],
  [/\b(dagara|dagari)\b/i, "dagara"],
  [/\b(moore|moor[eé]|mor[eé])\b/i, "moore"],
  [/\b(latin|latine?)\b/i, "la"],
  [/\b(lingala)\b/i, "lingala"],
  [/\b(swahili|kiswahili)\b/i, "sw"],
  [/\b(kikongo|kingongo)\b/i, "kikongo"],
  [/\b(anglais|english)\b/i, "en"],
  [/\b(espagnol|spanish)\b/i, "es"],
  [/\b(francais|fran[cç]ais)\b/i, "fr"],
];

const FORMULES_LATINES: RegExp[] = [
  /\bkyrie\s+eleison\b/i,
  /\bchriste\s+eleison\b/i,
  /\bgloria\s+in\s+excelsis\s+deo\b/i,
  /\bin\s+terra\s+pax\b/i,
  /\bsanctus\s+sanctus\s+sanctus\b/i,
  /\bdominus\s+deus\s+sabaoth\b/i,
  /\bhosanna\s+in\s+excelsis\b/i,
  /\bbenedictus\s+qui\s+venit\b/i,
  /\bagnus\s+dei\b/i,
  /\bqui\s+tollis\s+peccata\s+mundi\b/i,
  /\bmiserere\s+nobis\b/i,
  /\bdona\s+nobis\s+pacem\b/i,
  /\bpater\s+noster\b/i,
  /\bqui\s+es\s+in\s+caelis\b/i,
  /\bave\s+maria\b/i,
  /\bgratia\s+plena\b/i,
  /\bdominus\s+tecum\b/i,
  /\brequiem\s+aeternam\b/i,
  /\blux\s+perpetua\b/i,
  /\btantum\s+ergo\b/i,
  /\bpanis\s+angelicus\b/i,
  /\bsalve\s+regina\b/i,
  /\bmagnificat\s+anima\s+mea\b/i,
  /\bcredo\s+in\s+unum\s+deum\b/i,
  /\bcrucem\s+tuam\b/i,
  /\bsaecula\s+saeculorum\b/i,
  /\bsursum\s+corda\b/i,
  /\bhabemus\s+ad\s+dominum\b/i,
  /\bcorpus\s+christi\b/i,
  /\bsanguis\s+christi\b/i,
  /\bte\s+deum\s+laudamus\b/i,
];

const LEXIQUES: Record<string, Set<string>> = {
  la: new Set([
    "dominus", "domini", "domino", "dominum", "deo", "deus", "dei", "deum",
    "christe", "eleison", "sanctus", "agnus", "tecum", "maria", "excelsis",
    "requiem", "corpus", "sanguis", "spiritus", "pater", "noster", "tuum",
    "meum", "saecula", "vobiscum", "miserere", "nobis", "pacem", "crucem",
    "adoramus", "caelis", "plena", "gratia", "benedictus", "terra", "laudamus",
    "panis", "angelicus", "credo", "unum", "filii", "dona", "sabaoth",
    "hosanna", "stabat", "salve", "regina", "magnificat", "tantum", "ergo",
    "sacramentum", "hostia", "hominibus", "voluntatis", "benedicimus",
    "glorificamus", "gratias", "agimus", "propter", "magnam", "gloriam",
    "domine", "caelestis", "omnipotens", "unigenite", "altissimus", "peccata",
    "mundi", "tollis", "cuncta", "saeculorum", "venite", "adoremus", "corda",
    "calicem", "redemptor", "patris", "verbum", "caro", "factum", "resurrexit"
  ]),
  moore: new Set([
    "wennam", "wend", "yeso", "kiristo", "barka", "nooma", "pugla", "kamba",
    "zoodo", "duniya", "waodo", "tenga", "songo", "roogo", "yiila", "puge",
    "woto", "ti", "yaa", "neda", "biig", "arzene", "lagem", "leb", "veuge",
    "maana", "mam", "foo", "damba", "yembre", "yemb", "tend", "naaba",
    "soala", "pebila", "zoe", "sid", "sida", "kelg", "gomde", "nonglem",
    "baaba", "biiga", "ninbuiida", "wende", "zo-y", "faag", "sugri"
  ]),
  dioula: new Set([
    "ala", "allabato", "barika", "matigi", "masake", "here", "sankolo",
    "dunya", "hakili", "kuma", "senumanye", "kadi", "anw", "deenw", "kelen",
    "siyaw", "kuun", "duyen", "file", "senu", "aw", "wili", "jon", "kristo",
    "foyi", "baara", "latike", "sabari", "bisan"
  ]),
  lingala: new Set([
    "kembo", "nzambe", "mokonzi", "yezu", "kristu", "klisto", "mwana", "tata",
    "seko", "sango", "mobikisi", "banso", "bino", "ngolu", "elimo", "santu",
    "mosantu", "nzembo", "likolo", "nse", "lelo", "ndeko", "bosembo", "esengo",
    "beto", "lola", "motema", "mawa", "bikamwa", "loba", "lisekwa", "eyano",
    "tanga", "yoka", "koyemba", "toye", "toyembela", "kumisa", "tokumisa",
    "yonde", "malamu", "mabe", "bomoyi", "biso", "bolingo", "nalingi", "hozana"
  ]),
  en: new Set([
    "the", "lord", "praise", "holy", "spirit", "love", "grace", "our",
    "your", "king", "heart", "sing", "pray", "hallelujah", "bless", "worship",
    "come", "heaven", "earth", "savior", "lamb", "when", "glory", "people",
    "with", "jesus", "christ", "almighty", "mercy", "forever"
  ]),
  es: new Set([
    "senor", "dios", "cristo", "gloria", "padre", "espiritu", "hijo", "amor",
    "gracia", "bendito", "piedad", "nosotros", "alabanza", "cordero", "ten",
    "cielo", "tierra", "reina", "santo", "senorita"
  ]),
  gulmancema: new Set([
    "diedo", "untien", "pebiger", "cuan", "ciaditi", "suglidaano", "sugli",
    "tienu", "babuado", "nintuali", "bugs", "tuom", "kpiagidi", "yanmaa"
  ]),
  bissa: new Set([
    "semegnan", "yaada", "zuuba", "huusu", "gaole", "dun", "gyer", "zelgue",
    "medi", "foua", "kre", "pen"
  ]),
  dagara: new Set([
    "naawmin", "nyee", "nye", "faafu", "biir", "yeru", "yel-migna", "krista",
    "za", "sir"
  ]),
  fr: new Set([
    "seigneur", "dieu", "notre", "pere", "jesus", "sainte", "saint", "esprit",
    "amour", "paix", "terre", "ciel", "joie", "coeur", "viens", "chantons",
    "louange", "salut", "beni", "croix", "corps", "sang", "pain", "vin",
    "peuple", "foi", "grace", "marie", "vierge", "merci", "pitie", "agneau",
    "monde", "nous", "vous", "dans", "avec", "pour", "sur", "vers"
  ]),
};

function normaliser(texte: string): string {
  return (texte || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ");
}

export function detecterLangueLocal(
  titre: string,
  refrain: string | null | undefined,
  couplets: string[] | undefined,
  langueDefaut: string = "fr"
): string {
  const titreBrut = titre || "";

  // 1. Tag explicite dans le titre
  for (const [pattern, code] of TAGS_TITRE) {
    if (pattern.test(titreBrut)) return code;
  }

  // 2. Formules latines canoniques
  const texteComplet = `${titreBrut} ${refrain || ""} ${(couplets || []).join(" ")}`;
  for (const pattern of FORMULES_LATINES) {
    if (pattern.test(texteComplet)) return "la";
  }

  // 3. Décompte lexical
  const norm = normaliser(texteComplet);
  const words = new Set(norm.split(/\s+/).filter(Boolean));

  const scores: Record<string, number> = {};
  for (const [code, lexique] of Object.entries(LEXIQUES)) {
    let inter = 0;
    for (const w of words) {
      if (lexique.has(w)) inter++;
    }
    if (inter > 0) scores[code] = inter;
  }

  const entries = Object.entries(scores);
  if (entries.length === 0) return langueDefaut;

  // 4. Priorités
  for (const spe of ["la", "moore", "dioula", "lingala", "gulmancema", "bissa", "dagara", "en", "es"]) {
    const scoreSpe = scores[spe] || 0;
    const frScore = scores.fr || 0;

    if (spe === "la" && scoreSpe >= 2 && (scoreSpe >= frScore || ["kyrie", "agnus", "sanctus", "gloria"].some((w) => words.has(w)))) {
      return "la";
    }
    if (scoreSpe >= 2 && (scoreSpe >= frScore || scoreSpe >= 3)) {
      return spe;
    }
  }

  let bestLang = langueDefaut;
  let maxScore = 0;
  for (const [code, score] of entries) {
    if (score > maxScore) {
      maxScore = score;
      bestLang = code;
    }
  }

  return maxScore >= 2 ? bestLang : langueDefaut;
}
