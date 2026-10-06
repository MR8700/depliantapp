// Génération/signature Ed25519 locale des licences -- rôle super-admin
// UNIQUEMENT, jamais importé côté chorale. La clé privée ne quitte jamais
// cet appareil : générée une seule fois, stockée dans SecureStore (voir
// storage/secureStore.ts::getCleAdminPrivee/setCleAdminPrivee), jamais
// transmise au serveur (qui ne détient que la clé PUBLIQUE correspondante,
// voir backend/app/licence_signature.py). Sans sauvegarde de cette clé
// (voir exporterSauvegardeCle), la perte de cet appareil = perte définitive
// de la capacité à émettre/modifier des licences -- les licences déjà
// émises restent valides côté chorale, la clé publique embarquée dans
// l'app ne bouge pas.
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { LicencePayload, base64Encode, base64Decode, construireBlob, hexEncode, octetsCanoniques } from "./format";
import { getCleAdminPrivee, setCleAdminPrivee } from "../storage/secureStore";

ed.hashes.sha512 = sha512;

const TAILLE_CLE = 32;

/** true si une clé admin a déjà été générée sur cet appareil. */
export async function cleAdminExiste(): Promise<boolean> {
  return (await getCleAdminPrivee()) !== null;
}

/** Génère (si absente) la paire de clés Ed25519 de l'admin -- 100% locale,
 * aucun appel réseau. Renvoie la clé publique en base64 standard : c'est
 * cette valeur qu'il faut copier dans verification.ts::CLE_PUBLIQUE_ADMIN_B64
 * et backend/app/licence_signature.py::_CLE_PUBLIQUE_B64_PAR_DEFAUT (ou dans
 * la variable d'environnement DEPLIANTAPP_LICENCE_CLE_PUBLIQUE côté
 * serveur) -- une seule fois, à la première génération. Appeler à nouveau
 * sur une clé déjà générée la renvoie telle quelle, ne régénère jamais
 * silencieusement (regénérer invaliderait la capacité de signer pour les
 * licences déjà émises avec l'ancienne clé -- passer par un flux explicite
 * de rotation si un jour nécessaire, pas cette fonction)."""*/
export async function genererCleAdmin(): Promise<{ cleSecrete: Uint8Array; clePubliqueB64: string }> {
  const existante = await getCleAdminPrivee();
  if (existante) {
    const cleSecrete = base64Decode(existante);
    const clePublique = ed.getPublicKey(cleSecrete);
    return { cleSecrete, clePubliqueB64: base64Encode(clePublique) };
  }
  const cleSecrete = Crypto.getRandomBytes(TAILLE_CLE);
  await setCleAdminPrivee(base64Encode(cleSecrete));
  const clePublique = ed.getPublicKey(cleSecrete);
  return { cleSecrete, clePubliqueB64: base64Encode(clePublique) };
}

/** Signe un nouveau blob de licence -- entièrement local, aucun appel
 * réseau, fonctionne même en avion. `licenceUid` est généré ICI (pas côté
 * serveur, qui n'a pas connaissance de la licence avant l'appel best-effort
 * de bookkeeping) : c'est l'identifiant canonique de la licence partout
 * (Messagerie, handshake QR maître/enfant), jamais l'id auto-incrémenté de
 * la table `licences` du backend, qui reste un détail interne de ce
 * serveur. */
export async function signerLicence(champs: {
  choraleId: number;
  choraleNom: string;
  devMax: number;
  quotaFeuillets: number | null;
  expireLe: string | null;
}): Promise<{ blob: string; payload: LicencePayload }> {
  const { cleSecrete } = await genererCleAdmin();
  const payload: LicencePayload = {
    v: 1,
    licenceUid: hexEncode(Crypto.getRandomBytes(16)),
    choraleId: champs.choraleId,
    choraleNom: champs.choraleNom,
    devMax: champs.devMax,
    quotaFeuillets: champs.quotaFeuillets,
    expireLe: champs.expireLe,
    seed: hexEncode(Crypto.getRandomBytes(32)),
    issuedAt: Math.floor(Date.now() / 1000),
  };
  const signature = ed.sign(octetsCanoniques(payload), cleSecrete);
  return { blob: construireBlob(payload, signature), payload };
}

/** Re-signe une licence existante (modification/régénération) en conservant
 * son identité (licenceUid, seed, choraleId) -- seuls les champs de
 * configuration changent. Un nouveau `seed` invaliderait le handshake QR
 * maître/enfant déjà en place sur les appareils chorale existants, donc on
 * réutilise volontairement l'ancien plutôt que d'en tirer un nouveau. */
export async function reSignerLicence(
  ancien: LicencePayload,
  champs: { devMax: number; quotaFeuillets: number | null; expireLe: string | null },
): Promise<{ blob: string; payload: LicencePayload }> {
  const { cleSecrete } = await genererCleAdmin();
  const payload: LicencePayload = {
    ...ancien,
    devMax: champs.devMax,
    quotaFeuillets: champs.quotaFeuillets,
    expireLe: champs.expireLe,
    issuedAt: Math.floor(Date.now() / 1000),
  };
  const signature = ed.sign(octetsCanoniques(payload), cleSecrete);
  return { blob: construireBlob(payload, signature), payload };
}

/** Propose une sauvegarde de la clé privée admin via la feuille de partage
 * native (fichier texte, base64 standard) -- même geste que la sauvegarde
 * JSON avant suppression de bibliothèque dans ReglagesScreen.tsx. À
 * afficher obligatoirement juste après la première génération de clé : sans
 * ça, perdre cet appareil rend impossible toute nouvelle licence/
 * modification, définitivement (la clé publique ne suffit qu'à vérifier,
 * jamais à signer). */
export async function exporterSauvegardeCle(): Promise<void> {
  const cle = await getCleAdminPrivee();
  if (!cle) throw new Error("Aucune clé admin à sauvegarder");
  const dest = `${FileSystem.cacheDirectory}depliantapp_cle_admin_sauvegarde.txt`;
  try {
    await FileSystem.writeAsStringAsync(
      dest,
      "DepliantApp -- Sauvegarde de la clé d'administration des licences\n" +
        "Ne partagez ce fichier avec PERSONNE -- il permet de créer des licences en votre nom.\n" +
        "Conservez-le en lieu sûr (gestionnaire de mots de passe, coffre-fort numérique).\n\n" +
        cle + "\n",
    );
    const disponible = await Sharing.isAvailableAsync();
    if (!disponible) throw new Error("Le partage de fichier n'est pas disponible sur cet appareil");
    await Sharing.shareAsync(dest, { mimeType: "text/plain", dialogTitle: "Sauvegarder la clé d'administration" });
  } finally {
    // Le fichier en clair ne doit jamais persister au-delà du geste de
    // partage -- sans ce nettoyage, la clé privée restait indéfiniment en
    // clair dans le cache de l'app (extractible via une sauvegarde ADB sur
    // un appareil debuggable, un outil d'extraction iOS, etc.).
    await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
  }
}

/** Restaure la clé admin depuis une sauvegarde (nouvel appareil, ou
 * réinstallation) -- valide le format avant d'écraser toute clé déjà
 * présente. */
export async function restaurerCleAdmin(cleBase64: string): Promise<void> {
  const octets = base64Decode(cleBase64.trim());
  if (octets.length !== TAILLE_CLE) throw new Error("Format de clé invalide");
  await setCleAdminPrivee(base64Encode(octets));
}
