import * as FileSystem from "expo-file-system/legacy";
import { API_BASE_URL } from "../config";
import { apiFetch, ApiError, jetonAuthorizationHeader, verifierAccesReseau } from "./client";
import { Feuillet, FeuilletCreate } from "../types";
import {
  lireFeuilletsLocaux, getFeuilletLocal, fusionnerFeuilletsDistants,
  enregistrerCreationLocale, enregistrerModificationLocale, supprimerFeuilletLocal, estFeuilletLocal,
  compterFeuilletsProduits, incrementerFeuilletsProduits,
} from "../storage/feuilletsLocal";
import { getLicenceLocale } from "../storage/secureStore";
import { synchroniserUsageChorale } from "./licences";

// Miroir de backend/app/licences.py::QuotaFeuilletsAtteint -- avant ce
// contrôle, quotaFeuillets (signé dans la licence, affiché en Réglages)
// n'était vérifié nulle part côté mobile : une chorale pouvait produire un
// nombre illimité de feuillets quel que soit le quota fixé par l'admin.
export class QuotaFeuilletsAtteint extends Error {
  constructor(public quota: number) {
    super(`Quota de ${quota} feuillet(s) atteint pour votre licence. Contactez l'administrateur.`);
  }
}

// Variantes réseau "brutes" -- réservées au compte super-admin (toujours en
// ligne). Un compte chorale (licence locale) n'appelle jamais ces fonctions,
// voir les variantes ci-dessous qui branchent sur getLicenceLocale().
export function creerFeuilletDistant(payload: FeuilletCreate): Promise<Feuillet> {
  return apiFetch<Feuillet>("/feuillets", { method: "POST", body: payload });
}

// ATTENTION : si l'appelant ne possède pas ce feuillet, le backend crée un
// CLONE et renvoie un id différent -- l'appelant doit adopter cet id (voir
// finding #5 de l'inventaire web). Toujours utiliser l'id de la réponse.
export function mettreAJourFeuilletDistant(id: number, payload: FeuilletCreate): Promise<Feuillet> {
  return apiFetch<Feuillet>(`/feuillets/${id}`, { method: "PUT", body: payload });
}

// Compte chorale (licence locale) : bibliothèque de dépliants 100% locale,
// jamais d'appel réseau -- voir storage/feuilletsLocal.ts (chaque feuillet y
// porte un id local négatif, à vie -- il n'existe plus de serveur pour lui
// attribuer un id "réel"). Compte super-admin : comportement réseau
// inchangé, repli sur le dernier état connu si l'appel échoue.
export async function listerFeuillets(mine: boolean): Promise<Feuillet[]> {
  if (await getLicenceLocale()) return lireFeuilletsLocaux();
  try {
    const distants = await apiFetch<Feuillet[]>(`/feuillets?mine=${mine}&limit=200`);
    await fusionnerFeuilletsDistants(distants);
    return distants;
  } catch {
    return lireFeuilletsLocaux();
  }
}

export async function getFeuillet(id: number): Promise<Feuillet> {
  if (estFeuilletLocal(id) || (await getLicenceLocale())) {
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

export async function creerFeuillet(payload: FeuilletCreate): Promise<Feuillet> {
  const licence = await getLicenceLocale();
  if (licence) {
    const quota = licence.payload.quotaFeuillets;
    if (quota != null && (await compterFeuilletsProduits()) >= quota) {
      throw new QuotaFeuilletsAtteint(quota);
    }
    const cree = await enregistrerCreationLocale(payload);
    await incrementerFeuilletsProduits();
    synchroniserUsageChorale().catch(() => {});
    return cree;
  }
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
  // Le feuillet lui-même n'a jamais atteint (et n'atteindra jamais, pour une
  // chorale locale) le serveur -- pas la peine de tenter un PUT.
  if (estFeuilletLocal(id) || (await getLicenceLocale())) {
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

export async function supprimerFeuillet(id: number): Promise<{ ok: boolean }> {
  if (estFeuilletLocal(id) || (await getLicenceLocale())) {
    await supprimerFeuilletLocal(id);
    return { ok: true };
  }
  return apiFetch<{ ok: boolean }>(`/feuillets/${id}`, { method: "DELETE" });
}

export interface DepassementPdf {
  message: string;
  moments_en_cause: string[];
}

export interface PdfLocal {
  uri: string;
}

// Télécharge le PDF vers un fichier local (cache) -- repli réseau utilisé
// uniquement par render/genererPdfLocal.ts::obtenirPdfAvecRepliLocal si le
// rendu local échoue de façon inattendue (jamais le chemin normal, jamais
// atteint par un compte chorale sans réseau -- la tentative échoue alors
// simplement, et l'erreur de rendu local d'origine est celle affichée).
export async function telechargerFeuilletPdf(id: number): Promise<PdfLocal> {
  await verifierAccesReseau(`/feuillets/${id}/pdf`);
  const dest = `${FileSystem.cacheDirectory}feuillet_${id}_${Date.now()}.pdf`;
  const headers = await jetonAuthorizationHeader();
  const url = `${API_BASE_URL}/feuillets/${id}/pdf`;
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
