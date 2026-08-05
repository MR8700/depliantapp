import * as FileSystem from "expo-file-system/legacy";
import { apiFetch, apiFetchForm, jetonAuthorizationHeader, ApiError } from "./client";
import { API_BASE_URL } from "../config";
import { Chant, ChantCreate, ChantMedia, ChantUpdate } from "../types";
import { lireCache, appliquerPatchCache, retirerDuCache } from "../storage/chantsCache";
import {
  ajouterAOutbox, ajouterModificationAOutbox, ajouterSuppressionAOutbox,
  chantsEnAttente, estChantLocal, getChantEnAttente, modifierChantEnAttente, supprimerChantEnAttente,
} from "../storage/chantsOutbox";

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

// Repli hors-ligne -- porte rechercherChantsDepuisCache() (app.js) à
// l'identique : filtre le dernier état connu de la bibliothèque partagée
// (voir storage/chantsCache.ts) par actif/catégorie/texte (titre, refrain,
// couplets), fusionné avec les créations encore en attente d'envoi (voir
// storage/chantsOutbox.ts) pour qu'elles restent visibles/sélectionnables
// tant qu'elles n'ont pas atteint le serveur. Le réseau reste toujours
// prioritaire quand disponible ; ceci ne sert que si l'appel réseau échoue.
async function rechercherChantsHorsLigne(params: RechercheParams): Promise<Chant[]> {
  const cache = (await lireCache()).filter((c) => c.actif !== false);
  const enAttente = await chantsEnAttente();
  const liste = filtrerListe([...enAttente, ...cache], params);
  liste.sort((a, b) => a.titre.localeCompare(b.titre));
  const bornee = liste.slice(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 1000));
  return tronquerSiResume(bornee, params.resume);
}

// Réseau prioritaire, TOUJOURS fusionné avec les créations locales encore en
// attente d'envoi (voir storage/chantsOutbox.ts) -- sans cette fusion, la
// réponse serveur remplaçait purement et simplement la bibliothèque affichée
// dès que le réseau redevenait disponible : tout chant créé hors-ligne et
// pas encore synchronisé (donc absent de la réponse serveur) disparaissait
// de la liste, donnant l'impression trompeuse que la bibliothèque locale
// avait été "remplacée" par celle du serveur au lieu d'être fusionnée avec
// elle. Ces entrées disparaissent d'elles-mêmes de cette fusion dès que la
// synchronisation les pousse réellement (elles font alors partie de la
// réponse serveur, avec un vrai id, et sortent de l'outbox).
export async function rechercherChants(params: RechercheParams = {}): Promise<Chant[]> {
  try {
    const distants = await apiFetch<Chant[]>(`/chants${query({ ...params, limit: params.limit ?? 1000 })}`);
    const enAttente = tronquerSiResume(filtrerListe(await chantsEnAttente(), params), params.resume);
    return enAttente.length > 0 ? [...enAttente, ...distants] : distants;
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    return rechercherChantsHorsLigne(params);
  }
}

