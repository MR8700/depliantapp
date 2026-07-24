import { apiFetch } from "./client";
import { setJetonSession } from "../storage/secureStore";

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
