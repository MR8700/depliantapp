import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { LicencePayload } from "../licence/format";
import { verifierLicenceBlob } from "../licence/verification";

const isWeb = Platform.OS === "web";

async function secureGet(cle: string): Promise<string | null> {
  if (isWeb) {
    try {
      return typeof window !== "undefined" ? window.localStorage.getItem(cle) : null;
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(cle);
  } catch {
    return null;
  }
}

async function secureSet(cle: string, valeur: string): Promise<void> {
  if (isWeb) {
    try {
      if (typeof window !== "undefined") window.localStorage.setItem(cle, valeur);
    } catch {}
    return;
  }
  try {
    await SecureStore.setItemAsync(cle, valeur);
  } catch {}
}

async function secureDelete(cle: string): Promise<void> {
  if (isWeb) {
    try {
      if (typeof window !== "undefined") window.localStorage.removeItem(cle);
    } catch {}
    return;
  }
  try {
    await SecureStore.deleteItemAsync(cle);
  } catch {}
}

// Clés de stockage persistant
const CLE_APPAREIL_ID = "depliantapp.appareil_id";
const CLE_JETON_SESSION = "depliantapp.jeton_session";

const CLE_LICENCE_BLOB = "depliantapp.licence_blob";
const CLE_LICENCE_ROLE = "depliantapp.licence_role";
const CLE_LICENCE_CLE_PUBLIQUE = "depliantapp.licence_cle_publique";
const CLE_AUTORISATION_APPAREIL = "depliantapp.autorisation_appareil";
const CLE_APPAREILS_AUTORISES = "depliantapp.appareils_autorises";
const CLE_HORODATAGE_PLAFOND = "depliantapp.horodatage_plafond";
const CLE_ADMIN_CLE_PRIVEE = "depliantapp.admin_cle_privee";
const CLE_ADMIN_CLE_SAUVEGARDEE = "depliantapp.admin_cle_sauvegardee";
const CLE_PIN_CHORALE_HASH = "depliantapp.pin_chorale_hash";

export async function getAppareilId(): Promise<string | null> {
  return secureGet(CLE_APPAREIL_ID);
}

export async function setAppareilId(id: string): Promise<void> {
  await secureSet(CLE_APPAREIL_ID, id);
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

/** Relit le blob stocké et le REVÉRIFIE (signature Ed25519) à chaque appel */
export async function getLicenceLocale(): Promise<LicenceLocale | null> {
  const [blob, role, clePublique] = await Promise.all([
    secureGet(CLE_LICENCE_BLOB),
    secureGet(CLE_LICENCE_ROLE),
    secureGet(CLE_LICENCE_CLE_PUBLIQUE),
  ]);
  if (!blob || !role) return null;
  const payload = verifierLicenceBlob(blob, clePublique ?? undefined);
  if (!payload) return null;
  return { payload, blob, role: role as RoleLicence };
}

export async function setLicenceLocale(blob: string, role: RoleLicence, clePublique?: string): Promise<void> {
  await Promise.all([
    secureSet(CLE_LICENCE_BLOB, blob),
    secureSet(CLE_LICENCE_ROLE, role),
    ...(clePublique ? [secureSet(CLE_LICENCE_CLE_PUBLIQUE, clePublique)] : []),
  ]);
}

export async function getLicenceClePublique(): Promise<string | null> {
  return secureGet(CLE_LICENCE_CLE_PUBLIQUE);
}

export async function effacerLicenceLocale(): Promise<void> {
  await Promise.all([
    secureDelete(CLE_LICENCE_BLOB),
    secureDelete(CLE_LICENCE_ROLE),
    secureDelete(CLE_LICENCE_CLE_PUBLIQUE),
    secureDelete(CLE_AUTORISATION_APPAREIL),
    secureDelete(CLE_APPAREILS_AUTORISES),
  ]);
}

// --- Handshake QR maître/enfant ---------------------------------------------

export async function getAutorisationAppareil(): Promise<string | null> {
  return secureGet(CLE_AUTORISATION_APPAREIL);
}

export async function setAutorisationAppareil(autorisation: string): Promise<void> {
  await secureSet(CLE_AUTORISATION_APPAREIL, autorisation);
}

export async function getAppareilsAutorises(): Promise<AppareilAutorise[]> {
  const brut = await secureGet(CLE_APPAREILS_AUTORISES);
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
  await secureSet(CLE_APPAREILS_AUTORISES, JSON.stringify(liste));
}

// --- Garde d'horloge (anti-recul) -------------------------------------------

export async function getHorodatagePlafond(): Promise<number> {
  const brut = await secureGet(CLE_HORODATAGE_PLAFOND);
  return brut ? Number(brut) : 0;
}

export async function setHorodatagePlafond(valeur: number): Promise<void> {
  await secureSet(CLE_HORODATAGE_PLAFOND, String(valeur));
}

// --- Clé privée admin --------------------------------------------------------

export async function getCleAdminPrivee(): Promise<string | null> {
  return secureGet(CLE_ADMIN_CLE_PRIVEE);
}

export async function setCleAdminPrivee(cleBase64: string): Promise<void> {
  await secureSet(CLE_ADMIN_CLE_PRIVEE, cleBase64);
  await secureDelete(CLE_ADMIN_CLE_SAUVEGARDEE);
}

export async function getCleAdminSauvegardee(): Promise<boolean> {
  return (await secureGet(CLE_ADMIN_CLE_SAUVEGARDEE)) === "1";
}

export async function setCleAdminSauvegardee(): Promise<void> {
  await secureSet(CLE_ADMIN_CLE_SAUVEGARDEE, "1");
}

// --- Verrou local par mot de passe -----------------------------------------

export async function getPinChoraleHash(): Promise<string | null> {
  return secureGet(CLE_PIN_CHORALE_HASH);
}

export async function setPinChoraleHash(hash: string): Promise<void> {
  await secureSet(CLE_PIN_CHORALE_HASH, hash);
}

export async function effacerPinChoraleHash(): Promise<void> {
  await secureDelete(CLE_PIN_CHORALE_HASH);
}

// --- Session centrale (jeton JWT / Bearer) -----------------------------------

export async function getJetonSession(): Promise<string | null> {
  return secureGet(CLE_JETON_SESSION);
}

export async function setJetonSession(jeton: string): Promise<void> {
  await secureSet(CLE_JETON_SESSION, jeton);
}

export async function effacerJetonSession(): Promise<void> {
  await secureDelete(CLE_JETON_SESSION);
}