export async function getChant(id: number): Promise<Chant> {
  if (estChantLocal(id)) {
    const local = await getChantEnAttente(id);
    if (local) return local;
    throw new Error("Chant local introuvable (peut-être déjà synchronisé -- rafraîchis la bibliothèque).");
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

export function creerChant(payload: ChantCreate): Promise<Chant> {
  return apiFetch<Chant>("/chants", { method: "POST", body: payload });
}

// Variantes réseau "brutes", sans repli hors-ligne -- réservées à
// storage/sync.ts (un échec ici doit laisser l'entrée en attente telle
// quelle, jamais la remettre en file une seconde fois). Même distinction que
// feuillets.ts::creerFeuilletDistant/mettreAJourFeuilletDistant.
export function modifierChantDistant(id: number, patch: ChantUpdate): Promise<Chant> {
  return apiFetch<Chant>(`/chants/${id}`, { method: "PATCH", body: patch });
}

export function supprimerChantDistant(id: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/chants/${id}`, { method: "DELETE" });
}

// Écrit en réseau ; sur échec RÉSEAU (pas une erreur serveur -- même
// distinction que feuillets.ts) applique le patch localement au cache
// (affichage optimiste immédiat) et met l'opération en file pour
// resynchronisation différée (voir storage/sync.ts) plutôt que de faire
// échouer l'action pour l'utilisateur.
export async function modifierChant(id: number, patch: ChantUpdate): Promise<Chant> {
  // Le chant lui-même n'a jamais atteint le serveur -- pas la peine de
  // tenter un PATCH sur un id qui n'existe pas côté serveur (même logique
  // que feuillets.ts::mettreAJourFeuillet) : on édite directement le
  // payload en attente dans l'outbox.
  if (estChantLocal(id)) {
    const maj = await modifierChantEnAttente(id, patch);
    if (maj) return maj;
    throw new Error("Chant local introuvable (peut-être déjà synchronisé -- rafraîchis la bibliothèque).");
  }
  try {
    return await modifierChantDistant(id, patch);
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    await appliquerPatchCache(id, patch as Partial<Chant>);
    await ajouterModificationAOutbox(id, patch);
    const local = (await lireCache()).find((c) => c.id === id);
    if (local) return local;
    throw erreur;
  }
}

export async function supprimerChant(id: number): Promise<{ ok: boolean }> {
  if (estChantLocal(id)) {
    await supprimerChantEnAttente(id);
    return { ok: true };
  }
  try {
    return await supprimerChantDistant(id);
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    await retirerDuCache(id);
    await ajouterSuppressionAOutbox(id);
    return { ok: true };
  }
}

export function basculerFavori(chant: Chant): Promise<Chant> {
  return modifierChant(chant.id, { favori: !chant.favori });
}

// Reproduit dupliquerChant() (app.js) à l'identique -- même construction de
// payload (titre "... - Copie", référence "... (copie)"). Sur échec RÉSEAU,
// met en file d'attente locale comme toute autre création (voir
// SongDetailModal.tsx::enregistrer()) au lieu d'échouer silencieusement --
// sans ça, "Dupliquer" hors-ligne ne faisait tout simplement rien.
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
  try {
    return await creerChant(payload);
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    const entree = await ajouterAOutbox(payload);
    return (await getChantEnAttente(entree.idLocal))!;
  }
}

export function supprimerTouteLaBibliotheque(): Promise<{ deleted: number }> {
  return apiFetch<{ deleted: number }>("/chants/all?confirmation=SUPPRIMER", { method: "DELETE" });
}

// Pas d'endpoint bulk hors-ligne dédié côté serveur -- sur échec réseau, on
// retombe simplement sur N appels individuels déjà offline-aware
// (modifierChant/supprimerChant ci-dessus), qui mettent chaque id en file
// séparément plutôt que de perdre l'action groupée entière.
export async function bulkCategoriser(ids: number[], categorie: string): Promise<{ updated: number }> {
  try {
    return await apiFetch<{ updated: number }>("/chants/bulk_categorize", { method: "POST", body: { ids, categorie } });
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    await Promise.all(ids.map((id) => modifierChant(id, { categorie })));
    return { updated: ids.length };
  }
}

export async function bulkSupprimer(ids: number[]): Promise<{ deleted: number }> {
  try {
    return await apiFetch<{ deleted: number }>("/chants/bulk_delete", { method: "POST", body: { ids } });
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    await Promise.all(ids.map((id) => supprimerChant(id)));
    return { deleted: ids.length };
  }
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

// --- Partitions notées (PDF) -----------------------------------------------
// Contrairement aux médias audio/vidéo : workflow de modération (statut
// a_verifier/validee/revoquee, voir routers/chants.py) -- une seule
// partition "active" (validée) visible de tous à la fois, chaque chorale
// peut soumettre la sienne en attente de validation.

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
