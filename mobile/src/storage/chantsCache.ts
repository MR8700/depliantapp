import AsyncStorage from "@react-native-async-storage/async-storage";
import { Chant } from "../types";

// Reprend le pattern déjà validé côté web (depliantapp_chants_local_db,
// voir app.js::rechercherChants) : chaque recherche réussie fusionne ses
// résultats dans ce cache local, qui sert de repli si le réseau échoue --
// jamais l'inverse (le réseau reste toujours prioritaire quand disponible).
const CLE_CACHE = "depliantapp.chants_cache";

export async function fusionnerDansCache(chants: Chant[]): Promise<void> {
  const brut = await AsyncStorage.getItem(CLE_CACHE);
  const existants: Record<number, Chant> = brut ? JSON.parse(brut) : {};
  for (const chant of chants) {
    // Les créations encore en attente d'envoi (id négatif, voir
    // chantsOutbox.ts) sont volontairement exclues de ce cache : elles ne
    // sont pas un état serveur connu, juste une projection temporaire de
    // l'outbox mélangée aux résultats par rechercherChants(). Les y stocker
    // laisserait un doublon "fantôme" ici après leur synchronisation réelle
    // (l'outbox les oublie, mais ce cache les garderait indéfiniment).
    if (chant.id < 0) continue;
    existants[chant.id] = chant;
  }
  await AsyncStorage.setItem(CLE_CACHE, JSON.stringify(existants));
}

export async function lireCache(): Promise<Chant[]> {
  const brut = await AsyncStorage.getItem(CLE_CACHE);
  if (!brut) return [];
  const existants: Record<number, Chant> = JSON.parse(brut);
  return Object.values(existants);
}

/** Fusionne un patch partiel dans l'entrée déjà en cache (édition optimiste
 * hors-ligne) -- ne fait rien si le chant n'est pas encore connu localement. */
export async function appliquerPatchCache(id: number, patch: Partial<Chant>): Promise<void> {
  const brut = await AsyncStorage.getItem(CLE_CACHE);
  const existants: Record<number, Chant> = brut ? JSON.parse(brut) : {};
  if (!existants[id]) return;
  existants[id] = { ...existants[id], ...patch };
  await AsyncStorage.setItem(CLE_CACHE, JSON.stringify(existants));
}

/** Retire une entrée du cache (suppression optimiste hors-ligne). */
export async function retirerDuCache(id: number): Promise<void> {
  const brut = await AsyncStorage.getItem(CLE_CACHE);
  if (!brut) return;
  const existants: Record<number, Chant> = JSON.parse(brut);
  delete existants[id];
  await AsyncStorage.setItem(CLE_CACHE, JSON.stringify(existants));
}
