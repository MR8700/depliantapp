import { apiFetch } from "./client";

export interface ChoraleResume { id: number; nom: string }

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

export function listerChorales(): Promise<ChoraleResume[]> {
  return apiFetch<ChoraleResume[]>("/chorales");
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

export function planifierSuppression(choraleId: number, raison: string, delaiJours?: number) {
  return apiFetch(`/chorales/${choraleId}/planifier-suppression`, {
    method: "PUT", body: { raison, delai_jours: delaiJours },
  });
}

export function annulerSuppression(choraleId: number, raisonAnnulation: string) {
  return apiFetch(`/chorales/${choraleId}/annuler-suppression`, { method: "POST", body: { raison_annulation: raisonAnnulation } });
}

export function demanderRevisionSuppression(raisonRevision: string) {
  return apiFetch("/chorales/demande-revision", { method: "POST", body: { raison_revision: raisonRevision } });
}
