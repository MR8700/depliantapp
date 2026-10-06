import * as FileSystem from "expo-file-system/legacy";
import { decompressSync } from "fflate";

// Extracteur PDF textuel local. Il vise les carnets PDF exportés depuis
// Word/LibreOffice (texte sélectionnable), pas les scans photo qui exigent un
// OCR. Les flux FlateDecode et les CMaps ToUnicode sont gérés localement.
const ALPHABET_BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64VersOctets(base64: string): Uint8Array {
  const propre = base64.replace(/[^A-Za-z0-9+/]/g, "");
  const sortie: number[] = [];
  for (let i = 0; i < propre.length; i += 4) {
    const a = ALPHABET_BASE64.indexOf(propre[i]);
    const b = ALPHABET_BASE64.indexOf(propre[i + 1]);
    const c = propre[i + 2] === undefined ? -1 : ALPHABET_BASE64.indexOf(propre[i + 2]);
    const d = propre[i + 3] === undefined ? -1 : ALPHABET_BASE64.indexOf(propre[i + 3]);
    if (a < 0 || b < 0) continue;
    sortie.push((a << 2) | (b >> 4));
    if (c >= 0) sortie.push(((b & 15) << 4) | (c >> 2));
    if (d >= 0) sortie.push(((c & 3) << 6) | d);
  }
  return Uint8Array.from(sortie);
}

function latin1(octets: Uint8Array): string {
  const blocs: string[] = [];
  for (let i = 0; i < octets.length; i += 8192) blocs.push(String.fromCharCode(...octets.subarray(i, i + 8192)));
  return blocs.join("");
}

function fluxObjet(objet: string): string | null {
  const debut = objet.indexOf("stream");
  const fin = objet.lastIndexOf("endstream");
  if (debut < 0 || fin < 0 || fin <= debut) return null;
  let flux = objet.slice(debut + 6, fin).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  if (!/\/FlateDecode/.test(objet.slice(0, debut))) return flux;
  try {
    return latin1(decompressSync(Uint8Array.from(flux, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

function decoderChainePdf(brut: string): string {
  return brut.replace(/\\([\\()nrtbf]|\d{1,3})/g, (_, code: string) => {
    if (/^\d/.test(code)) return String.fromCharCode(parseInt(code, 8));
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[code] ?? code;
  });
}

function decoderHex(hex: string, cmap: Map<string, string>): string {
  const propre = hex.replace(/\s/g, "");
  let resultat = "";
  for (let i = 0; i < propre.length;) {
    const long = [8, 6, 4, 2].find((n) => cmap.has(propre.slice(i, i + n)));
    if (long) { resultat += cmap.get(propre.slice(i, i + long))!; i += long; continue; }
    const code = parseInt(propre.slice(i, i + 2), 16);
    resultat += code >= 32 ? String.fromCharCode(code) : "";
    i += 2;
  }
  return resultat;
}

function cmapUnicode(flux: string): Map<string, string> {
  const resultat = new Map<string, string>();
  const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flux))) {
    const destination = m[2].match(/.{1,4}/g)?.map((u) => String.fromCharCode(parseInt(u, 16))).join("") ?? "";
    resultat.set(m[1].toUpperCase(), destination);
  }
  return resultat;
}

function texteFlux(flux: string, cmap: Map<string, string>): string {
  const lignes: string[] = [];
  let ligne = "";
  const ajouter = (texte: string) => { ligne += texte; };
  const fermer = () => { if (ligne.trim()) lignes.push(ligne.trim()); ligne = ""; };
  const re = /\((?:\\.|[^\\)])*\)\s*Tj|<([0-9A-Fa-f\s]+)>\s*Tj|\[(.*?)\]\s*TJ|(?:\d+(?:\.\d+)?\s+){2}Td|T\*|ET/gms;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flux))) {
    const token = m[0];
    if (/Td$|T\*$|ET$/.test(token)) { fermer(); continue; }
    if (token.startsWith("(")) ajouter(decoderChainePdf(token.slice(1, token.lastIndexOf(")"))));
    else if (m[1] !== undefined) ajouter(decoderHex(m[1], cmap));
    else {
      const contenu = token.slice(1, token.lastIndexOf("]"));
      const morceaux = contenu.match(/\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>/g) ?? [];
      for (const morceau of morceaux) {
        ajouter(morceau.startsWith("(") ? decoderChainePdf(morceau.slice(1, -1)) : decoderHex(morceau.slice(1, -1), cmap));
      }
    }
  }
  fermer();
  return lignes.join("\n");
}

/** Lit les lignes d'un PDF à texte sélectionnable, sans requête réseau. */
export async function lireParagraphesPdf(uri: string): Promise<string[]> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const source = latin1(base64VersOctets(base64));
  const objets = [...source.matchAll(/\d+\s+\d+\s+obj\b([\s\S]*?)endobj/g)].map((m) => m[1]);
  const cmaps = objets.map(fluxObjet).filter((f): f is string => !!f && /beginbfchar|beginbfrange/.test(f)).flatMap((f) => [...cmapUnicode(f)]);
  const cmap = new Map(cmaps);
  const texte = objets.map(fluxObjet).filter((f): f is string => !!f && /\bBT\b/.test(f)).map((f) => texteFlux(f, cmap)).join("\n");
  const paragraphes = texte.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!paragraphes.length) throw new Error("Aucun texte extractible : ce PDF semble être une image scannée. Utilise un PDF avec texte sélectionnable.");
  return paragraphes;
}
