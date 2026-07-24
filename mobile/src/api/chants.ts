import * as FileSystem from "expo-file-system/legacy";
import { apiFetch, apiFetchForm, jetonAuthorizationHeader } from "./client";
import { API_BASE_URL } from "../config";
import { Chant, ChantCreate, ChantMedia, ChantUpdate } from "../types";

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
    auteur: chant.auteur,
    compositeur: chant.compositeur,
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

// --- Badge "à vérifier" : proposition (chorale) / validation (admin) -----
// Une chorale ne fait jamais passer un chant hors de "à vérifier" elle-même,
// elle propose seulement -- le super-admin confirme (voir routers/chants.py).

export function proposerValidationChant(id: number): Promise<Chant> {
  return apiFetch<Chant>(`/chants/${id}/proposer-validation`, { method: "POST" });
}

export function validerChant(id: number): Promise<Chant> {
  return apiFetch<Chant>(`/chants/${id}/valider`, { method: "POST" });
}

export function retirerValidationChant(id: number): Promise<Chant> {
  return apiFetch<Chant>(`/chants/${id}/retirer-validation`, { method: "POST" });
}

// --- Audio/vidéo facultatifs (voir routers/chants.py, db.py::chant_medias) --
// Pas de workflow de modération : l'ajout est délibéré, rien à vérifier.
// Jamais utilisés sur les feuillets PDF -- juste affichés/écoutables dans le
// détail du chant (SongDetailModal).

export function listerMediasChant(chantId: number): Promise<ChantMedia[]> {
  return apiFetch<ChantMedia[]>(`/chants/${chantId}/medias`);
}

export function ajouterMediaChant(
  chantId: number, type: "audio" | "video", uri: string, nom: string, mimeType: string,
): Promise<ChantMedia> {
  const form = new FormData();
  form.append("fichier", { uri, name: nom, type: mimeType } as any);
  return apiFetchForm<ChantMedia>(`/chants/${chantId}/medias?media_type=${type}`, form, { method: "POST" });
}

export function supprimerMediaChant(chantId: number, mediaId: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/chants/${chantId}/medias/${mediaId}`, { method: "DELETE" });
}

// Télécharge le média vers un fichier local (cache) avant lecture -- même
// raison que telechargerFeuilletPdf (feuillets.ts) : l'endpoint exige le
// jeton Bearer, qu'une WebView ne peut pas attacher à une requête média
// distante. Même retry qu'ailleurs pour couvrir le réveil Render.
export async function telechargerMediaChant(chantId: number, media: ChantMedia): Promise<string> {
  const dest = `${FileSystem.cacheDirectory}chant_media_${media.id}_${media.filename}`;
  const headers = await jetonAuthorizationHeader();
  const url = `${API_BASE_URL}/chants/${chantId}/medias/${media.id}/fichier`;
  let resultat;
  try {
    resultat = await FileSystem.downloadAsync(url, dest, { headers });
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    resultat = await FileSystem.downloadAsync(url, dest, { headers });
  }
  if (resultat.status !== 200) {
    await FileSystem.deleteAsync(dest, { idempotent: true });
    throw new Error(`Erreur ${resultat.status} lors du téléchargement`);
  }
  return resultat.uri;
}
