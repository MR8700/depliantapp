// Verrou d'accès local à l'appareil (mot de passe libre) pour le rôle
// chorale -- ne remplace PAS de mécanisme existant : une chorale n'a plus
// aucun mot de passe fonctionnel depuis le passage à la licence 100%
// hors-ligne (IdentiteContext.tsx construit l'identité chorale avec
// must_change_password figé à false, ActivationScreen.tsx n'utilise que le
// blob de licence). C'est une nouvelle fonctionnalité optionnelle,
// entièrement locale : jamais transmise au serveur, jamais connue de
// l'admin. Hachage aligné sur backend/app/auth.py::hash_password/
// verify_password (PBKDF2-HMAC-SHA256, sel aléatoire, format "sel$empreinte
// hex") pour garder la même rigueur que les vrais comptes du backend, même
// si ce verrou n'a lui-même aucune existence côté serveur.
import * as Crypto from "expo-crypto";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { encoderUtf8, hexEncode, hexDecode } from "./format";
import { verifierLicenceBlob } from "./verification";
import { getLicenceLocale, getPinChoraleHash, setPinChoraleHash, effacerPinChoraleHash } from "../storage/secureStore";

const ITERATIONS = 150_000;
const TAILLE_SEL = 16;
const TAILLE_CLE = 32;

// Variante async (pas pbkdf2 synchrone) -- 150 000 itérations en JS pur
// bloqueraient sinon le thread JS d'un coup, gelant l'UI le temps du calcul
// (déverrouillage ou définition du code) ; asyncTick fait souffler le
// scheduler entre les tranches d'itérations.
async function hasherAvecSel(pin: string, sel: Uint8Array): Promise<string> {
  const empreinte = await pbkdf2Async(sha256, encoderUtf8(pin), sel, { c: ITERATIONS, dkLen: TAILLE_CLE, asyncTick: 10 });
  return `${hexEncode(sel)}$${hexEncode(empreinte)}`;
}

/** Comparaison en temps constant -- évite qu'un timing d'échec plus rapide
 * qu'un timing de succès ne fuite d'information sur le hash stocké. */
function egalesTempsConstant(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function pinDefini(): Promise<boolean> {
  return (await getPinChoraleHash()) !== null;
}

export async function definirPin(pin: string): Promise<void> {
  const sel = Crypto.getRandomBytes(TAILLE_SEL);
  await setPinChoraleHash(await hasherAvecSel(pin, sel));
}

export async function verifierPin(pin: string): Promise<boolean> {
  const stocke = await getPinChoraleHash();
  if (!stocke) return false;
  const [selHex, empreinteHex] = stocke.split("$");
  if (!selHex || !empreinteHex) return false;
  const recalcule = await pbkdf2Async(sha256, encoderUtf8(pin), hexDecode(selHex), { c: ITERATIONS, dkLen: TAILLE_CLE, asyncTick: 10 });
  return egalesTempsConstant(recalcule, hexDecode(empreinteHex));
}

export async function effacerPin(): Promise<void> {
  await effacerPinChoraleHash();
}

/** Réinitialise le verrou en cas d'oubli, à condition que le code de
 * licence présenté soit bien celui de LA MÊME chorale déjà active sur cet
 * appareil (licenceUid + choraleId), pas n'importe quel blob valide --
 * sinon la licence d'une autre chorale, elle aussi authentique, suffirait à
 * déverrouiller un appareil qui ne lui appartient pas. Limite acceptée
 * (même famille que le plafond d'appareils "confiance logicielle") :
 * quiconque connaît déjà ce code -- nécessaire de toute façon pour activer
 * un appareil légitime de cette chorale -- peut réinitialiser le verrou
 * d'un appareil qu'il a physiquement en main. Ce n'est pas un verrou
 * inviolable, seulement une barrière contre un accès occasionnel/
 * opportuniste. */
export async function reinitialiserPinViaLicence(blob: string): Promise<boolean> {
  const presente = verifierLicenceBlob(blob);
  if (!presente) return false;
  const active = await getLicenceLocale();
  if (!active) return false;
  if (presente.licenceUid !== active.payload.licenceUid || presente.choraleId !== active.payload.choraleId) return false;
  await effacerPin();
  return true;
}
