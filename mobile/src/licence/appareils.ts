// Handshake QR maître/enfant (Solution 1, contrôle du plafond d'appareils
// dev_max) -- partagé par AjouterAppareilMaitreScreen.tsx (maître, mint
// l'autorisation) et RejoindreAppareilEnfantScreen.tsx (nouvel appareil, la
// vérifie). Entièrement pair-à-pair local (caméra), zéro serveur impliqué.
//
// Contrôle SOUPLE, pas une garantie cryptographique absolue : un utilisateur
// qui copie le blob racine directement sur plusieurs appareils indépendants
// (sans passer par ce handshake) contourne le plafond -- tradeoff accepté du
// modèle 100% hors-ligne (voir plan). Ce que ce handshake garantit
// réellement : un appareil qui REJOINT via ce flux a bien été autorisé en
// personne par le détenteur du `seed` (l'appareil maître), pas juste
// recopié le blob depuis ailleurs.
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { encoderUtf8, hexDecode, hexEncode } from "./format";

export function calculerAutorisationAppareil(seedHex: string, licenceUid: string, appareilId: string): string {
  const cle = hexDecode(seedHex);
  const mac = hmac(sha256, cle, encoderUtf8(`${licenceUid}:${appareilId}`));
  return hexEncode(mac);
}

export interface PaireQrAppareil {
  appareilId: string;
  appareilNom: string | null;
}

export interface RetourQrMaitre {
  licenceBlob: string;
  appareilId: string;
  autorisation: string;
}

export function encoderPaireAppareil(p: PaireQrAppareil): string {
  return JSON.stringify(p);
}

export function decoderPaireAppareil(donnees: string): PaireQrAppareil | null {
  try {
    const objet = JSON.parse(donnees);
    if (typeof objet?.appareilId !== "string") return null;
    return { appareilId: objet.appareilId, appareilNom: typeof objet.appareilNom === "string" ? objet.appareilNom : null };
  } catch {
    return null;
  }
}

export function encoderRetourMaitre(r: RetourQrMaitre): string {
  return JSON.stringify(r);
}

export function decoderRetourMaitre(donnees: string): RetourQrMaitre | null {
  try {
    const objet = JSON.parse(donnees);
    if (typeof objet?.licenceBlob !== "string" || typeof objet?.appareilId !== "string" || typeof objet?.autorisation !== "string") {
      return null;
    }
    return { licenceBlob: objet.licenceBlob, appareilId: objet.appareilId, autorisation: objet.autorisation };
  } catch {
    return null;
  }
}
