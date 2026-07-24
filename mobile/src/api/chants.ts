import { apiFetch } from "./client";
import { Chant, ChantCreate, ChantUpdate } from "../types";

interface RechercheParams {
  q?: string;
  categorie?: string;
  occasion?: string;
  limit?: number;
  offset?: number;
  /** Réponse allégée (couplets tronqués au premier) pour peupler une grille
   * de cartes -- voir routers/chants.py::resume. Ne jamais l'utiliser pour
   * un export/sauvegarde qui a besoin du contenu complet. */
  resume?: boolean;
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const entrees = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  if (entrees.length === 0) return "";
  return "?" + entrees.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
}

export function rechercherChants(params: RechercheParams = {}): Promise<Chant[]> {
  return apiFetch<Chant[]>(`/chants${query({ ...params, limit: params.limit ?? 1000 })}`);
}

export function getChant(id: number): Promise<Chant> {
  return apiFetch<Chant>(`/chants/${id}`);
}

export function creerChant(payload: ChantCreate): Promise<Chant> {
  return apiFetch<Chant>("/chants", { method: "POST", body: payload });
}

export function modifierChant(id: number, patch: ChantUpdate): Promise<Chant> {
  return apiFetch<Chant>(`/chants/${id}`, { method: "PATCH", body: patch });
}

export function supprimerChant(id: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/chants/${id}`, { method: "DELETE" });
}

export function basculerFavori(chant: Chant): Promise<Chant> {
  return modifierChant(chant.id, { favori: !chant.favori });
}

// Reproduit dupliquerChant() (app.js) à l'identique -- même construction de
// payload (titre "... - Copie", référence "... (copie)").
export function dupliquerChant(chant: Chant): Promise<Chant> {
  return creerChant({
    titre: `${chant.titre} - Copie`,
    categorie: chant.categorie,
    refrain: chant.refrain,
    couplets: chant.couplets,
    code_reference: chant.code_reference ? `${chant.code_reference} (copie)` : null,
    langue: chant.langue,
    occasions: chant.occasions,
    mots_cles: chant.mots_cles,
    actif: chant.actif,
    favori: chant.favori,
    chant_principal: chant.chant_principal,
    tonalite: chant.tonalite,
    duree_estimee: chant.duree_estimee,
    remarques: chant.remarques,
    slug: null,
  });
}

export function supprimerTouteLaBibliotheque(): Promise<{ deleted: number }> {
  return apiFetch<{ deleted: number }>("/chants/all?confirmation=SUPPRIMER", { method: "DELETE" });
}

export function bulkCategoriser(ids: number[], categorie: string): Promise<{ updated: number }> {
  return apiFetch<{ updated: number }>("/chants/bulk_categorize", { method: "POST", body: { ids, categorie } });
}

export function bulkSupprimer(ids: number[]): Promise<{ deleted: number }> {
  return apiFetch<{ deleted: number }>("/chants/bulk_delete", { method: "POST", body: { ids } });
}
