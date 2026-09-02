import { API_BASE_URL } from "../config";
import { getJetonSession, getAppareilId, getLicenceLocale, effacerLicenceLocale, effacerJetonSession } from "../storage/secureStore";
import { calculerPreuveMessagerie } from "../licence/preuveMessagerie";

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

/**
 * Une licence chorale active désigne un poste autonome : ses données et son
 * authentification sont locales. Le seul échange autorisé est la
 * messagerie, authentifiée par sa preuve dédiée. Ce garde-fou central évite
 * qu'un nouvel écran (ou un appel oublié) ne réintroduise silencieusement
 * une dépendance au serveur.
 */
export async function verifierAccesReseau(path: string): Promise<void> {
  const licence = await getLicenceLocale();
  // Exception minimale : le numéro public de l'administrateur est demandé
  // uniquement au tap sur « Contacter », puis mis en cache. Aucun contenu de
  // chorale ni identifiant de licence ne quitte l'appareil.
  if (licence && !path.startsWith("/messages") && path !== "/licences/synchroniser-usage" && path !== "/parametres/contact-admin") {
    throw new ApiError(0, "Cette fonction est disponible localement pour la chorale et ne contacte pas le serveur.");
  }
}

// Compte chorale (licence locale) : plus aucune notion de session/Bearer --
// seule la Messagerie appelle encore le réseau, prouvée par possession du
// `seed` de la licence (voir licence/preuveMessagerie.ts et
// backend/app/messages_auth.py). Compte super-admin : Bearer + X-Appareil-Id
// classiques, inchangés.
async function jeton(authentifie: boolean | undefined, chemin = "/messages", methode = "GET"): Promise<Record<string, string>> {
  if (authentifie === false) return {};
  const licence = await getLicenceLocale();
  if (licence) {
    const horodatage = Math.floor(Date.now() / 1000);
    return calculerPreuveMessagerie(licence.payload.seed, licence.payload.choraleId, licence.payload.licenceUid, horodatage, methode, chemin.split("?")[0]);
  }
  const j = await getJetonSession();
  if (!j) return {};
  // X-Appareil-Id : permet au backend de vérifier en CONTINU (à chaque
  // requête, pas seulement à l'activation) que CET appareil précis est
  // toujours autorisé sur la licence de la chorale -- voir main.py::
  // AuthMiddleware côté serveur. Absent pour un compte super-admin (pas de
  // notion d'appareil/licence) ou avant toute activation.
  const appareilId = await getAppareilId();
  return {
    Authorization: `Bearer ${j}`,
    ...(appareilId ? { "X-Appareil-Id": appareilId } : {}),
  };
}

// Enregistré par App.tsx au démarrage : appelé dès qu'une réponse serveur
// signale que la licence de CET appareil n'est plus valide (révoquée,
// expirée, ou cet appareil précis retiré par l'admin) -- voir
// main.py::_refuser_licence côté backend, code "licence_invalide" distinct
// d'un 401 générique pour ne pas laisser croire qu'un simple nouveau login
// suffirait. Efface la session ET l'activation locale (pas seulement la
// session) puisque le problème est la licence elle-même, pas les
// identifiants -- resoumettre un login échouerait à nouveau immédiatement.
let gestionnaireLicenceInvalide: ((message: string) => void) | null = null;
export function definirGestionnaireLicenceInvalide(fn: (message: string) => void): void {
  gestionnaireLicenceInvalide = fn;
}

function messageErreur(donnees: any, status: number): string {
  const detail = donnees?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && typeof detail.message === "string") return detail.message;
  return `Erreur ${status}`;
}

// Un hébergement gratuit (Render) met le service en veille après inactivité :
// la toute première requête qui le réveille peut échouer au niveau réseau
// (connexion coupée pendant le réveil, pas une erreur HTTP) avant qu'un
// simple nouvel essai ne fonctionne -- même logique que fetchAvecRetry côté
// web (app.js). Sans ça, un tap sur "Créer"/"PDF" pouvait rejeter tout de
// suite sur ce premier essai raté et laisser le bouton sans retour clair.
async function fetchAvecRetry(url: string, creerInit: () => Promise<RequestInit>, tentatives = 2, delaiMs = 1500): Promise<Response> {
  for (let i = 0; i < tentatives; i++) {
    try {
      // Une tentative reçoit de nouveaux en-têtes, donc un nouveau nonce
      // HMAC lorsqu'il s'agit de Messagerie. Réutiliser le même init ferait
      // rejeter une reprise légitime par la protection anti-rejeu.
      return await fetch(url, await creerInit());
    } catch (erreur) {
      if (i === tentatives - 1) throw erreur;
      await new Promise((resolve) => setTimeout(resolve, delaiMs));
    }
  }
  throw new Error("fetchAvecRetry: aucune tentative effectuée");
}

// Attache le jeton de session en `Authorization: Bearer` -- l'app ne
// persistant pas les cookies entre deux lancements, c'est le seul mécanisme
// de session côté mobile (voir routers/auth.py::login côté backend).
export async function apiFetch<T>(path: string, options: Options = {}): Promise<T> {
  await verifierAccesReseau(path);
  const methode = options.method ?? "GET";
  const reponse = await fetchAvecRetry(
    `${API_BASE_URL}${path}`,
    async () => ({
      method: methode,
      headers: { "Content-Type": "application/json", ...(await jeton(options.authentifie, path, methode)) },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    }),
  );

  const texte = await reponse.text();
  const donnees = texte ? JSON.parse(texte) : null;

  if (!reponse.ok) {
    if (donnees?.code === "licence_invalide") {
      await Promise.all([effacerLicenceLocale(), effacerJetonSession()]);
      gestionnaireLicenceInvalide?.(messageErreur(donnees, reponse.status));
    }
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
  await verifierAccesReseau(path);
  const methode = options.method ?? "POST";
  const reponse = await fetchAvecRetry(
    `${API_BASE_URL}${path}`,
    async () => ({ method: methode, headers: await jeton(options.authentifie, path, methode), body: form as any }),
  );
  const texte = await reponse.text();
  const donnees = texte ? JSON.parse(texte) : null;
  if (!reponse.ok) {
    if (donnees?.code === "licence_invalide") {
      await Promise.all([effacerLicenceLocale(), effacerJetonSession()]);
      gestionnaireLicenceInvalide?.(messageErreur(donnees, reponse.status));
    }
    throw new ApiError(reponse.status, messageErreur(donnees, reponse.status), donnees?.detail);
  }
  return donnees as T;
}

export async function jetonAuthorizationHeader(chemin = "/messages", methode = "GET"): Promise<Record<string, string>> {
  return jeton(true, chemin, methode);
}
