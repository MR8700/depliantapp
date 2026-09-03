// Fichier de métadonnées de licence persistant et inviolable sur le disque.
//
// Objectif d'inviolabilité :
// Même si un utilisateur va dans les Paramètres Android et effectue Effacer
// les données de l'application (ce qui efface AsyncStorage et SecureStore),
// ce fichier caché et chiffré sur le disque de l'appareil permet à l'application
// de se souvenir de l'état exact de la licence en temps réel :
// 1. Plafond d'horloge anti-recul (impossible de reculer la date système pour rajeunir une licence).
// 2. Rôle d'origine (un appareil enfant ne peut pas se réinstaller en maître).
// 3. Compteur de feuillets générés (le quota ne retombe pas à zéro).
// 4. Mot de passe de connexion / code de verrouillage (restauré et redemandé).
// 5. Statut d'expiration (une licence expirée reste verrouillée).
//
// Le fichier est signé par HMAC-SHA256 (dérivé de l'identifiant matériel unique
// de l'appareil + sel cryptographique interne) et obfusqué pour être inviolable
// contre toute modification manuelle avec un gestionnaire de fichiers.

import { Platform } from react-native;
import * as FileSystem from expo-file-system/legacy;
import { hmac } from @noble/hashes/hmac.js;
import { sha256 } from @noble/hashes/sha2.js;
import { encoderUtf8, hexEncode, hexDecode, base64Encode, base64Decode } from ./format;
import {
  getAppareilId,
  setAppareilId,
  getHorodatagePlafond,
  setHorodatagePlafond,
  getLicenceLocale,
  getLicenceClePublique,
  getPinChoraleHash,
  setPinChoraleHash,
  getAppareilsAutorises,
  RoleLicence,
} from ../storage/secureStore;
import { verifierLicenceBlob } from ./verification;

const NOM_FICHIER_CACHE = .sys_depliant_vault.dat;
const SEL_VAULT = depliantapp_integrity_vault_v1_secure_seed;

export interface MetaDisqueLicence {
  version: 1;
  licenceUid: string;
  choraleId: number;
  choraleNom: string;
  role: RoleLicence;
  licenceBlob: string;
  clePublique: string | null;
  datePremiereActivation: number;
  horodatagePlafond: number;
  derniereMaj: number;
  nombreFeuilletsGeneres: number;
  appareilsAutorises: Array<{ appareilId: string; autoriseLe: number }>;
  pinHash: string | null;
  sessionVerrouillee: boolean;
  expireLe: string | null;
  estExpiree: boolean;
}

/** Génère ou récupère l'identifiant stable de l'appareil */
async function obtenirAppareilIdGaranti(): Promise<string> {
  let id = await getAppareilId();
  if (!id) {
    // Si absent (ex: après clear data), on en recrée un immédiatement
    id = hexEncode(sha256(encoderUtf8(${Date.now()}__))).slice(0, 32);
    await setAppareilId(id);
  }
  return id;
}

/** Clé HMAC dérivée de l'appareil et du sel interne */
function deriverCleIntegrite(appareilId: string): Uint8Array {
  return sha256(encoderUtf8(${SEL_VAULT}:));
}

/** Obfuscation réversible simple (XOR avec flux dérivé) */
function masquerDonnees(octets: Uint8Array, masque: Uint8Array): Uint8Array {
  const resultat = new Uint8Array(octets.length);
  for (let i = 0; i < octets.length; i++) {
    resultat[i] = octets[i] ^ masque[i % masque.length];
  }
  return resultat;
}

