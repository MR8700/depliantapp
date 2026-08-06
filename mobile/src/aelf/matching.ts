// Port TypeScript fidèle de backend/app/aelf_matching.py -- toute divergence
// avec ce fichier doit être reportée des deux côtés. Permet le rapprochement
// lectures <-> chants ENTIÈREMENT hors-ligne une fois la bibliothèque
// biblique synchronisée (voir storage/lecturesCache.ts), sans repasser par
// le serveur.
//
// Volontairement sans dépendance vers api/aelf.ts (juste une forme minimale
// compatible en entrée de extraireLectures) : garde ce module testable en
// pur Node (voir la suite de parité avec aelf_matching.py) sans traîner la
// chaîne d'imports React Native (config.ts::__DEV__ etc.).
interface JourAelfMinimal {
  messes: { lectures: { type: string; ref: string | null; contenu: string | null }[] }[];
}

const DIACRITIQUES_RE = new RegExp("[\\u0300-\\u036f]", "g");
const BALISES_HTML_RE = /<[^>]+>/g;
const NON_LETTRE_RE = /[^a-z0-9\s]/g;
const ESPACES_RE = /\s+/g;

const MOTS_VIDES = new Set([
  "le", "la", "les", "un", "une", "des", "de", "du", "au", "aux", "et", "ou", "a", "à",
  "en", "que", "qui", "qu", "ce", "cet", "cette", "ces", "il", "elle", "ils", "elles",
  "je", "tu", "nous", "vous", "on", "se", "sa", "son", "ses", "leur", "leurs", "pour",
  "par", "dans", "sur", "sous", "avec", "sans", "pas", "ne", "plus", "moins", "est",
  "sont", "sera", "seront", "ete", "etre", "avoir", "ai", "as", "avons", "avez", "ont",
  "mais", "donc", "car", "si", "tout", "tous", "toute", "toutes", "comme", "quand",
]);

export function normaliser(texte: string): string {
  let t = texte.normalize("NFKD").replace(DIACRITIQUES_RE, "");
  t = t.toLowerCase();
  t = t.replace(NON_LETTRE_RE, " ");
  t = t.replace(ESPACES_RE, " ").trim();
  return t;
}

function texteSansHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html.replace(BALISES_HTML_RE, " ");
}

export function motsSignificatifs(texte: string): Set<string> {
  const mots = normaliser(texte).split(" ").filter((m) => m.length >= 4 && !MOTS_VIDES.has(m));
  return new Set(mots);
}

// --- Références bibliques ---------------------------------------------------

const LIVRES = new Map<string, string>();
function enregistrer(cle: string, ...variantes: string[]) {
  for (const v of variantes) LIVRES.set(normaliser(v).replace(/ /g, ""), cle);
}

enregistrer("genese", "Genèse", "Gn", "Gen");
enregistrer("exode", "Exode", "Ex");
enregistrer("levitique", "Lévitique", "Lv");
enregistrer("nombres", "Nombres", "Nb");
enregistrer("deuteronome", "Deutéronome", "Dt");
enregistrer("josue", "Josué", "Jos");
enregistrer("juges", "Juges", "Jg");
enregistrer("ruth", "Ruth", "Rt");
enregistrer("samuel1", "1 Samuel", "1S", "1 S");
enregistrer("samuel2", "2 Samuel", "2S", "2 S");
enregistrer("rois1", "1 Rois", "1R", "1 R");
enregistrer("rois2", "2 Rois", "2R", "2 R");
enregistrer("chroniques1", "1 Chroniques", "1Ch", "1 Ch");
enregistrer("chroniques2", "2 Chroniques", "2Ch", "2 Ch");
enregistrer("esdras", "Esdras", "Esd");
enregistrer("nehemie", "Néhémie", "Ne");
enregistrer("tobie", "Tobie", "Tb");
enregistrer("judith", "Judith", "Jdt");
enregistrer("esther", "Esther", "Est");
enregistrer("maccabees1", "1 Maccabées", "1M", "1 M");
enregistrer("maccabees2", "2 Maccabées", "2M", "2 M");
enregistrer("job", "Job", "Jb");
enregistrer("psaumes", "Psaume", "Psaumes", "Ps");
enregistrer("proverbes", "Proverbes", "Pr");
enregistrer("ecclesiaste", "Ecclésiaste", "Qo", "Eccl");
enregistrer("cantique", "Cantique des cantiques", "Ct");
enregistrer("sagesse", "Sagesse", "Sg");
enregistrer("siracide", "Siracide", "Si", "Ecclésiastique");
enregistrer("isaie", "Isaïe", "Is");
enregistrer("jeremie", "Jérémie", "Jr");
enregistrer("lamentations", "Lamentations", "Lm");
enregistrer("baruch", "Baruch", "Ba");
enregistrer("ezechiel", "Ézéchiel", "Ez");
enregistrer("daniel", "Daniel", "Dn");
enregistrer("osee", "Osée", "Os");
enregistrer("joel", "Joël", "Jl");
enregistrer("amos", "Amos", "Am");
enregistrer("abdias", "Abdias", "Ab");
enregistrer("jonas", "Jonas", "Jon");
enregistrer("michee", "Michée", "Mi");
enregistrer("nahum", "Nahum", "Na");
enregistrer("habacuc", "Habacuc", "Ha");
enregistrer("sophonie", "Sophonie", "So");
enregistrer("aggee", "Aggée", "Ag");
enregistrer("zacharie", "Zacharie", "Za");
enregistrer("malachie", "Malachie", "Ml");
enregistrer("matthieu", "Matthieu", "Mt");
enregistrer("marc", "Marc", "Mc");
enregistrer("luc", "Luc", "Lc");
enregistrer("jean", "Jean", "Jn");
enregistrer("actes", "Actes des Apôtres", "Actes", "Ac");
enregistrer("romains", "Romains", "Rm");
enregistrer("corinthiens1", "1 Corinthiens", "1Co", "1 Co");
enregistrer("corinthiens2", "2 Corinthiens", "2Co", "2 Co");
enregistrer("galates", "Galates", "Ga");
enregistrer("ephesiens", "Éphésiens", "Ep");
enregistrer("philippiens", "Philippiens", "Ph");
enregistrer("colossiens", "Colossiens", "Col");
enregistrer("thessaloniciens1", "1 Thessaloniciens", "1Th", "1 Th");
enregistrer("thessaloniciens2", "2 Thessaloniciens", "2Th", "2 Th");
enregistrer("timothee1", "1 Timothée", "1Tm", "1 Tm");
enregistrer("timothee2", "2 Timothée", "2Tm", "2 Tm");
enregistrer("tite", "Tite", "Tt");
enregistrer("philemon", "Philémon", "Phm");
enregistrer("hebreux", "Hébreux", "He");
enregistrer("jacques", "Jacques", "Jc");
enregistrer("pierre1", "1 Pierre", "1P", "1 P");
enregistrer("pierre2", "2 Pierre", "2P", "2 P");
enregistrer("jean1", "1 Jean", "1Jn", "1 Jn");
enregistrer("jean2", "2 Jean", "2Jn", "2 Jn");
enregistrer("jean3", "3 Jean", "3Jn", "3 Jn");
enregistrer("jude", "Jude", "Jd");
enregistrer("apocalypse", "Apocalypse", "Ap");

