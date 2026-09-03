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

/** Vérifie auprès du serveur si la session admin est toujours valide (ex: mot de passe non changé ailleurs) */
export async function verifierSessionAdminServeur(): Promise<boolean> {
  const token = await getJetonSession();
  if (!token) return false;
  try {
    const res = await apiFetch<{ authenticated: boolean; type?: string }>("/auth/status");
    if (res.authenticated && res.type === "super") {
      return true;
    }
    await effacerJetonSession();
    return false;
  } catch {
    // Si hors-ligne temporaire, on conserve la session pour ne pas déconnecter intempestivement
    return true;
  }
}

/** Enregistre le changement de mot de passe admin directement sur le serveur */
export async function changerMotDePasseAdminServeur(motDePasseActuel: string, nouveauMotDePasse: string): Promise<void> {
  await apiFetch("/auth/change-password", {
    method: "POST",
    body: {
      mot_de_passe_actuel: motDePasseActuel,
      nouveau_mot_de_passe: nouveauMotDePasse,
    },
  });
}

/** Déconnecte la session admin sur le serveur et localement */
export async function logoutAdminServeur(): Promise<void> {
  try {
    await apiFetch("/auth/logout", { method: "POST" });
  } catch {}
  await effacerJetonSession();
}
