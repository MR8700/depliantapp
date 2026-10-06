import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch, ApiError } from "./client";

export interface Statistiques {
  total_chants: number;
  total_feuillets: number;
  total_chorales: number;
  chants_par_categorie: { categorie: string; nombre: number }[];
  feuillets_par_chorale: { chorale_nom: string; nombre: number; dernier: string | null }[];
  demandes_en_attente: number;
  demandes_validees: number;
  masques_actifs: number;
  feuillets_recents: { date: string; lieu: string | null; chorale_nom: string | null; created_at: string }[];
  chants_recents: { titre: string; categorie: string; created_at: string }[];
}

const CLE_CACHE = "depliantapp.statistiques_cache";

// Calcul serveur agrégé, admin uniquement -- pas de file d'écriture (rien à
// pousser), mais un cache de LECTURE évite un écran vide en cas de coupure
// réseau ponctuelle : on affiche le dernier instantané connu.
export async function getStatistiques(): Promise<Statistiques> {
  try {
    const stats = await apiFetch<Statistiques>("/statistiques");
    await AsyncStorage.setItem(CLE_CACHE, JSON.stringify(stats));
    return stats;
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    const brut = await AsyncStorage.getItem(CLE_CACHE);
    if (brut) return JSON.parse(brut);
    throw erreur;
  }
}
