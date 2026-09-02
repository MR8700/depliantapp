import * as FileSystem from "expo-file-system/legacy";
import { apiFetch, apiFetchForm, jetonAuthorizationHeader, ApiError, verifierAccesReseau } from "./client";
import { API_BASE_URL } from "../config";
import { Chant, ChantCreate, ChantMedia, ChantUpdate } from "../types";
import { lireCache, fusionnerDansCache, appliquerPatchCache, retirerDuCache } from "../storage/chantsCache";
import {
  listerChantsLocaux, getChantLocal, creerChantLocal, modifierChantLocal, supprimerChantLocal, viderBibliothequeLocale,
} from "../storage/chantsLocal";
import { getLicenceLocale } from "../storage/secureStore";

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

function filtrerListe(liste: Chant[], params: RechercheParams): Chant[] {
  let resultat = liste;
  if (params.categorie) resultat = resultat.filter((c) => c.categorie === params.categorie);
  if (params.occasion) resultat = resultat.filter((c) => c.occasions.includes(params.occasion!));
  if (params.q) {
    const q = params.q.toLowerCase();
    resultat = resultat.filter((c) =>
      c.titre.toLowerCase().includes(q)
      || (c.refrain ?? "").toLowerCase().includes(q)
      || c.couplets.some((cp) => cp.toLowerCase().includes(q))
      || (c.auteur ?? "").toLowerCase().includes(q)
      || (c.compositeur ?? "").toLowerCase().includes(q));
  }
  return resultat;
}

function tronquerSiResume(liste: Chant[], resume: boolean | undefined): Chant[] {
  return resume ? liste.map((c) => ({ ...c, couplets: c.couplets.slice(0, 1) })) : liste;
}

function borner(liste: Chant[], params: RechercheParams): Chant[] {
  liste = [...liste].sort((a, b) => a.titre.localeCompare(b.titre));
  const bornee = liste.slice(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 1000));
  return tronquerSiResume(bornee, params.resume);
}

// Compte chorale (licence locale active) : bibliothèque 100% locale, jamais
// d'appel réseau -- voir storage/chantsLocal.ts. Compte super-admin (pas de
// licence locale) : comportement réseau inchangé, avec repli sur le dernier
// état connu en cache (storage/chantsCache.ts) si l'appel échoue.
export async function rechercherChants(params: RechercheParams = {}): Promise<Chant[]> {
  const licence = await getLicenceLocale();
  if (licence) {
    return borner(filtrerListe((await listerChantsLocaux()).filter((c) => c.actif !== false), params), params);
  }
  try {
    const distants = await apiFetch<Chant[]>(`/chants${query({ ...params, limit: params.limit ?? 1000 })}`);
    await fusionnerDansCache(distants);
    return distants;
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    return borner(filtrerListe((await lireCache()).filter((c) => c.actif !== false), params), params);
  }
}

export async function getChant(id: number): Promise<Chant> {
  const licence = await getLicenceLocale();
  if (licence) {
    const local = await getChantLocal(id);
    if (!local) throw new Error("Chant introuvable");
    return local;
  }
  try {
    return await apiFetch<Chant>(`/chants/${id}`);
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    const local = (await lireCache()).find((c) => c.id === id);
    if (local) return local;
    throw erreur;
  }
}

export async function creerChant(payload: ChantCreate): Promise<Chant> {
  const licence = await getLicenceLocale();
  if (licence) return creerChantLocal(payload);
  return apiFetch<Chant>("/chants", { method: "POST", body: payload });
}

export async function modifierChant(id: number, patch: ChantUpdate): Promise<Chant> {
  const licence = await getLicenceLocale();
  if (licence) return modifierChantLocal(id, patch);
  const maj = await apiFetch<Chant>(`/chants/${id}`, { method: "PATCH", body: patch });
  await appliquerPatchCache(id, patch as Partial<Chant>);
  return maj;
}

export async function supprimerChant(id: number): Promise<{ ok: boolean }> {
  const licence = await getLicenceLocale();
  if (licence) {
    await supprimerChantLocal(id);
    return { ok: true };
  }
  const resultat = await apiFetch<{ ok: boolean }>(`/chants/${id}`, { method: "DELETE" });
  await retirerDuCache(id);
  return resultat;
}

export function basculerFavori(chant: Chant): Promise<Chant> {
  return modifierChant(chant.id, { favori: !chant.favori });
}

// Reproduit dupliquerChant() (app.js) à l'identique -- même construction de
// payload (titre "... - Copie", référence "... (copie)").
export async function dupliquerChant(chant: Chant): Promise<Chant> {
  const payload: ChantCreate = {
    titre: `${chant.titre} - Copie`,
    categorie: chant.categorie,
    refrain: chant.refrain,
    couplets: chant.couplets,
    code_reference: chant.code_reference ? `${chant.code_reference} (copie)` : null,
    langue: chant.langue,
    occasions: chant.occasions,
    mots_cles: chant.mots_cles,
    references_bibliques: chant.references_bibliques,
    actif: chant.actif,
    favori: chant.favori,
    chant_principal: chant.chant_principal,
    tonalite: chant.tonalite,
    duree_estimee: chant.duree_estimee,
    remarques: chant.remarques,
    auteur: chant.auteur,
    compositeur: chant.compositeur,
    slug: null,
  };
  return creerChant(payload);
}

