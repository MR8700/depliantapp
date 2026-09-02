import { LicencePayload } from "./format";

// Vérification d'expiration -- signée dans le payload (payload.expireLe),
// affichée dans Réglages, mais JAMAIS appliquée nulle part avant ce module :
// App.tsx doit l'utiliser pour verrouiller l'accès, exactement comme
// licence/horlogeGarde.ts verrouille sur un recul d'horloge. Sans ce
// verrou, une licence "expirée" continuait de fonctionner indéfiniment --
// seule sa signature Ed25519 (valable pour toujours) était revérifiée.
export function licenceExpiree(payload: LicencePayload, maintenantMs = Date.now()): boolean {
  if (!payload.expireLe) return false;
  const expireMs = Date.parse(payload.expireLe);
  if (Number.isNaN(expireMs)) return false;
  return maintenantMs > expireMs;
}
