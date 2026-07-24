import { API_BASE_URL } from "../config";
import { getJetonSession } from "../storage/secureStore";

export class ApiError extends Error {
  /** Détail brut renvoyé par FastAPI -- objet structuré pour certaines
   * erreurs (ex. 409 de génération PDF : {message, moments_en_cause}). */
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

interface Options {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** false pour /licences/activer (aucune session à ce stade). */
  authentifie?: boolean;
}

async function jeton(authentifie: boolean | undefined): Promise<Record<string, string>> {
  if (authentifie === false) return {};
  const j = await getJetonSession();
  return j ? { Authorization: `Bearer ${j}` } : {};
}

function messageErreur(donnees: any, status: number): string {
  const detail = donnees?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && typeof detail.message === "string") return detail.message;
  return `Erreur ${status}`;
}

// Attache le jeton de session en `Authorization: Bearer` -- l'app ne
// persistant pas les cookies entre deux lancements, c'est le seul mécanisme
// de session côté mobile (voir routers/auth.py::login côté backend).
export async function apiFetch<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(await jeton(options.authentifie)) };

  const reponse = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const texte = await reponse.text();
  const donnees = texte ? JSON.parse(texte) : null;

  if (!reponse.ok) {
    throw new ApiError(reponse.status, messageErreur(donnees, reponse.status), donnees?.detail);
  }
  return donnees as T;
}

// Variante multipart (upload fichier/image/pièce jointe) -- ne fixe jamais
// Content-Type soi-même : fetch/RN génère la boundary correcte à partir du
// FormData, la fixer manuellement casse l'upload.
export async function apiFetchForm<T>(
  path: string,
  form: FormData,
  options: { method?: "POST" | "PUT"; authentifie?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = await jeton(options.authentifie);
  const reponse = await fetch(`${API_BASE_URL}${path}`, { method: options.method ?? "POST", headers, body: form as any });
  const texte = await reponse.text();
  const donnees = texte ? JSON.parse(texte) : null;
  if (!reponse.ok) {
    throw new ApiError(reponse.status, messageErreur(donnees, reponse.status), donnees?.detail);
  }
  return donnees as T;
}

export async function jetonAuthorizationHeader(): Promise<Record<string, string>> {
  return jeton(true);
}
