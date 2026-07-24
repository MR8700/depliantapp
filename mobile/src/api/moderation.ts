import { apiFetch } from "./client";

export function demanderSuppression(typeCible: "chant" | "feuillet", cibleId: number, raison: string) {
  return apiFetch<{ id: number }>("/moderation/demandes", {
    method: "POST",
    body: { type_cible: typeCible, cible_id: cibleId, raison },
  });
}

export interface DemandeSuppression {
  id: number;
  type_cible: string;
  cible_id: number;
  chorale_demandeuse_id: number;
  statut: string;
  raison: string | null;
  created_at: string;
  apercu: Record<string, any> | null;
}

export function listerDemandes(statut = "en_attente"): Promise<DemandeSuppression[]> {
  return apiFetch<DemandeSuppression[]>(`/moderation/demandes?statut=${statut}`);
}

export function validerDemande(id: number) {
  return apiFetch<{ ok: boolean }>(`/moderation/demandes/${id}/valider`, { method: "POST" });
}

export function annulerDemande(id: number) {
  return apiFetch<{ ok: boolean }>(`/moderation/demandes/${id}/annuler`, { method: "POST" });
}

export function remettreEnAttente(id: number) {
  return apiFetch<{ ok: boolean }>(`/moderation/demandes/${id}/remettre_en_attente`, { method: "POST" });
}

export interface MasqueChorale {
  id: number;
  chorale_id: number;
  type_cible: string;
  cible_id: number;
  created_at: string;
  apercu: Record<string, any> | null;
}

export function listerMasques(): Promise<MasqueChorale[]> {
  return apiFetch<MasqueChorale[]>("/moderation/masques");
}

export function restaurerMasque(id: number) {
  return apiFetch<{ ok: boolean }>(`/moderation/masques/${id}`, { method: "DELETE" });
}

export interface CategoriePersonnalisee {
  id: number;
  nom: string;
  statut: string;
  motif_rejet: string | null;
  created_at: string;
  chorale_nom: string | null;
}

export function listerCategoriesModeration(statut = "en_attente"): Promise<CategoriePersonnalisee[]> {
  return apiFetch<CategoriePersonnalisee[]>(`/moderation/categories?statut=${statut}`);
}

export function validerCategorie(id: number) {
  return apiFetch<{ ok: boolean }>(`/moderation/categories/${id}/valider`, { method: "POST" });
}

export function rejeterCategorie(id: number, motif: string) {
  return apiFetch<{ ok: boolean }>(`/moderation/categories/${id}/rejeter`, { method: "POST", body: { motif } });
}
