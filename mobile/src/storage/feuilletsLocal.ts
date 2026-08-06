import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feuillet, FeuilletCreate } from "../types";

// Stockage local unifié des feuillets : sert à la fois de cache "dernier état
// réseau connu" (repli hors-ligne pour la lecture, comme chantsCache.ts) et de
// file d'attente des créations/modifications qui ont échoué en réseau (comme
// chantsOutbox.ts) -- un feuillet peut être dans l'un ou l'autre état, jamais
// les deux à la fois, d'où un seul store plutôt que deux fichiers séparés.
export interface EntreeFeuilletLocal {
  feuillet: Feuillet;
  enAttenteSync: boolean;
  /** Payload exact à renvoyer au serveur -- absent si enAttenteSync est faux. */
  payloadEnAttente?: FeuilletCreate;
  /** id serveur réel à PUT ; null si c'est une création (POST) en attente. */
  idServeurCible?: number | null;
}

const CLE = "depliantapp.feuillets_local";

async function lireTout(): Promise<Record<number, EntreeFeuilletLocal>> {
  const brut = await AsyncStorage.getItem(CLE);
  return brut ? JSON.parse(brut) : {};
}

async function ecrireTout(tout: Record<number, EntreeFeuilletLocal>): Promise<void> {
  await AsyncStorage.setItem(CLE, JSON.stringify(tout));
}

export async function lireFeuilletsLocaux(): Promise<Feuillet[]> {
  return Object.values(await lireTout()).map((e) => e.feuillet);
}

export async function getFeuilletLocal(id: number): Promise<Feuillet | null> {
  const tout = await lireTout();
  return tout[id]?.feuillet ?? null;
}

// Fusionne le dernier état réseau connu -- jamais en attente de sync,
// puisqu'on vient justement de le recevoir du serveur.
export async function fusionnerFeuilletsDistants(feuillets: Feuillet[]): Promise<void> {
  const tout = await lireTout();
  for (const f of feuillets) tout[f.id] = { feuillet: f, enAttenteSync: false };
  await ecrireTout(tout);
}

// Création qui a échoué en réseau -- génère un id local négatif (même
// convention que le placeholder chant hors-ligne, voir
// SongDetailModal.tsx::enregistrer()), reste en attente jusqu'à la prochaine
// synchronisation.
export async function enregistrerCreationLocale(payload: FeuilletCreate): Promise<Feuillet> {
  const tout = await lireTout();
  const idLocal = -Date.now();
  const feuillet: Feuillet = {
    ...payload, id: idLocal, chorale_id: null, clone_de_id: null, chorale_nom: null,
    visibilite: "chorale", created_at: new Date().toISOString(),
  };
  tout[idLocal] = { feuillet, enAttenteSync: true, payloadEnAttente: payload, idServeurCible: null };
  await ecrireTout(tout);
  return feuillet;
}

// Modification qui a échoué en réseau. Si `id` désigne déjà un brouillon
// purement local (jamais atteint le serveur), met à jour cette MÊME entrée en
// place plutôt que d'en créer une nouvelle -- inutile d'empiler plusieurs
// versions non envoyées du même brouillon.
export async function enregistrerModificationLocale(id: number, payload: FeuilletCreate): Promise<Feuillet> {
  const tout = await lireTout();
  const existante = tout[id];
  const feuillet: Feuillet = existante
    ? { ...existante.feuillet, ...payload, id }
    : { ...payload, id, chorale_id: null, clone_de_id: null, chorale_nom: null, visibilite: "chorale", created_at: new Date().toISOString() };
  tout[id] = { feuillet, enAttenteSync: true, payloadEnAttente: payload, idServeurCible: id < 0 ? null : id };
  await ecrireTout(tout);
  return feuillet;
}

export async function listerEnAttenteSync(): Promise<EntreeFeuilletLocal[]> {
  return Object.values(await lireTout()).filter((e) => e.enAttenteSync);
}

// Remplace l'entrée locale (id négatif ou en attente) par l'état serveur
// définitif une fois la synchronisation réussie.
export async function marquerSynchronise(idLocal: number, feuilletServeur: Feuillet): Promise<void> {
  const tout = await lireTout();
  delete tout[idLocal];
  tout[feuilletServeur.id] = { feuillet: feuilletServeur, enAttenteSync: false };
  await ecrireTout(tout);
}

export async function supprimerFeuilletLocal(id: number): Promise<void> {
  const tout = await lireTout();
  delete tout[id];
  await ecrireTout(tout);
}

export function estFeuilletLocal(id: number): boolean {
  return id < 0;
}
