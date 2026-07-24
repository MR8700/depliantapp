import * as FileSystem from "expo-file-system/legacy";
import { API_BASE_URL } from "../config";
import { apiFetch, apiFetchForm, jetonAuthorizationHeader } from "./client";

export type ImageSlot = "logo_gauche" | "logo_droit" | "banniere_bas";

export interface Media {
  id: number;
  type: string;
  nom: string | null;
  filename: string;
}

export function getParametres(): Promise<Record<string, any>> {
  return apiFetch<Record<string, any>>("/parametres");
}

export function sauvegarderParametres(data: Record<string, any>): Promise<Record<string, any>> {
  return apiFetch<Record<string, any>>("/parametres", { method: "PUT", body: data });
}

export function getParametresGlobaux(): Promise<Record<string, any>> {
  return apiFetch<Record<string, any>>("/parametres/global");
}

export function listerMedias(type?: string): Promise<Media[]> {
  return apiFetch<Media[]>(`/parametres/medias${type ? `?type=${type}` : ""}`);
}

export function urlMedia(mediaId: number): string {
  return `${API_BASE_URL}/parametres/medias/${mediaId}/fichier`;
}

export function urlImageActive(slot: ImageSlot): string {
  return `${API_BASE_URL}/parametres/image/${slot}`;
}

export async function uploaderEtActiverImage(slot: ImageSlot, uriLocal: string, nomFichier: string, mimeType: string) {
  const form = new FormData();
  form.append("fichier", { uri: uriLocal, name: nomFichier, type: mimeType } as any);
  return apiFetchForm(`/parametres/image/${slot}`, form, { method: "POST" });
}

export function activerImageDuPool(slot: ImageSlot, mediaId: number) {
  return apiFetch(`/parametres/image/${slot}/activer`, { method: "POST", body: { media_id: mediaId } });
}

export function retirerImage(slot: ImageSlot) {
  return apiFetch(`/parametres/image/${slot}`, { method: "DELETE" });
}

// FileSystem.downloadAsync n'accepte pas de corps de requête (POST avec
// JSON) -- on récupère donc le PDF via fetch classique puis on l'écrit
// nous-mêmes en local (base64) pour que le WebView puisse l'afficher.
export async function telechargerApercuPdf(data: Record<string, any>): Promise<{ uri: string }> {
  const dest = `${FileSystem.cacheDirectory}apercu_reglages_${Date.now()}.pdf`;
  const reponse = await fetch(`${API_BASE_URL}/parametres/preview-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await jetonAuthorizationHeader()) },
    body: JSON.stringify(data),
  });
  if (!reponse.ok) {
    const texte = await reponse.text();
    let message = `Erreur ${reponse.status}`;
    try { message = JSON.parse(texte)?.detail?.message ?? message; } catch {}
    throw new Error(message);
  }
  const base64 = await blobVersBase64(await reponse.blob());
  await FileSystem.writeAsStringAsync(dest, base64, { encoding: FileSystem.EncodingType.Base64 });
  return { uri: dest };
}

function blobVersBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onerror = reject;
    lecteur.onload = () => {
      const resultat = lecteur.result as string;
      resolve(resultat.split(",")[1] ?? "");
    };
    lecteur.readAsDataURL(blob);
  });
}