// Super-admin uniquement (voir ReglagesScreen.tsx, zone dangereuse gardée
// par `estSuperAdmin`) -- supprime la bibliothèque PARTAGÉE entière côté
// serveur. Sans équivalent chorale : chaque chorale gère sa propre
// suppression locale via viderBibliothequeLocale ci-dessous si besoin.
export function supprimerTouteLaBibliotheque(): Promise<{ deleted: number }> {
  return apiFetch<{ deleted: number }>("/chants/all?confirmation=SUPPRIMER", { method: "DELETE" });
}

export { viderBibliothequeLocale };

export async function bulkCategoriser(ids: number[], categorie: string): Promise<{ updated: number }> {
  const licence = await getLicenceLocale();
  if (licence) {
    await Promise.all(ids.map((id) => modifierChantLocal(id, { categorie })));
    return { updated: ids.length };
  }
  return apiFetch<{ updated: number }>("/chants/bulk_categorize", { method: "POST", body: { ids, categorie } });
}

export async function bulkSupprimer(ids: number[]): Promise<{ deleted: number }> {
  const licence = await getLicenceLocale();
  if (licence) {
    await Promise.all(ids.map((id) => supprimerChantLocal(id)));
    return { deleted: ids.length };
  }
  return apiFetch<{ deleted: number }>("/chants/bulk_delete", { method: "POST", body: { ids } });
}

// --- Le reste ci-dessous reste RÉSERVÉ AU COMPTE SUPER-ADMIN (toujours en
// ligne) : badge "à vérifier" (workflow de modération), médias audio/vidéo
// et partitions notées. Ces fonctionnalités supposaient une bibliothèque
// PARTAGÉE avec un modérateur central -- elles n'ont plus de sens pour une
// chorale 100% locale, propriétaire exclusive de sa propre bibliothèque
// (voir écrans appelants pour le masquage correspondant côté chorale :
// SongDetailModal.tsx, EditeurScreen.tsx). Non redessinées en stockage
// local dans ce chantier -- limite de portée assumée, pas un oubli.

export function proposerValidationChant(id: number): Promise<Chant> {
  return apiFetch<Chant>(`/chants/${id}/proposer-validation`, { method: "POST" });
}

export function validerChant(id: number): Promise<Chant> {
  return apiFetch<Chant>(`/chants/${id}/valider`, { method: "POST" });
}

export function retirerValidationChant(id: number): Promise<Chant> {
  return apiFetch<Chant>(`/chants/${id}/retirer-validation`, { method: "POST" });
}

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

export interface Partition {
  id: number;
  chant_id: number;
  chant_titre?: string | null;
  chorale_id: number | null;
  chorale_nom: string | null;
  statut: "a_verifier" | "validee" | "revoquee";
  score_pertinence: number | null;
  signaux: Record<string, any>;
  created_at: string;
  decide_le: string | null;
}

export function getPartitionActive(chantId: number): Promise<Partition | null> {
  return apiFetch<Partition | null>(`/chants/${chantId}/partition`);
}

export function getPartitionSoumiseParMaChorale(chantId: number): Promise<Partition | null> {
  return apiFetch<Partition | null>(`/chants/${chantId}/partition/mienne`);
}

export function uploaderPartition(chantId: number, uri: string, nom: string, mimeType: string): Promise<Partition> {
  const form = new FormData();
  form.append("fichier", { uri, name: nom, type: mimeType } as any);
  return apiFetchForm<Partition>(`/chants/${chantId}/partition`, form, { method: "POST" });
}

// Même raison que telechargerMediaChant : l'endpoint exige le jeton Bearer.
export async function telechargerPartition(chantId: number): Promise<string> {
  await verifierAccesReseau(`/chants/${chantId}/partition/fichier`);
  const dest = `${FileSystem.cacheDirectory}partition_chant_${chantId}.pdf`;
  const headers = await jetonAuthorizationHeader();
  const url = `${API_BASE_URL}/chants/${chantId}/partition/fichier`;
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

// Télécharge le média vers un fichier local (cache) avant lecture -- même
// raison que telechargerFeuilletPdf (feuillets.ts) : l'endpoint exige le
// jeton Bearer, qu'une WebView ne peut pas attacher à une requête média
// distante. Même retry qu'ailleurs pour couvrir le réveil Render.
export async function telechargerMediaChant(chantId: number, media: ChantMedia): Promise<string> {
  await verifierAccesReseau(`/chants/${chantId}/medias/${media.id}/fichier`);
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
