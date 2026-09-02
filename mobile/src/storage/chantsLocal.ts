import AsyncStorage from "@react-native-async-storage/async-storage";
import { Chant, ChantCreate, ChantUpdate } from "../types";

// Store local AUTHORITATIF de la bibliothèque de chants pour un compte
// chorale (100% hors-ligne à vie -- plus jamais de serveur à atteindre pour
// cette donnée, donc plus de notion de "en attente de sync"). Distinct de
// storage/chantsCache.ts, qui reste le cache de résilience du compte
// super-admin (toujours en ligne, ne sert que de repli ponctuel si une
// requête réseau échoue) -- les deux comptes ne partagent jamais la même
// bibliothèque, donc jamais la même clé de stockage.
const CLE = "depliantapp.chants_locaux";
const CLE_COMPTEUR = "depliantapp.chants_locaux_compteur";

async function lireTout(): Promise<Record<number, Chant>> {
  const brut = await AsyncStorage.getItem(CLE);
  return brut ? JSON.parse(brut) : {};
}

async function ecrireTout(tout: Record<number, Chant>): Promise<void> {
  await AsyncStorage.setItem(CLE, JSON.stringify(tout));
}

// Ids négatifs, strictement décroissants -- jamais de collision possible
// avec un id serveur historique resté dans d'anciennes données importées.
async function prochainId(): Promise<number> {
  const brut = await AsyncStorage.getItem(CLE_COMPTEUR);
  const suivant = (brut ? Number(brut) : 0) - 1;
  await AsyncStorage.setItem(CLE_COMPTEUR, String(suivant));
  return suivant;
}

export async function listerChantsLocaux(): Promise<Chant[]> {
  return Object.values(await lireTout());
}

export async function getChantLocal(id: number): Promise<Chant | null> {
  const tout = await lireTout();
  return tout[id] ?? null;
}

// Aucun workflow de validation/modération : une chorale 100% locale est
// seule propriétaire de sa bibliothèque, il n'y a plus personne à qui
// soumettre un chant pour approbation.
export async function creerChantLocal(payload: ChantCreate): Promise<Chant> {
  const id = await prochainId();
  const chant: Chant = {
    ...payload, id, source_file: null, confiance: 1, valide_manuellement: true,
    propose_par_chorale_id: null, propose_par_chorale_nom: null,
    chorale_proprietaire_id: null, chorale_proprietaire_nom: null, visibilite: "chorale",
  };
  const tout = await lireTout();
  tout[id] = chant;
  await ecrireTout(tout);
  return chant;
}

export async function modifierChantLocal(id: number, patch: ChantUpdate): Promise<Chant> {
  const tout = await lireTout();
  if (!tout[id]) throw new Error("Chant introuvable");
  tout[id] = { ...tout[id], ...patch };
  await ecrireTout(tout);
  return tout[id];
}

export async function supprimerChantLocal(id: number): Promise<void> {
  const tout = await lireTout();
  delete tout[id];
  await ecrireTout(tout);
}

export async function viderBibliothequeLocale(): Promise<number> {
  const tout = await lireTout();
  const n = Object.keys(tout).length;
  await ecrireTout({});
  return n;
}
