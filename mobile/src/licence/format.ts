// Format commun du blob de licence hors-ligne ("essence vivante"), partagé
// par adminSignature.ts (signe, appareil admin) et verification.ts (vérifie,
// tout appareil). Doit rester bit-à-bit identique à
// backend/app/licence_signature.py (défense en profondeur côté serveur, qui
// revérifie le même format à l'ingestion) : ordre de champs FIXE dans un
// tableau JSON (pas un objet -- élimine toute ambiguïté d'ordre de clés
// entre générateur et vérificateur), encodé en base64url, signature Ed25519
// (64 octets) accolée après un point.
//
//   licence_blob = base64url(JSON.stringify(champs)) + "." + base64url(signature)
//   champs = [v, licenceUid, choraleId, choraleNom, devMax, quotaFeuillets, expireLe, seed, issuedAt]

export interface LicencePayload {
  v: number;
  licenceUid: string;
  choraleId: number;
  choraleNom: string;
  devMax: number;
  quotaFeuillets: number | null;
  expireLe: string | null;
  seed: string;
  issuedAt: number;
}

export function versChamps(p: LicencePayload): unknown[] {
  return [p.v, p.licenceUid, p.choraleId, p.choraleNom, p.devMax, p.quotaFeuillets, p.expireLe, p.seed, p.issuedAt];
}

export function depuisChamps(champs: unknown): LicencePayload | null {
  if (!Array.isArray(champs) || champs.length !== 9) return null;
  const [v, licenceUid, choraleId, choraleNom, devMax, quotaFeuillets, expireLe, seed, issuedAt] = champs;
  if (
    v !== 1 || typeof licenceUid !== "string" || !licenceUid || typeof choraleId !== "number" ||
    typeof choraleNom !== "string" || typeof devMax !== "number" || typeof seed !== "string" || !seed ||
    typeof issuedAt !== "number"
  ) {
    return null;
  }
  if (quotaFeuillets !== null && typeof quotaFeuillets !== "number") return null;
  if (expireLe !== null && typeof expireLe !== "string") return null;
  return { v, licenceUid, choraleId, choraleNom, devMax, quotaFeuillets, expireLe, seed, issuedAt };
}

export function octetsCanoniques(p: LicencePayload): Uint8Array {
  return encoderUtf8(JSON.stringify(versChamps(p)));
}

