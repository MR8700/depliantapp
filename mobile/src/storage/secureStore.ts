import * as SecureStore from "expo-secure-store";
import { LicencePayload } from "../licence/format";
import { verifierLicenceBlob } from "../licence/verification";

// Clés SecureStore. Tout ce qui décide de l'écran de démarrage (licence
// locale valide ? session admin encore valide ?) est lu ICI, en local, sans
// appel réseau -- voir App.tsx::resoudreEcranInitial. Le compte super-admin
// seul passe encore par un vrai login serveur (jeton_session) ; le compte
// chorale n'a plus de notion de session réseau du tout, seulement une
// licence locale vérifiée à chaque lecture (voir getLicenceLocale).
const CLE_APPAREIL_ID = "depliantapp.appareil_id";
const CLE_JETON_SESSION = "depliantapp.jeton_session";

const CLE_LICENCE_BLOB = "depliantapp.licence_blob";
const CLE_LICENCE_ROLE = "depliantapp.licence_role";
const CLE_AUTORISATION_APPAREIL = "depliantapp.autorisation_appareil";
const CLE_APPAREILS_AUTORISES = "depliantapp.appareils_autorises";
const CLE_HORODATAGE_PLAFOND = "depliantapp.horodatage_plafond";
const CLE_ADMIN_CLE_PRIVEE = "depliantapp.admin_cle_privee";
const CLE_ADMIN_CLE_SAUVEGARDEE = "depliantapp.admin_cle_sauvegardee";
const CLE_PIN_CHORALE_HASH = "depliantapp.pin_chorale_hash";

export async function getAppareilId(): Promise<string | null> {
  return SecureStore.getItemAsync(CLE_APPAREIL_ID);
}

export async function setAppareilId(id: string): Promise<void> {
  await SecureStore.setItemAsync(CLE_APPAREIL_ID, id);
}

// --- Licence locale (chorale) ----------------------------------------------

export type RoleLicence = "maitre" | "enfant";

export interface LicenceLocale {
  payload: LicencePayload;
  blob: string;
  role: RoleLicence;
}

export interface AppareilAutorise {
  appareilId: string;
  appareilNom: string | null;
  autoriseLe: number;
}

/** Relit le blob stocké et le REVÉRIFIE (signature Ed25519) à chaque appel --
 * jamais de confiance dans le fait qu'il ait été valide une fois : une
 * valeur corrompue ou falsifiée dans le stockage local doit être détectée
 * immédiatement, pas seulement à l'activation initiale. */
export async function getLicenceLocale(): Promise<LicenceLocale | null> {
  const [blob, role] = await Promise.all([
    SecureStore.getItemAsync(CLE_LICENCE_BLOB),
    SecureStore.getItemAsync(CLE_LICENCE_ROLE),
  ]);
  if (!blob || !role) return null;
  const payload = verifierLicenceBlob(blob);
  if (!payload) return null;
  return { payload, blob, role: role as RoleLicence };
}

export async function setLicenceLocale(blob: string, role: RoleLicence): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(CLE_LICENCE_BLOB, blob),
    SecureStore.setItemAsync(CLE_LICENCE_ROLE, role),
  ]);
}

/** Ne touche PAS CLE_HORODATAGE_PLAFOND -- le plafond anti-recul d'horloge
 * doit survivre à une réactivation (voir horlogeGarde.ts), sinon il suffit
 * d'effacer/réactiver pour le contourner. */
export async function effacerLicenceLocale(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(CLE_LICENCE_BLOB),
    SecureStore.deleteItemAsync(CLE_LICENCE_ROLE),
    SecureStore.deleteItemAsync(CLE_AUTORISATION_APPAREIL),
    SecureStore.deleteItemAsync(CLE_APPAREILS_AUTORISES),
  ]);
}

// --- Handshake QR maître/enfant ---------------------------------------------

export async function getAutorisationAppareil(): Promise<string | null> {
  return SecureStore.getItemAsync(CLE_AUTORISATION_APPAREIL);
}

export async function setAutorisationAppareil(autorisation: string): Promise<void> {
  await SecureStore.setItemAsync(CLE_AUTORISATION_APPAREIL, autorisation);
}

