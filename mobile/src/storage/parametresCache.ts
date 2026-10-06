import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { ImageSlot } from "../api/parametres";

// Cache local des réglages (paroisse/chorale/contact/annonce/prière par
// défaut, + configuration "À propos" admin) + des 3 images actives
// (logos/bannière) -- nécessaire pour que le rendu PDF hors-ligne
// (render/genererPdfLocal.ts) puisse composer l'en-tête et la bannière sans
// réseau. Compte super-admin : `donnees`/`images` reflètent le dernier état
// serveur connu (voir api/parametres.ts, plus de rafraîchissement réseau
// dédié depuis la suppression de la synchronisation -- alimenté au fil des
// lectures/écritures normales). Compte chorale (licence locale) : ce même
// stockage sert de source PERMANENTE et AUTHORITATIVE (jamais un cache d'un
// serveur qui n'existe pas pour elle), voir ecrireParametresLocaux/
// definirImageLocaleActive plus bas -- images copiées dans
// documentDirectory (jamais purgé par l'OS), jamais uploadées.
const CLE_PARAMETRES = "depliantapp.parametres_cache";

export interface ParametresCache {
  donnees: Record<string, any>;
  /** slot -> uri locale (file://) de la dernière image active téléchargée. */
  images: Partial<Record<ImageSlot, string>>;
  donneesEnAttente?: Record<string, any> | null;
}

export async function lireParametresCache(): Promise<ParametresCache | null> {
  const brut = await AsyncStorage.getItem(CLE_PARAMETRES);
  return brut ? JSON.parse(brut) : null;
}

async function ecrire(cache: ParametresCache): Promise<void> {
  await AsyncStorage.setItem(CLE_PARAMETRES, JSON.stringify(cache));
}

/** Vue effective à afficher : dernier état serveur connu + modifications pas
 * encore synchronisées par-dessus (voir sauvegarderParametres). */
export async function lireDonneesEffectives(): Promise<Record<string, any>> {
  const cache = await lireParametresCache();
  if (!cache) return {};
  return { ...cache.donnees, ...(cache.donneesEnAttente ?? {}) };
}

/** Applique un patch localement (échec réseau sur sauvegarderParametres) --
 * cumulatif : plusieurs modifications hors-ligne successives se fusionnent
 * en un seul patch en attente plutôt que de s'empiler. */
export async function fusionnerPatchEnAttente(patch: Record<string, any>): Promise<Record<string, any>> {
  const existant = await lireParametresCache();
  const donneesEnAttente = { ...(existant?.donneesEnAttente ?? {}), ...patch };
  await ecrire({ donnees: existant?.donnees ?? {}, images: existant?.images ?? {}, donneesEnAttente });
  return { ...(existant?.donnees ?? {}), ...donneesEnAttente };
}

// --- Compte chorale (licence locale) -- pas de serveur, cet état EST la
// vérité tout de suite, jamais un brouillon "en attente" (voir
// api/parametres.ts). Les images sont copiées dans le stockage PERMANENT de
// l'app (documentDirectory, jamais purgé par l'OS -- contrairement à
// cacheDirectory, utilisé ci-dessus uniquement comme cache re-téléchargeable
// du compte super-admin) puisqu'il n'existe plus de serveur d'où les
// re-télécharger si elles disparaissaient.

export async function ecrireParametresLocaux(patch: Record<string, any>): Promise<Record<string, any>> {
  const existant = await lireParametresCache();
  const donnees = { ...(existant?.donnees ?? {}), ...patch };
  await ecrire({ donnees, images: existant?.images ?? {}, donneesEnAttente: null });
  return donnees;
}

export async function definirImageLocaleActive(slot: ImageSlot, uriSource: string): Promise<string> {
  const dest = `${FileSystem.documentDirectory}parametres_locaux_${slot}.img`;
  await FileSystem.copyAsync({ from: uriSource, to: dest });
  const existant = await lireParametresCache();
  const images = { ...existant?.images, [slot]: dest };
  await ecrire({ donnees: existant?.donnees ?? {}, images, donneesEnAttente: null });
  return dest;
}

export async function retirerImageLocaleActive(slot: ImageSlot): Promise<void> {
  const existant = await lireParametresCache();
  const images = { ...existant?.images };
  const chemin = images[slot];
  delete images[slot];
  await ecrire({ donnees: existant?.donnees ?? {}, images, donneesEnAttente: null });
  if (chemin) await FileSystem.deleteAsync(chemin, { idempotent: true }).catch(() => {});
}
