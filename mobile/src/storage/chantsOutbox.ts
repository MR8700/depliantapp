import AsyncStorage from "@react-native-async-storage/async-storage";
import { ChantCreate } from "../types";

// File d'attente locale des chants créés hors-ligne, en attente de push vers
// la bibliothèque partagée (voir storage/sync.ts). `cle` est un identifiant
// local temporaire -- jamais envoyé au serveur, juste utilisé pour retirer
// l'entrée une fois poussée (ou fusionnée avec un doublon détecté).
export interface EntreeOutbox {
  cle: string;
  payload: ChantCreate;
  creeLe: string;
}

const CLE_OUTBOX = "depliantapp.chants_outbox";

export async function lireOutbox(): Promise<EntreeOutbox[]> {
  const brut = await AsyncStorage.getItem(CLE_OUTBOX);
  return brut ? JSON.parse(brut) : [];
}

export async function ajouterAOutbox(payload: ChantCreate): Promise<EntreeOutbox> {
  const liste = await lireOutbox();
  const entree: EntreeOutbox = {
    cle: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    payload,
    creeLe: new Date().toISOString(),
  };
  liste.push(entree);
  await AsyncStorage.setItem(CLE_OUTBOX, JSON.stringify(liste));
  return entree;
}

export async function retirerDeOutbox(cle: string): Promise<void> {
  const liste = await lireOutbox();
  await AsyncStorage.setItem(CLE_OUTBOX, JSON.stringify(liste.filter((e) => e.cle !== cle)));
}
