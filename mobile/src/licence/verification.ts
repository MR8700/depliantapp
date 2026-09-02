// Vérification locale (jamais de réseau) d'un blob de licence "essence
// vivante" -- utilisé par ActivationScreen.tsx (activation initiale),
// secureStore.ts (revérification à chaque lecture), horlogeGarde.ts, et les
// écrans de handshake QR maître/enfant (RejoindreAppareilEnfantScreen.tsx).
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { LicencePayload, base64Decode, decomposerBlob, decoderUtf8, depuisChamps } from "./format";

ed.hashes.sha512 = sha512;

// Clé publique de l'admin, générée une seule fois sur l'appareil admin (voir
// adminSignature.ts::genererCleAdmin, écran "Clé d'administration" dans
// AdministrationScreen.tsx) puis figée ici en dur -- encodée en base64
// standard (avec +/, PAS l'alphabet base64url utilisé pour le blob
// lui-même). Tant que ce n'est pas renseigné, toute vérification échoue
// délibérément (voir plus bas) plutôt que de faire confiance à une valeur
// par défaut.
export const CLE_PUBLIQUE_ADMIN_B64 = "REMPLACER_PAR_LA_CLE_PUBLIQUE_ADMIN_BASE64";

/** Décode + vérifie un blob de licence entièrement en local. Renvoie `null`
 * pour tout échec (format invalide, signature ne correspondant pas, clé
 * publique admin pas encore configurée) -- ne lève jamais d'exception, cet
 * appel doit pouvoir tourner à chaque ouverture de l'app sans jamais la
 * faire planter sur une donnée corrompue. */
export function verifierLicenceBlob(blob: string, clePubliqueRuntime?: string | null): LicencePayload | null {
  const cleConfiguree = clePubliqueRuntime || CLE_PUBLIQUE_ADMIN_B64;
  if (!cleConfiguree || cleConfiguree === "REMPLACER_PAR_LA_CLE_PUBLIQUE_ADMIN_BASE64") return null;
  const decompose = decomposerBlob(blob);
  if (!decompose) return null;
  try {
    const clePublique = base64Decode(cleConfiguree);
    if (clePublique.length !== 32) return null;
    if (!ed.verify(decompose.signature, decompose.payloadOctets, clePublique)) return null;
  } catch {
    return null;
  }
  let champs: unknown;
  try {
    champs = JSON.parse(decoderUtf8(decompose.payloadOctets));
  } catch {
    return null;
  }
  return depuisChamps(champs);
}
