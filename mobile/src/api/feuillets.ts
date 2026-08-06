import * as FileSystem from "expo-file-system/legacy";
import { API_BASE_URL } from "../config";
import { apiFetch, ApiError, jetonAuthorizationHeader } from "./client";
import { Feuillet, FeuilletCreate } from "../types";
import {
  lireFeuilletsLocaux, getFeuilletLocal, fusionnerFeuilletsDistants,
  enregistrerCreationLocale, enregistrerModificationLocale, estFeuilletLocal,
} from "../storage/feuilletsLocal";
import { ajouterPublicationEnAttente } from "../storage/moderationOutbox";

// Variantes réseau "brutes", sans repli hors-ligne -- réservées à
// storage/syncFeuillets.ts (un échec ici doit laisser l'entrée en attente
// telle quelle, jamais la remettre en file locale une seconde fois).
export function creerFeuilletDistant(payload: FeuilletCreate): Promise<Feuillet> {
  return apiFetch<Feuillet>("/feuillets", { method: "POST", body: payload });
}

// ATTENTION : si l'appelant ne possède pas ce feuillet, le backend crée un
// CLONE et renvoie un id différent -- l'appelant doit adopter cet id (voir
// finding #5 de l'inventaire web). Toujours utiliser l'id de la réponse.
export function mettreAJourFeuilletDistant(id: number, payload: FeuilletCreate): Promise<Feuillet> {
  return apiFetch<Feuillet>(`/feuillets/${id}`, { method: "PUT", body: payload });
}

// Liste réseau + repli local -- réseau toujours prioritaire quand
// disponible, le cache local (dernier état connu + brouillons non
// synchronisés) ne sert que si l'appel échoue (hors-ligne).
export async function listerFeuillets(mine: boolean): Promise<Feuillet[]> {
  try {
    const distants = await apiFetch<Feuillet[]>(`/feuillets?mine=${mine}&limit=200`);
    await fusionnerFeuilletsDistants(distants);
    return distants;
  } catch {
    return lireFeuilletsLocaux();
  }
}

export async function getFeuillet(id: number): Promise<Feuillet> {
  if (estFeuilletLocal(id)) {
    const local = await getFeuilletLocal(id);
    if (local) return local;
    throw new Error("Feuillet local introuvable");
  }
  try {
    const distant = await apiFetch<Feuillet>(`/feuillets/${id}`);
    await fusionnerFeuilletsDistants([distant]);
    return distant;
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    const local = await getFeuilletLocal(id);
    if (local) return local;
    throw erreur;
  }
}

// Écrit en réseau ; sur échec RÉSEAU (pas une erreur serveur -- même
// distinction que SongDetailModal.tsx::enregistrer()) enregistre le
// brouillon en local storage pour synchronisation différée (voir
// storage/syncFeuillets.ts) plutôt que de faire échouer l'enregistrement.
export async function creerFeuillet(payload: FeuilletCreate): Promise<Feuillet> {
  try {
    const cree = await creerFeuilletDistant(payload);
    await fusionnerFeuilletsDistants([cree]);
    return cree;
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    return enregistrerCreationLocale(payload);
  }
}

export async function mettreAJourFeuillet(id: number, payload: FeuilletCreate): Promise<Feuillet> {
  if (estFeuilletLocal(id)) {
    // Le feuillet lui-même n'a jamais atteint le serveur -- pas la peine de
    // tenter un PUT sur un id qui n'existe pas côté serveur.
    return enregistrerModificationLocale(id, payload);
  }
  try {
    const maj = await mettreAJourFeuilletDistant(id, payload);
    await fusionnerFeuilletsDistants([maj]);
    return maj;
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    return enregistrerModificationLocale(id, payload);
  }
}

export function supprimerFeuillet(id: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/feuillets/${id}`, { method: "DELETE" });
}

// Variante réseau "brute", réservée à storage/syncModeration.ts (voir
// creerFeuilletDistant plus haut pour la même convention).
export function demanderPublicationFeuilletDistant(id: number): Promise<Feuillet> {
  return apiFetch<Feuillet>(`/feuillets/${id}/demander-publication`, { method: "POST" });
}

// Demande de publication : geste de la chorale propriétaire pour qu'un
// dépliant privé rejoigne, après validation admin, la bibliothèque publique
// (voir demarrage de ce fichier + backend routers/feuillets.py). Un
// dépliant pas encore synchronisé (id local négatif) n'a pas encore
// d'existence côté serveur -- rien à publier tant qu'il n'est pas envoyé.
export async function demanderPublicationFeuillet(id: number): Promise<Feuillet> {
  if (estFeuilletLocal(id)) {
    throw new Error("Ce dépliant doit d'abord être synchronisé avant de pouvoir demander sa publication.");
  }
  try {
    const maj = await demanderPublicationFeuilletDistant(id);
    await fusionnerFeuilletsDistants([maj]);
    return maj;
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    // Pas de connexion : mémorisé pour un envoi différé (voir
    // storage/syncModeration.ts::synchroniserDemandesPublication), et
    // reflété optimistiquement dans le cache local pour que l'écran affiche
    // tout de suite "en attente" plutôt que l'ancien état "privé".
    await ajouterPublicationEnAttente(id);
    const local = await getFeuilletLocal(id);
    if (local) {
      const optimiste: Feuillet = { ...local, visibilite: "demande_publication" };
      await fusionnerFeuilletsDistants([optimiste]);
      return optimiste;
    }
    throw erreur;
  }
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
  const url = `${API_BASE_URL}/feuillets/${id}/pdf`;
  // Même retry qu'apiFetch (client.ts) : la génération PDF est justement
  // l'endpoint le plus lourd, donc celui qui a le plus de chances de tomber
  // sur un service Render encore endormi -- un seul nouvel essai après une
  // courte pause suffit à couvrir la connexion coupée du tout premier réveil.
  let resultat: FileSystem.FileSystemDownloadResult;
  try {
    resultat = await FileSystem.downloadAsync(url, dest, { headers });
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    resultat = await FileSystem.downloadAsync(url, dest, { headers });
  }
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