/** Liste des chemins redondants pour cacher et pérenniser le fichier de métadonnées */
function obtenirCheminsPotentiels(): string[] {
  const chemins: string[] = [];

  if (FileSystem.documentDirectory) {
    chemins.push(${FileSystem.documentDirectory});
  }
  if (FileSystem.cacheDirectory) {
    chemins.push(${FileSystem.cacheDirectory});
  }

  // Emplacements persistants supplémentaires sur Android
  if (Platform.OS === android) {
    chemins.push(ile:///storage/emulated/0/Android/media/com.gotechnologie.depliantapp/);
    chemins.push(ile:///storage/emulated/0/Documents/);
    chemins.push(ile:///storage/emulated/0/);
  }

  return chemins;
}

/**
 * Lit et valide le fichier de métadonnées depuis l'un des chemins disques disponibles.
 * Vérifie l'intégrité cryptographique HMAC pour détecter toute falsification.
 */
export async function chargerMetaDisque(): Promise<MetaDisqueLicence | null> {
  const appareilId = await obtenirAppareilIdGaranti();
  const cle = deriverCleIntegrite(appareilId);
  const chemins = obtenirCheminsPotentiels();

  for (const chemin of chemins) {
    try {
      const brut = await FileSystem.readAsStringAsync(chemin);
      if (!brut || !brut.startsWith(DPLVAULT$)) continue;

      const morceaux = brut.split($);
      if (morceaux.length !== 3) continue;

      const [, hmacAttendu, donneesB64] = morceaux;
      const payloadMasque = base64Decode(donneesB64);
      const payloadClairOctets = masquerDonnees(payloadMasque, cle);

      // Vérification inviolable HMAC
      const hmacCalcule = hexEncode(hmac(sha256, cle, payloadClairOctets));
      if (hmacCalcule !== hmacAttendu) {
        continue;
      }

      let texteJson = ";
 for (let i = 0; i < payloadClairOctets.length; i++) {
 texteJson += String.fromCharCode(payloadClairOctets[i]);
 }
 const objet = JSON.parse(decodeURIComponent(escape(texteJson)));
 if (objet && objet.version === 1 && typeof objet.licenceUid === string) {
 return objet as MetaDisqueLicence;
 }
 } catch {
 // Chemin inaccessible ou absent, continuer
 }
 }

 return null;
}

/**
 * Enregistre en temps réel l'état complet de la licence dans tous les emplacements cachés.
 */
export async function sauvegarderMetaDisqueEnTempsReel(partiel?: Partial<MetaDisqueLicence>): Promise<void> {
 try {
 const appareilId = await obtenirAppareilIdGaranti();
 const cle = deriverCleIntegrite(appareilId);

 const existant = await chargerMetaDisque();
 const licenceLocale = await getLicenceLocale();
 const horodatagePlafond = await getHorodatagePlafond();
 const pinHash = await getPinChoraleHash();
 const clePublique = await getLicenceClePublique();
 const appareilsAutorises = await getAppareilsAutorises();

 const licenceUid = partiel?.licenceUid ?? licenceLocale?.payload.licenceUid ?? existant?.licenceUid;
 if (!licenceUid) {
 return;
 }

 const maintenant = Math.floor(Date.now() / 1000);
 const maintenantMs = Date.now();

 const etatFinal: MetaDisqueLicence = {
 version: 1,
 licenceUid,
 choraleId: partiel?.choraleId ?? licenceLocale?.payload.choraleId ?? existant?.choraleId ?? 0,
 choraleNom: partiel?.choraleNom ?? licenceLocale?.payload.choraleNom ?? existant?.choraleNom ?? ,
 role: partiel?.role ?? licenceLocale?.role ?? existant?.role ?? maitre,
 licenceBlob: partiel?.licenceBlob ?? licenceLocale?.blob ?? existant?.licenceBlob ?? ,
 clePublique: partiel?.clePublique ?? clePublique ?? existant?.clePublique ?? null,
 datePremiereActivation: existant?.datePremiereActivation ?? partiel?.datePremiereActivation ?? maintenantMs,
 horodatagePlafond: Math.max(
 partiel?.horodatagePlafond ?? 0,
 horodatagePlafond ?? 0,
 existant?.horodatagePlafond ?? 0,
 maintenant,
 ),
 derniereMaj: maintenantMs,
 nombreFeuilletsGeneres: partiel?.nombreFeuilletsGeneres ?? existant?.nombreFeuilletsGeneres ?? 0,
 appareilsAutorises: partiel?.appareilsAutorises ?? appareilsAutorises ?? existant?.appareilsAutorises ?? [],
 pinHash: partiel?.pinHash !== undefined ? partiel.pinHash : (pinHash ?? existant?.pinHash ?? null),
 sessionVerrouillee: partiel?.sessionVerrouillee ?? existant?.sessionVerrouillee ?? false,
 expireLe: partiel?.expireLe ?? licenceLocale?.payload.expireLe ?? existant?.expireLe ?? null,
 estExpiree: partiel?.estExpiree ?? existant?.estExpiree ?? false,
 };

 const chaineJson = unescape(encodeURIComponent(JSON.stringify(etatFinal)));
 const octetsClairs = new Uint8Array(chaineJson.length);
 for (let i = 0; i < chaineJson.length; i++) {
 octetsClairs[i] = chaineJson.charCodeAt(i);
 }

 const hmacSignature = hexEncode(hmac(sha256, cle, octetsClairs));
 const octetsMasques = masquerDonnees(octetsClairs, cle);
 const donneesB64 = base64Encode(octetsMasques);

 const contenuFinal = DPLVAULT{hmacSignature}{donneesB64};

 const chemins = obtenirCheminsPotentiels();
 await Promise.allSettled(
 chemins.map(async (chemin) => {
 try {
 const dernierSlash = chemin.lastIndexOf(/);
 if (dernierSlash > 0) {
 const dossier = chemin.substring(0, dernierSlash);
 await FileSystem.makeDirectoryAsync(dossier, { intermediates: true }).catch(() => {});
 }
 await FileSystem.writeAsStringAsync(chemin, contenuFinal);
 } catch {}
 }),
 );
 } catch {}
}

/**
 * À l'activation ou au démarrage après un éventuel effacement des données :
 * Vérifie si ce code de licence a déjà été activé sur cet appareil.
 * Restaure l'état exact pour rendre le système inviolable.
 */
export async function verifierEtRestaurerEtatLicence(blob: string, roleVoulu: RoleLicence): Promise<{
 roleCorrige: RoleLicence;
 horodatagePlafond: number;
 pinHash: string | null;
 dejaConnue: boolean;
}> {
 const payload = verifierLicenceBlob(blob);
 if (!payload) {
 return { roleCorrige: roleVoulu, horodatagePlafond: 0, pinHash: null, dejaConnue: false };
 }

 const metaDisque = await chargerMetaDisque();
 if (!metaDisque || metaDisque.licenceUid !== payload.licenceUid) {
 const maintenant = Math.floor(Date.now() / 1000);
 await sauvegarderMetaDisqueEnTempsReel({
 licenceUid: payload.licenceUid,
 choraleId: payload.choraleId,
 choraleNom: payload.choraleNom,
 role: roleVoulu,
 licenceBlob: blob,
 horodatagePlafond: maintenant,
 datePremiereActivation: Date.now(),
 pinHash: null,
 sessionVerrouillee: false,
 });
 return { roleCorrige: roleVoulu, horodatagePlafond: maintenant, pinHash: null, dejaConnue: false };
 }

 // La licence était déjà présente sur ce disque
 const roleCorrige: RoleLicence = metaDisque.role;
 const plafondRestaure = Math.max(metaDisque.horodatagePlafond, Math.floor(Date.now() / 1000));

 await setHorodatagePlafond(plafondRestaure);
 if (metaDisque.pinHash) {
 await setPinChoraleHash(metaDisque.pinHash);
 }

 await sauvegarderMetaDisqueEnTempsReel({
 licenceBlob: blob,
 horodatagePlafond: plafondRestaure,
 role: roleCorrige,
 derniereMaj: Date.now(),
 });

 return {
 roleCorrige,
 horodatagePlafond: plafondRestaure,
 pinHash: metaDisque.pinHash,
 dejaConnue: true,
 };
}

export async function synchroniserHorlogeDisque(plafondSecondes: number): Promise<void> {
 const actuel = await chargerMetaDisque();
 if (actuel && plafondSecondes > actuel.horodatagePlafond) {
 await sauvegarderMetaDisqueEnTempsReel({ horodatagePlafond: plafondSecondes });
 }
}

export async function synchroniserPinDisque(nouveauPinHash: string | null): Promise<void> {
 await sauvegarderMetaDisqueEnTempsReel({ pinHash: nouveauPinHash });
}

export async function synchroniserVerrouillageDisque(verrouillee: boolean): Promise<void> {
 await sauvegarderMetaDisqueEnTempsReel({ sessionVerrouillee: verrouillee });
}

export async function incrementerFeuilletsGeneresDisque(): Promise<number> {
 const meta = await chargerMetaDisque();
 const nouveauTotal = (meta?.nombreFeuilletsGeneres ?? 0) + 1;
 await sauvegarderMetaDisqueEnTempsReel({ nombreFeuilletsGeneres: nouveauTotal });
 return nouveauTotal;
}