// --- UTF-8, implémentation manuelle -----------------------------------
// Même raison que le codec base64url ci-dessous : TextEncoder/TextDecoder
// ne sont pas garantis disponibles sur tous les runtimes Hermes, et
// chorale_nom peut contenir des caractères accentués (pas seulement ASCII).
export function encoderUtf8(texte: string): Uint8Array {
  const octets: number[] = [];
  for (let i = 0; i < texte.length; i++) {
    let code = texte.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < texte.length) {
      const suivant = texte.charCodeAt(i + 1);
      if (suivant >= 0xdc00 && suivant <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (suivant - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      octets.push(code);
    } else if (code < 0x800) {
      octets.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      octets.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      octets.push(
        0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(octets);
}

export function decoderUtf8(octets: Uint8Array): string {
  let resultat = "";
  let i = 0;
  while (i < octets.length) {
    const b0 = octets[i];
    if (b0 < 0x80) {
      resultat += String.fromCharCode(b0);
      i += 1;
    } else if ((b0 & 0xe0) === 0xc0) {
      resultat += String.fromCharCode(((b0 & 0x1f) << 6) | (octets[i + 1] & 0x3f));
      i += 2;
    } else if ((b0 & 0xf0) === 0xe0) {
      resultat += String.fromCharCode(
        ((b0 & 0x0f) << 12) | ((octets[i + 1] & 0x3f) << 6) | (octets[i + 2] & 0x3f),
      );
      i += 3;
    } else {
      let code =
        ((b0 & 0x07) << 18) | ((octets[i + 1] & 0x3f) << 12) | ((octets[i + 2] & 0x3f) << 6) | (octets[i + 3] & 0x3f);
      code -= 0x10000;
      resultat += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
      i += 4;
    }
  }
  return resultat;
}

// --- base64url, implémentation manuelle -----------------------------------
// Ni Buffer ni atob/btoa ne sont garantis disponibles sur tous les moteurs
// Hermes -- un petit codec maison évite d'introduire une dépendance native
// rien que pour ça, cohérent avec le choix de @noble/ed25519 (pur JS).
const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function base64urlEncode(octets: Uint8Array): string {
  let resultat = "";
  for (let i = 0; i < octets.length; i += 3) {
    const b0 = octets[i];
    const b1 = i + 1 < octets.length ? octets[i + 1] : undefined;
    const b2 = i + 2 < octets.length ? octets[i + 2] : undefined;
    resultat += B64URL[b0 >> 2];
    resultat += B64URL[((b0 & 0x03) << 4) | (b1 !== undefined ? b1 >> 4 : 0)];
    if (b1 !== undefined) resultat += B64URL[((b1 & 0x0f) << 2) | (b2 !== undefined ? b2 >> 6 : 0)];
    if (b2 !== undefined) resultat += B64URL[b2 & 0x3f];
  }
  return resultat;
}

export function base64urlDecode(valeur: string): Uint8Array {
  const octets: number[] = [];
  let tampon = 0;
  let bits = 0;
  for (const car of valeur) {
    const index = B64URL.indexOf(car);
    if (index === -1) continue;
    tampon = (tampon << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      octets.push((tampon >> bits) & 0xff);
    }
  }
  return new Uint8Array(octets);
}

export function construireBlob(payload: LicencePayload, signature: Uint8Array): string {
  return `${base64urlEncode(octetsCanoniques(payload))}.${base64urlEncode(signature)}`;
}

// --- base64 standard (avec +/, padding) -----------------------------------
// Utilisé pour la clé publique admin embarquée et la clé privée stockée
// localement -- distinct de l'alphabet base64url utilisé pour le blob de
// licence lui-même.
const B64_STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64Encode(octets: Uint8Array): string {
  let resultat = "";
  for (let i = 0; i < octets.length; i += 3) {
    const b0 = octets[i];
    const b1 = i + 1 < octets.length ? octets[i + 1] : undefined;
    const b2 = i + 2 < octets.length ? octets[i + 2] : undefined;
    resultat += B64_STD[b0 >> 2];
    resultat += B64_STD[((b0 & 0x03) << 4) | (b1 !== undefined ? b1 >> 4 : 0)];
    resultat += b1 !== undefined ? B64_STD[((b1 & 0x0f) << 2) | (b2 !== undefined ? b2 >> 6 : 0)] : "=";
    resultat += b2 !== undefined ? B64_STD[b2 & 0x3f] : "=";
  }
  return resultat;
}

export function base64Decode(valeur: string): Uint8Array {
  const octets: number[] = [];
  let tampon = 0;
  let bits = 0;
  for (const car of valeur) {
    if (car === "=") break;
    const index = B64_STD.indexOf(car);
    if (index === -1) continue;
    tampon = (tampon << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      octets.push((tampon >> bits) & 0xff);
    }
  }
  return new Uint8Array(octets);
}

export function hexEncode(octets: Uint8Array): string {
  return Array.from(octets)
    .map((o) => o.toString(16).padStart(2, "0"))
    .join("");
}

export function hexDecode(hex: string): Uint8Array {
  const propre = hex.trim();
  const octets = new Uint8Array(propre.length / 2);
  for (let i = 0; i < octets.length; i++) {
    octets[i] = parseInt(propre.slice(i * 2, i * 2 + 2), 16);
  }
  return octets;
}

export function decomposerBlob(blob: string): { payloadOctets: Uint8Array; signature: Uint8Array } | null {
  const separateur = blob.indexOf(".");
  if (separateur === -1) return null;
  const payloadOctets = base64urlDecode(blob.slice(0, separateur));
  const signature = base64urlDecode(blob.slice(separateur + 1));
  if (payloadOctets.length === 0 || signature.length !== 64) return null;
  return { payloadOctets, signature };
}
