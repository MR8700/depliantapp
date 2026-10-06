import * as Crypto from "expo-crypto";
import { apiFetch } from "./client";
import { getAppareilId, setAppareilId, getLicenceLocale, getAppareilsAutorises } from "../storage/secureStore";
import { compterFeuilletsProduits } from "../storage/feuilletsLocal";

export interface Licence {
  id: number;
  code: string;
  chorale_id: number | null;
  chorale_nom: string | null;
  max_appareils: number;
  expire_le: string | null;
  /** null = illimité. */
  quota_feuillets: number | null;
  feuillets_produits: number;
  statut: "active" | "revoquee";
  created_at: string;
  updated_at: string;
}

export interface ActivationAppareil {
  id: number;
  licence_id: number;
  appareil_id: string;
  appareil_nom: string | null;
  active_le: string;
  dernier_contact_le: string;
  revoque_le: string | null;
}

// --- Gestion admin (super-admin uniquement, voir routers/licences.py) -----

export function listerLicences(choraleId?: number): Promise<Licence[]> {
  return apiFetch<Licence[]>(`/licences${choraleId ? `?chorale_id=${choraleId}` : ""}`);
}

// `code` est un blob déjà signé localement par l'appli admin (voir
// licence/adminSignature.ts::signerLicence) -- ce serveur ne signe jamais
// rien, il vérifie (défense en profondeur) et enregistre le bookkeeping
// (voir backend/app/licences.py::creer_licence). La validité de la licence
// côté chorale ne dépend jamais de la réussite de cet appel réseau.
export function creerLicence(code: string, clePublique: string): Promise<Licence> {
  return apiFetch<Licence>("/licences", { method: "POST", body: { code, cle_publique: clePublique } });
}

export function validerLicenceBlob(code: string): Promise<{ cle_publique: string }> {
  return apiFetch<{ cle_publique: string }>("/licences/valider-blob", { method: "POST", body: { code }, authentifie: false });
}

// Reconfiguration complète d'une licence déjà créée : `code` est un NOUVEAU
// blob re-signé côté admin avec les valeurs voulues (voir
// licence/adminSignature.ts::reSignerLicence) -- distinct de
// /regenerer-code (identité de licence inchangée, juste ré-émise) et
// /revoquer (ne change que le statut de bookkeeping).
export function configurerLicence(licenceId: number, code: string): Promise<Licence> {
  return apiFetch<Licence>(`/licences/${licenceId}`, { method: "PUT", body: { code } });
}

export function listerActivationsLicence(licenceId: number): Promise<ActivationAppareil[]> {
  return apiFetch<ActivationAppareil[]>(`/licences/${licenceId}/activations`);
}

export function revoquerLicence(licenceId: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/licences/${licenceId}/revoquer`, { method: "POST" });
}

export function reactiverLicence(licenceId: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/licences/${licenceId}/reactiver`, { method: "POST" });
}

export function regenererCode(licenceId: number, code: string): Promise<{ code: string }> {
  return apiFetch<{ code: string }>(`/licences/${licenceId}/regenerer-code`, { method: "POST", body: { code } });
}

export function revoquerActivationAppareil(licenceId: number, appareilId: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/licences/${licenceId}/activations/${encodeURIComponent(appareilId)}`, { method: "DELETE" });
}

// L'identifiant d'appareil est généré UNE SEULE FOIS et persisté : le
// regénérer compterait comme un nouvel appareil auprès du quota
// max_appareils de la licence (voir app/licences.py côté backend).
export async function idAppareil(): Promise<string> {
  const existant = await getAppareilId();
  if (existant) return existant;
  const nouveau = Crypto.randomUUID();
  await setAppareilId(nouveau);
  return nouveau;
}

/** Envoie uniquement les compteurs demandés pour les statistiques admin. */
export async function synchroniserUsageChorale(nomAppareil?: string | null): Promise<void> {
  const licence = await getLicenceLocale();
  if (!licence) return;
  const [feuillets, appareilId, autorises] = await Promise.all([
    compterFeuilletsProduits(), idAppareil(), getAppareilsAutorises(),
  ]);
  await apiFetch("/licences/synchroniser-usage", {
    method: "POST",
    body: {
      feuillets_produits: feuillets,
      appareils: [
        { appareil_id: appareilId, appareil_nom: nomAppareil ?? "Appareil maître" },
        ...autorises.map((a) => ({ appareil_id: a.appareilId, appareil_nom: a.appareilNom })),
      ],
    },
  });
}