export async function getAppareilsAutorises(): Promise<AppareilAutorise[]> {
  const brut = await SecureStore.getItemAsync(CLE_APPAREILS_AUTORISES);
  if (!brut) return [];
  try {
    const liste = JSON.parse(brut);
    return Array.isArray(liste) ? liste : [];
  } catch {
    return [];
  }
}

export async function ajouterAppareilAutorise(appareil: AppareilAutorise): Promise<void> {
  const liste = await getAppareilsAutorises();
  liste.push(appareil);
  await SecureStore.setItemAsync(CLE_APPAREILS_AUTORISES, JSON.stringify(liste));
}

// --- Garde d'horloge (anti-recul) -------------------------------------------

export async function getHorodatagePlafond(): Promise<number> {
  const brut = await SecureStore.getItemAsync(CLE_HORODATAGE_PLAFOND);
  return brut ? Number(brut) : 0;
}

export async function setHorodatagePlafond(valeur: number): Promise<void> {
  await SecureStore.setItemAsync(CLE_HORODATAGE_PLAFOND, String(valeur));
}

// --- Clé privée admin (rôle super uniquement) -------------------------------
// Base64 standard, 32 octets seed Ed25519 -- ne quitte jamais cet appareil,
// jamais transmise au serveur (voir licence/adminSignature.ts). Sa perte
// sans sauvegarde = perte définitive de la capacité à émettre/modifier des
// licences (les licences déjà émises restent valides côté chorale, la clé
// publique embarquée dans l'app ne bouge pas).
export async function getCleAdminPrivee(): Promise<string | null> {
  return SecureStore.getItemAsync(CLE_ADMIN_CLE_PRIVEE);
}

export async function setCleAdminPrivee(cleBase64: string): Promise<void> {
  await SecureStore.setItemAsync(CLE_ADMIN_CLE_PRIVEE, cleBase64);
  // Une nouvelle clé (génération ou restauration) n'est jamais considérée
  // sauvegardée tant que l'admin ne l'a pas explicitement confirmé --
  // efface le drapeau plutôt que de le laisser mentir sur une clé qui a
  // changé depuis la dernière confirmation.
  await SecureStore.deleteItemAsync(CLE_ADMIN_CLE_SAUVEGARDEE);
}

/** Persisté (contrairement à un simple état en mémoire) : sans ça, le
 * rappel de sauvegarde de la clé admin ne s'affichait qu'à l'instant de sa
 * première génération -- fermer l'app avant d'avoir sauvegardé faisait
 * disparaître le rappel pour toujours, même des mois plus tard. */
export async function getCleAdminSauvegardee(): Promise<boolean> {
  return (await SecureStore.getItemAsync(CLE_ADMIN_CLE_SAUVEGARDEE)) === "1";
}

export async function setCleAdminSauvegardee(): Promise<void> {
  await SecureStore.setItemAsync(CLE_ADMIN_CLE_SAUVEGARDEE, "1");
}

// --- Verrou local par mot de passe (rôle chorale uniquement) ---------------
// Format "sel$empreinte_hex" -- voir licence/pinChorale.ts. Jamais transmis,
// jamais lu en clair : seul le hash PBKDF2 est stocké ici.
export async function getPinChoraleHash(): Promise<string | null> {
  return SecureStore.getItemAsync(CLE_PIN_CHORALE_HASH);
}

export async function setPinChoraleHash(hash: string): Promise<void> {
  await SecureStore.setItemAsync(CLE_PIN_CHORALE_HASH, hash);
}

export async function effacerPinChoraleHash(): Promise<void> {
  await SecureStore.deleteItemAsync(CLE_PIN_CHORALE_HASH);
}

// --- Session admin (super-admin uniquement, inchangé) -----------------------

export async function getJetonSession(): Promise<string | null> {
  return SecureStore.getItemAsync(CLE_JETON_SESSION);
}

export async function setJetonSession(jeton: string): Promise<void> {
  await SecureStore.setItemAsync(CLE_JETON_SESSION, jeton);
}

export async function effacerJetonSession(): Promise<void> {
  await SecureStore.deleteItemAsync(CLE_JETON_SESSION);
}
