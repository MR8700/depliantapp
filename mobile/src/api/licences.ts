import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import { apiFetch } from "./client";
import { getAppareilId, setAppareilId } from "../storage/secureStore";

interface ReponseActivation {
  ok: boolean;
  jeton: string;
  chorale_id: number;
  chorale_nom: string;
}

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

export type MonAbonnement =
  | { licence: false }
  | {
      licence: true;
      statut: "active" | "revoquee";
      max_appareils: number;
      quota_feuillets: number | null;
      feuillets_produits: number;
      expire_le: string | null;
    };

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

export function creerLicence(
  choraleId: number, maxAppareils = 1, expireLe?: string | null, quotaFeuillets?: number | null,
): Promise<Licence> {
  return apiFetch<Licence>("/licences", {
    method: "POST",
    body: { chorale_id: choraleId, max_appareils: maxAppareils, expire_le: expireLe ?? null, quota_feuillets: quotaFeuillets ?? null },
  });
}

// Reconfiguration complète d'une licence déjà créée (les 3 valeurs sont
// toujours renvoyées, pas un patch partiel -- voir routers/licences.py).
export function configurerLicence(
  licenceId: number, maxAppareils: number, expireLe: string | null, quotaFeuillets: number | null,
): Promise<Licence> {
  return apiFetch<Licence>(`/licences/${licenceId}`, {
    method: "PUT",
    body: { max_appareils: maxAppareils, expire_le: expireLe, quota_feuillets: quotaFeuillets },
  });
}

// Vue chorale de sa propre licence -- alimente la section "Abonnement" de
// Réglages (voir ReglagesScreen.tsx).
export function obtenirMonAbonnement(): Promise<MonAbonnement> {
  return apiFetch<MonAbonnement>("/licences/mon-abonnement");
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

export function regenererCode(licenceId: number): Promise<{ code: string }> {
  return apiFetch<{ code: string }>(`/licences/${licenceId}/regenerer-code`, { method: "POST" });
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

export async function activerLicence(code: string): Promise<ReponseActivation> {
  const appareilId = await idAppareil();
  const nomAppareilCompose = `${Device.manufacturer ?? ""} ${Device.modelName ?? ""}`.trim();
  const nomAppareil = Device.deviceName ?? (nomAppareilCompose || "Appareil inconnu");
  return apiFetch<ReponseActivation>("/licences/activer", {
    method: "POST",
    authentifie: false,
    body: { code, appareil_id: appareilId, appareil_nom: nomAppareil },
  });
}