export interface ReferenceParsee {
  livre: string;
  chapitre: number | null;
}

const REFERENCE_RE = /^\s*((?:[123]\s?)?[A-Za-zÀ-ÿ.]+)\s*(\d+)?/;

export function parserReference(ref: string): ReferenceParsee | null {
  if (!ref) return null;
  const m = REFERENCE_RE.exec(ref);
  if (!m) return null;
  const livreBrut = m[1].trim().replace(/\.$/, "");
  const cle = LIVRES.get(normaliser(livreBrut).replace(/ /g, ""));
  if (!cle) return null;
  const chapitre = m[2] ? parseInt(m[2], 10) : null;
  return { livre: cle, chapitre };
}

export function referencesSeRecoupent(a: string, b: string): boolean {
  const pa = parserReference(a);
  const pb = parserReference(b);
  if (!pa || !pb || pa.livre !== pb.livre) return false;
  if (pa.chapitre !== null && pb.chapitre !== null) return pa.chapitre === pb.chapitre;
  return true;
}

// --- Rapprochement chant <-> lecture ----------------------------------------

export interface LectureJour {
  type: string;
  ref: string;
  contenu: string;
}

export interface ChantPourRapprochement {
  id: number;
  titre: string;
  refrain: string | null;
  couplets: string[];
  mots_cles: string[];
  references_bibliques: string[];
}

export function extraireLectures(donneesAelf: JourAelfMinimal): LectureJour[] {
  const lectures: LectureJour[] = [];
  for (const messe of donneesAelf.messes || []) {
    for (const l of messe.lectures || []) {
      if (!l.ref) continue;
      lectures.push({ type: l.type, ref: l.ref, contenu: texteSansHtml(l.contenu) });
    }
  }
  return lectures;
}

const SEUIL_TEXTE_MIN = 0.06;

export function scoreChantPourLectures(chant: ChantPourRapprochement, lectures: LectureJour[]): number {
  for (const refChant of chant.references_bibliques) {
    for (const lecture of lectures) {
      if (referencesSeRecoupent(refChant, lecture.ref)) return 1.0;
    }
  }

  const motsChant = motsSignificatifs(
    [chant.titre, chant.refrain || "", ...chant.couplets, ...chant.mots_cles].join(" "),
  );
  if (motsChant.size === 0) return 0.0;

  let meilleur = 0.0;
  for (const lecture of lectures) {
    const motsLecture = motsSignificatifs(lecture.contenu);
    if (motsLecture.size === 0) continue;
    let intersection = 0;
    for (const m of motsChant) if (motsLecture.has(m)) intersection++;
    if (intersection === 0) continue;
    const ratio = (2 * intersection) / (motsChant.size + motsLecture.size);
    meilleur = Math.max(meilleur, ratio);
  }
  return meilleur >= SEUIL_TEXTE_MIN ? meilleur : 0.0;
}
