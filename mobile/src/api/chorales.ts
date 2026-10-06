import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch, ApiError } from "./client";

export interface ChoraleResume { id: number; nom: string }

const CLE_CACHE_LISTE = "depliantapp.chorales_liste_cache";

export interface ChoraleDetail {
  id: number;
  nom: string;
  username: string;
  must_change_password: number;
  created_at: string;
  suppression_date_butoir: string | null;
  suppression_raison: string | null;
  suppression_delai_jours: number | null;
  suppression_demande_revision: number;
  suppression_revision_raison: string | null;
}

// Utilisé par le picker "composé par X" du Composer -- doit rester
// disponible hors-ligne pour ne pas casser la composition d'un feuillet
// sans réseau (même repli que le reste de l'app).
export async function listerChorales(): Promise<ChoraleResume[]> {
  try {
    const liste = await apiFetch<ChoraleResume[]>("/chorales");
    await AsyncStorage.setItem(CLE_CACHE_LISTE, JSON.stringify(liste));
    return liste;
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    const brut = await AsyncStorage.getItem(CLE_CACHE_LISTE);
    if (brut) return JSON.parse(brut);
    throw erreur;
  }
}

export function listerChoralesDetail(): Promise<ChoraleDetail[]> {
  return apiFetch<ChoraleDetail[]>("/chorales/detail");
}

export function creerChorale(nom: string, username: string): Promise<ChoraleDetail & { mot_de_passe_initial: string }> {
  return apiFetch("/chorales", { method: "POST", body: { nom, username } });
}

export function reinitialiserMotDePasse(choraleId: number): Promise<{ mot_de_passe_initial: string }> {
  return apiFetch(`/chorales/${choraleId}/reset-password`, { method: "POST", body: {} });
}

export function planifierSuppression(choraleId: number, raison: string, delaiJours?: number, dateButoir?: string) {
  return apiFetch(`/chorales/${choraleId}/planifier-suppression`, {
    method: "PUT", body: { raison, delai_jours: delaiJours, date_butoir: dateButoir },
  });
}

export function annulerSuppression(choraleId: number, raisonAnnulation: string) {
  return apiFetch(`/chorales/${choraleId}/annuler-suppression`, { method: "POST", body: { raison_annulation: raisonAnnulation } });
}

export function demanderRevisionSuppression(raisonRevision: string) {
  return apiFetch("/chorales/demande-revision", { method: "POST", body: { raison_revision: raisonRevision } });
}
