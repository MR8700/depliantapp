// Preuve d'identité pour les appels chorale vers /messages/* -- seule
// fonctionnalité qui a le droit d'exiger une connexion pour un compte
// chorale 100% hors-ligne. Doit rester strictement alignée avec
// backend/app/messages_auth.py::identite_depuis_preuve_chorale (même
// message HMAC, mêmes noms d'en-têtes).
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import * as Crypto from "expo-crypto";
import { encoderUtf8, hexDecode, hexEncode } from "./format";

export function calculerPreuveMessagerie(
  seedHex: string, choraleId: number, licenceUid: string, horodatage: number, methode: string, chemin: string,
): Record<string, string> {
  const cle = hexDecode(seedHex);
  const nonce = Crypto.randomUUID();
  const mac = hmac(sha256, cle, encoderUtf8(`messages:${choraleId}:${licenceUid}:${horodatage}:${nonce}:${methode}:${chemin}`));
  return {
    "X-Chorale-Id": String(choraleId),
    "X-Licence-Id": licenceUid,
    "X-Chorale-Proof-Timestamp": String(horodatage),
    "X-Chorale-Proof-Nonce": nonce,
    "X-Chorale-Proof": hexEncode(mac),
  };
}
