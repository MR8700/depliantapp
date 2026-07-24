import * as FileSystem from "expo-file-system/legacy";
import { API_BASE_URL } from "../config";
import { apiFetch, ApiError, jetonAuthorizationHeader } from "./client";
import { Feuillet, FeuilletCreate } from "../types";

export function listerFeuillets(mine: boolean): Promise<Feuillet[]> {
  return apiFetch<Feuillet[]>(`/feuillets?mine=${mine}&limit=200`);
}

export function getFeuillet(id: number): Promise<Feuillet> {
  return apiFetch<Feuillet>(`/feuillets/${id}`);
}

export function creerFeuillet(payload: FeuilletCreate): Promise<Feuillet> {
  return apiFetch<Feuillet>("/feuillets", { method: "POST", body: payload });
}

// ATTENTION : si l'appelant ne possède pas ce feuillet, le backend crée un
// CLONE et renvoie un id différent -- l'appelant doit adopter cet id (voir
// finding #5 de l'inventaire web). Toujours utiliser l'id de la réponse.
export function mettreAJourFeuillet(id: number, payload: FeuilletCreate): Promise<Feuillet> {
  return apiFetch<Feuillet>(`/feuillets/${id}`, { method: "PUT", body: payload });
}

export function supprimerFeuillet(id: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/feuillets/${id}`, { method: "DELETE" });
}

export interface DepassementPdf {
  message: string;
  moments_en_cause: string[];
}

export interface PdfLocal {
  uri: string;
}

// Télécharge le PDF vers un fichier local (cache) -- pas de rendu "iframe
// live" comme sur le web (voir memory : simplification assumée en attendant
// un vrai composant PDF natif). En cas de dépassement (409), lève une
// ApiError dont `.detail` est {message, moments_en_cause}.
export async function telechargerFeuilletPdf(id: number): Promise<PdfLocal> {
  const dest = `${FileSystem.cacheDirectory}feuillet_${id}_${Date.now()}.pdf`;
  const headers = await jetonAuthorizationHeader();
  const resultat = await FileSystem.downloadAsync(`${API_BASE_URL}/feuillets/${id}/pdf`, dest, { headers });
  if (resultat.status === 409) {
    const texte = await FileSystem.readAsStringAsync(dest);
    await FileSystem.deleteAsync(dest, { idempotent: true });
    let detail: DepassementPdf = { message: "Le contenu dépasse la place disponible", moments_en_cause: [] };
    try { detail = JSON.parse(texte).detail; } catch {}
    throw new ApiError(409, detail.message, detail);
  }
  if (resultat.status !== 200) {
    await FileSystem.deleteAsync(dest, { idempotent: true });
    throw new ApiError(resultat.status, `Erreur ${resultat.status} lors de la génération du PDF`);
  }
  return { uri: resultat.uri };
}
