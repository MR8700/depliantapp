import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE_URL } from "../config";
import { apiFetch, apiFetchForm, jetonAuthorizationHeader, ApiError } from "./client";
import { lireDonneesEffectives, fusionnerPatchEnAttente } from "../storage/parametresCache";

const CLE_CACHE_GLOBAUX = "depliantapp.parametres_globaux_cache";

export type ImageSlot = "logo_gauche" | "logo_droit" | "banniere_bas";

export interface Media {
  id: number;
  type: string;
  nom: string | null;
  filename: string;
}

// Utilisé aussi bien par Réglages (chorale) que par l'onglet "À propos" de
// Administration (super-admin, config GOT) -- même table côté serveur, juste
// scopée par identité. Réseau prioritaire ; repli sur le dernier état connu
// fusionné avec les modifications pas encore synchronisées (voir
// storage/parametresCache.ts) si l'appel échoue faute de connexion.
export async function getParametres(): Promise<Record<string, any>> {
  try {
    return await apiFetch<Record<string, any>>("/parametres");
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    const effectives = await lireDonneesEffectives();
    if (Object.keys(effectives).length > 0) return effectives;
    throw erreur;
  }
}

// Variante réseau "brute", sans repli hors-ligne -- réservée à
// storage/sync.ts (rejoue le patch en attente au retour du réseau ; un échec
// ici doit le laisser en attente tel quel).
export function sauvegarderParametresDistant(data: Record<string, any>): Promise<Record<string, any>> {
  return apiFetch<Record<string, any>>("/parametres", { method: "PUT", body: data });
}

// Écrit en réseau ; sur échec RÉSEAU (pas une erreur serveur -- même
// distinction que chants.ts/feuillets.ts) fusionne le patch localement
// (affichage optimiste immédiat dans Réglages/Administration) et le laisse
// en attente pour resynchronisation différée (voir storage/sync.ts) plutôt
// que de faire échouer l'enregistrement pour l'utilisateur.
export async function sauvegarderParametres(data: Record<string, any>): Promise<Record<string, any>> {
  try {
    return await sauvegarderParametresDistant(data);
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    return fusionnerPatchEnAttente(data);
  }
}

// Contenu statique (À propos) -- mis en cache pour éviter un écran vide
// hors-ligne, même repli que le reste de l'app (réseau toujours prioritaire).
export async function getParametresGlobaux(): Promise<Record<string, any>> {
  try {
    const donnees = await apiFetch<Record<string, any>>("/parametres/global");
    await AsyncStorage.setItem(CLE_CACHE_GLOBAUX, JSON.stringify(donnees));
    return donnees;
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    const brut = await AsyncStorage.getItem(CLE_CACHE_GLOBAUX);
    if (brut) return JSON.parse(brut);
    throw erreur;
  }
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
