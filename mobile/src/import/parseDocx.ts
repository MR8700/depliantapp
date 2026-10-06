import * as FileSystem from "expo-file-system/legacy";
import { unzipSync, strFromU8 } from "fflate";

// Port de backend/app/ingestion/parse_docx.py::iter_paragraphs_docx --
// sans parseur XML/DOM complet (non disponible en React Native), une
// extraction par expressions régulières sur word/document.xml : suffisant
// car ce fichier n'a jamais de <w:p> imbriqués (structure plate, un
// paragraphe = un élément de premier niveau dans son conteneur), la même
// hypothèse que fait déjà tout extracteur DOCX léger.
const RE_PARAGRAPHE = /<w:p[ >][\s\S]*?<\/w:p>/g;
// À l'intérieur d'un paragraphe : texte (<w:t>...</w:t>, avec ou sans
// attributs comme xml:space="preserve"), saut de ligne manuel (<w:br/>),
// tabulation (<w:tab/>) -- dans l'ORDRE d'apparition, pour ne jamais
// recoller à tort deux runs séparés par un <w:br/> (voir la même
// justification côté serveur).
const RE_NOEUD = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:br\s*\/?>|<w:tab\s*\/?>/g;

function decoderEntitesXml(texte: string): string {
  return texte
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/** Extrait les paragraphes de word/document.xml, dans l'ordre du document
 * -- même contrat que iter_paragraphs_docx côté serveur : une entrée par
 * SOUS-LIGNE (un <w:p> contenant un <w:br/> produit plusieurs entrées). */
export function extrairesParagraphesDocx(xml: string): string[] {
  const paragraphes: string[] = [];
  const blocsP = xml.match(RE_PARAGRAPHE) || [];
  for (const blocP of blocsP) {
    const morceaux: string[] = [];
    RE_NOEUD.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE_NOEUD.exec(blocP))) {
      if (m[0].startsWith("<w:t")) {
        morceaux.push(decoderEntitesXml(m[1] ?? ""));
      } else if (m[0].startsWith("<w:br")) {
        morceaux.push("\n");
      } else if (m[0].startsWith("<w:tab")) {
        morceaux.push("\t");
      }
    }
    const texteBrut = morceaux.join("");
    for (const sousLigne of texteBrut.split("\n")) {
      paragraphes.push(sousLigne.trim());
    }
  }
  return paragraphes;
}

// Décodeur base64 -> octets autonome, sans dépendre de `atob` (absent de
// Hermes) ni de `Buffer` (non polyfillé par défaut en React Native).
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64VersOctets(base64: string): Uint8Array {
  const propre = base64.replace(/[^A-Za-z0-9+/]/g, "");
  const octets: number[] = [];
  for (let i = 0; i < propre.length; i += 4) {
    const c0 = BASE64_ALPHABET.indexOf(propre[i]);
    const c1 = BASE64_ALPHABET.indexOf(propre[i + 1]);
    const c2 = propre[i + 2] !== undefined ? BASE64_ALPHABET.indexOf(propre[i + 2]) : -1;
    const c3 = propre[i + 3] !== undefined ? BASE64_ALPHABET.indexOf(propre[i + 3]) : -1;
    octets.push((c0 << 2) | (c1 >> 4));
    if (c2 >= 0) octets.push(((c1 & 0x0f) << 4) | (c2 >> 2));
    if (c3 >= 0) octets.push(((c2 & 0x03) << 6) | c3);
  }
  return Uint8Array.from(octets);
}

/** Lit un fichier .docx local (uri expo-file-system) et renvoie ses
 * paragraphes, exactement comme le ferait le serveur -- 100% hors-ligne
 * (dézippage pur JS via fflate, aucune dépendance native). */
export async function lireParagraphesDocx(uri: string): Promise<string[]> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const binaire = base64VersOctets(base64);
  const fichiers = unzipSync(binaire, {
    filter: (entree) => entree.name === "word/document.xml",
  });
  const documentXml = fichiers["word/document.xml"];
  if (!documentXml) {
    throw new Error("Fichier .docx invalide ou corrompu (word/document.xml introuvable)");
  }
  return extrairesParagraphesDocx(strFromU8(documentXml));
}
