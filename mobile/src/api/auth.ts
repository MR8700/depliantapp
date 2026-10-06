import { apiFetch } from "./client";
import { setJetonSession, effacerJetonSession, getJetonSession } from "../storage/secureStore";

interface ReponseLogin {
  ok: boolean;
  must_change_password: boolean;
  jeton: string;
}

export async function login(username: string, password: string): Promise<ReponseLogin> {
  const reponse = await apiFetch<ReponseLogin>("/auth/login", {
    method: "POST",
    authentifie: false,
    body: { username, password },
  });
  await setJetonSession(reponse.jeton);
  return reponse;
}

export interface SessionInfo {
  id: number;
  compte_type: string;
  compte_id: number;
  username: string;
  device_nom: string;
  ip_address: string;
  created_at: string;
  last_active: string;
  is_active: boolean;
  est_actuelle: boolean;
}

/** Vérifie auprès du serveur si la session est toujours valide */
export async function verifierSessionServeur(): Promise<boolean> {
  const token = await getJetonSession();
  if (!token) return false;
  try {
    const res = await apiFetch<{ authenticated: boolean; type?: string }>("/auth/status");
    if (res.authenticated) {
      return true;
    }
    await effacerJetonSession();
    return false;
  } catch {
    // Si hors-ligne temporaire, on conserve la session pour ne pas déconnecter intempestivement
    return true;
  }
}

/** Alias pour rétro-compatibilité */
export const verifierSessionAdminServeur = verifierSessionServeur;

/** Liste les sessions actives de l'utilisateur connecté */
export async function listerSessions(): Promise<SessionInfo[]> {
  return await apiFetch<SessionInfo[]>("/auth/sessions");
}

/** Révoque une session spécifique */
export async function revoquerSession(sessionId: number): Promise<void> {
  await apiFetch(`/auth/sessions/${sessionId}`, { method: "DELETE" });
}

/** Révoque toutes les autres sessions ouvertes */
export async function revoquerAutresSessions(): Promise<{ count: number }> {
  return await apiFetch<{ count: number }>("/auth/sessions/revoke-others", { method: "POST" });
}

/** Enregistre le changement de mot de passe directement sur le serveur */
export async function changerMotDePasseAdminServeur(motDePasseActuel: string, nouveauMotDePasse: string): Promise<void> {
  await apiFetch("/auth/change-password", {
    method: "POST",
    body: {
      mot_de_passe_actuel: motDePasseActuel,
      nouveau_mot_de_passe: nouveauMotDePasse,
    },
  });
}

/** Déconnecte la session sur le serveur et localement */
export async function logoutAdminServeur(): Promise<void> {
  try {
    await apiFetch("/auth/logout", { method: "POST" });
  } catch {}
  await effacerJetonSession();
}
