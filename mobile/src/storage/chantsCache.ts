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
  for (const chant of chants) existants[chant.id] = chant;
  await AsyncStorage.setItem(CLE_CACHE, JSON.stringify(existants));
}

export async function lireCache(): Promise<Chant[]> {
  const brut = await AsyncStorage.getItem(CLE_CACHE);
  if (!brut) return [];
  const existants: Record<number, Chant> = JSON.parse(brut);
  return Object.values(existants);
}
