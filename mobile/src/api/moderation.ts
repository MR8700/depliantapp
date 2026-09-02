import * as FileSystem from "expo-file-system/legacy";
import { apiFetch, jetonAuthorizationHeader, verifierAccesReseau } from "./client";
import { API_BASE_URL } from "../config";

// Le déclenchement chorale (demanderSuppression) a été retiré : une chorale
// 100% locale est seule propriétaire de sa bibliothèque, suppression
// directe (voir api/chants.ts::supprimerChant/bulkSupprimer,
// api/feuillets.ts::supprimerFeuillet). Tout ce qui suit reste réservé au
// compte super-admin (file de modération, toujours en ligne).

export interface DemandeSuppression {
  id: number;
  type_cible: string;
  cible_id: number;
  chorale_demandeuse_id: number;
  statut: string;
  raison: string | null;
  created_at: string;
  apercu: Record<string, any> | null;
}

export function listerDemandes(statut = "en_attente"): Promise<DemandeSuppression[]> {
  return apiFetch<DemandeSuppression[]>(`/moderation/demandes?statut=${statut}`);
}

export function validerDemande(id: number) {
  return apiFetch<{ ok: boolean }>(`/moderation/demandes/${id}/valider`, { method: "POST" });
}

export function annulerDemande(id: number) {
  return apiFetch<{ ok: boolean }>(`/moderation/demandes/${id}/annuler`, { method: "POST" });
}

export function remettreEnAttente(id: number) {
  return apiFetch<{ ok: boolean }>(`/moderation/demandes/${id}/remettre_en_attente`, { method: "POST" });
}

export interface MasqueChorale {
  id: number;
  chorale_id: number;
  type_cible: string;
  cible_id: number;
  created_at: string;
  apercu: Record<string, any> | null;
}

export function listerMasques(): Promise<MasqueChorale[]> {
  return apiFetch<MasqueChorale[]>("/moderation/masques");
}

export function restaurerMasque(id: number) {
  return apiFetch<{ ok: boolean }>(`/moderation/masques/${id}`, { method: "DELETE" });
}

export interface CategoriePersonnalisee {
  id: number;
  nom: string;
  statut: string;
  motif_rejet: string | null;
  created_at: string;
  chorale_nom: string | null;
}

export function listerCategoriesModeration(statut = "en_attente"): Promise<CategoriePersonnalisee[]> {
  return apiFetch<CategoriePersonnalisee[]>(`/moderation/categories?statut=${statut}`);
}

export function validerCategorie(id: number) {
  return apiFetch<{ ok: boolean }>(`/moderation/categories/${id}/valider`, { method: "POST" });
}

export function rejeterCategorie(id: number, motif: string) {
  return apiFetch<{ ok: boolean }>(`/moderation/categories/${id}/rejeter`, { method: "POST", body: { motif } });
}

// --- Chants privés en attente de publication --------------------------------
// Un chant créé par une chorale reste privé (voir api/chants.ts::Chant.visibilite)
// tant qu'un administrateur ne l'a pas publié ici.

export function listerChantsPrives(): Promise<import("../types").Chant[]> {
  return apiFetch<import("../types").Chant[]>("/moderation/chants-prives");
}

export function publierChantPrive(id: number): Promise<import("../types").Chant> {
  return apiFetch<import("../types").Chant>(`/moderation/chants-prives/${id}/publier`, { method: "POST" });
}

// --- Dépliants en attente de publication ------------------------------------
// Même logique que les chants privés ci-dessus, une fois que la chorale
// propriétaire en a demandé la publication (voir api/feuillets.ts).

export function listerFeuilletsAValider(): Promise<import("../types").Feuillet[]> {
  return apiFetch<import("../types").Feuillet[]>("/moderation/feuillets-a-valider");
}

export function validerPublicationFeuillet(id: number): Promise<import("../types").Feuillet> {
  return apiFetch<import("../types").Feuillet>(`/moderation/feuillets-a-valider/${id}/valider`, { method: "POST" });
}

// --- Médias audio/vidéo en attente de modération ----------------------------
// Un média ajouté par une chorale (voir api/chants.ts::ajouterMediaChant)
// reste invisible des autres chorales jusqu'à validation ici -- SANS jamais
// affecter la visibilité du chant qui le porte.

export function listerMediasEnAttente(): Promise<import("../types").ChantMedia[]> {
  return apiFetch<import("../types").ChantMedia[]>("/moderation/medias-a-valider");
}

export function validerMedia(id: number): Promise<import("../types").ChantMedia> {
  return apiFetch<import("../types").ChantMedia>(`/moderation/medias-a-valider/${id}/valider`, { method: "POST" });
}

export function rejeterMedia(id: number): Promise<import("../types").ChantMedia> {
  return apiFetch<import("../types").ChantMedia>(`/moderation/medias-a-valider/${id}/rejeter`, { method: "POST" });
}

// --- Partitions (copies notées) en attente de vérification -------------
// Une seule partition "validee" à la fois par chant (voir crud.py::
// valider_partition, qui résilie automatiquement l'ancienne active) --
// contrairement aux médias audio/vidéo, jamais utilisées sur le rendu PDF
// des feuillets mais bien affichées/téléchargeables dans le détail du chant.

export function listerPartitionsAValider(): Promise<import("./chants").Partition[]> {
  return apiFetch<import("./chants").Partition[]>("/moderation/partitions");
}

export function validerPartition(id: number): Promise<import("./chants").Partition> {
  return apiFetch<import("./chants").Partition>(`/moderation/partitions/${id}/valider`, { method: "POST" });
}

export function rejeterPartition(id: number): Promise<import("./chants").Partition> {
  return apiFetch<import("./chants").Partition>(`/moderation/partitions/${id}/revoquer`, { method: "POST" });
}

// Même raison que api/chants.ts::telechargerPartition -- l'endpoint exige le
// jeton Bearer, à récupérer en fichier local avant de pouvoir l'ouvrir/le
// partager (une WebView ne peut pas attacher ce jeton à une requête média).
export async function telechargerApercuPartitionModeration(id: number): Promise<string> {
  await verifierAccesReseau(`/moderation/partitions/${id}/fichier`);
  const dest = `${FileSystem.cacheDirectory}partition_moderation_${id}.pdf`;
  const headers = await jetonAuthorizationHeader();
  const url = `${API_BASE_URL}/moderation/partitions/${id}/fichier`;
  const resultat = await FileSystem.downloadAsync(url, dest, { headers });
  if (resultat.status !== 200) {
    await FileSystem.deleteAsync(dest, { idempotent: true });
    throw new Error(`Erreur ${resultat.status} lors du téléchargement`);
  }
  return resultat.uri;
}
