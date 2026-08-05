import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { jetonAuthorizationHeader } from "../api/client";
import { urlImageActive, ImageSlot } from "../api/parametres";

// Cache local des réglages (paroisse/chorale/contact/annonce/prière par
// défaut, + configuration "À propos" admin) + des 3 images actives
// (logos/bannière) -- nécessaire pour que le rendu PDF hors-ligne
// (render/widgets.ts) puisse composer l'en-tête et la bannière sans réseau,
// ET pour que Réglages/Administration restent utilisables hors-ligne en
// LECTURE. Rafraîchi best-effort dès qu'une identité est résolue (voir
// context/IdentiteContext.tsx), jamais bloquant.
//
// `donneesEnAttente` : modifications faites hors-ligne (sauvegarderParametres
// en échec réseau, voir api/parametres.ts) pas encore poussées au serveur --
// fusionnées par-dessus `donnees` à la lecture pour un affichage optimiste
// immédiat, et rejouées par storage/syncAll.ts dès le retour du réseau.
const CLE_PARAMETRES = "depliantapp.parametres_cache";
const SLOTS: ImageSlot[] = ["logo_gauche", "logo_droit", "banniere_bas"];

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

// Dernier état connu du serveur -- ne touche JAMAIS donneesEnAttente : un
// rafraîchissement (ex: retour d'un autre écran) ne doit pas effacer des
// modifications locales pas encore synchronisées.
export async function rafraichirParametresCache(donnees: Record<string, any>): Promise<void> {
  const existant = await lireParametresCache();
  const images: Partial<Record<ImageSlot, string>> = { ...existant?.images };
  const headers = await jetonAuthorizationHeader();
  for (const slot of SLOTS) {
    try {
      const dest = `${FileSystem.cacheDirectory}parametres_${slot}.img`;
      const resultat = await FileSystem.downloadAsync(urlImageActive(slot), dest, { headers });
      if (resultat.status === 200) images[slot] = resultat.uri;
      else if (resultat.status === 404) delete images[slot]; // aucune image active pour ce slot
    } catch {
      // Hors-ligne ou erreur ponctuelle -- on garde la dernière image connue
      // plutôt que d'effacer le cache existant.
    }
  }
  await ecrire({ donnees, images, donneesEnAttente: existant?.donneesEnAttente ?? null });
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

export async function lirePatchEnAttente(): Promise<Record<string, any> | null> {
  const cache = await lireParametresCache();
  return cache?.donneesEnAttente && Object.keys(cache.donneesEnAttente).length > 0 ? cache.donneesEnAttente : null;
}

/** Le patch en attente vient d'être poussé avec succès -- adopte l'état
 * serveur résultant comme nouvelle vérité et vide la file. */
export async function marquerParametresSynchronises(donneesServeur: Record<string, any>): Promise<void> {
  const existant = await lireParametresCache();
  await ecrire({ donnees: donneesServeur, images: existant?.images ?? {}, donneesEnAttente: null });
}
