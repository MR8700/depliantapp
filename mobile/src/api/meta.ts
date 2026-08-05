import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch, ApiError } from "./client";
import { Identite, Meta } from "../types";

const CLE_CACHE_META = "depliantapp.meta_cache";

// Moments liturgiques + catégories -- quasi statique, mais utilisé partout
// (Composer, Éditeur, Bibliothèque, sélecteur de chant, Import...). Réseau
// prioritaire, repli sur le dernier état connu si l'appel échoue faute de
// connexion, pour que ces écrans gardent leurs filtres/options plutôt que de
// les vider silencieusement hors-ligne.
export async function getMeta(): Promise<Meta> {
  try {
    const meta = await apiFetch<Meta>("/meta");
    await AsyncStorage.setItem(CLE_CACHE_META, JSON.stringify(meta));
    return meta;
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    const brut = await AsyncStorage.getItem(CLE_CACHE_META);
    if (brut) return JSON.parse(brut);
    throw erreur;
  }
}

export function getIdentite(): Promise<Identite> {
  return apiFetch<Identite>("/auth/status");
}
