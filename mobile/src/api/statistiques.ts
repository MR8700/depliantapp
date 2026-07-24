import { apiFetch } from "./client";

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

export function getStatistiques(): Promise<Statistiques> {
  return apiFetch<Statistiques>("/statistiques");
}
