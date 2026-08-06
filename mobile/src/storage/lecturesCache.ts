import AsyncStorage from "@react-native-async-storage/async-storage";
import { JourAelf, JourEnCache } from "../api/aelf";

// Une clé PAR JOUR (pas un seul blob annuel) : ~365 jours de lectures
// complètes (HTML compris) approchent la limite de taille par entrée
// d'AsyncStorage sur certains appareils Android si tout est stocké sous une
// seule clé -- séparer par jour reste aussi bien plus rapide à lire pour
// une seule date (pas besoin de parser toute l'année à chaque consultation).
const PREFIXE_JOUR = "depliantapp.aelf.jour.";
const CLE_INDEX = "depliantapp.aelf.index_jours";
const CLE_DERNIERE_SYNC = "depliantapp.aelf.derniere_sync";
const CLE_ZONE = "depliantapp.aelf.zone";

export async function getJourEnCache(jour: string): Promise<JourAelf | null> {
  const brut = await AsyncStorage.getItem(PREFIXE_JOUR + jour);
  return brut ? JSON.parse(brut) : null;
}

async function lireIndex(): Promise<string[]> {
  const brut = await AsyncStorage.getItem(CLE_INDEX);
  return brut ? JSON.parse(brut) : [];
}

async function ajouterAIndex(jours: string[]): Promise<void> {
  const existant = new Set(await lireIndex());
  for (const j of jours) existant.add(j);
  await AsyncStorage.setItem(CLE_INDEX, JSON.stringify([...existant].sort()));
}

export async function enregistrerJour(jour: JourAelf): Promise<void> {
  await AsyncStorage.setItem(PREFIXE_JOUR + jour.date, JSON.stringify(jour));
  await ajouterAIndex([jour.date]);
}

export async function enregistrerLot(jours: JourEnCache[], zone: string): Promise<void> {
  await Promise.all(
    jours.map((j) => AsyncStorage.setItem(PREFIXE_JOUR + j.date, JSON.stringify({ ...j, zone }))),
  );
  await ajouterAIndex(jours.map((j) => j.date));
}

export async function joursDisponibles(): Promise<string[]> {
  return lireIndex();
}

export async function estSynchronise(): Promise<boolean> {
  return (await AsyncStorage.getItem(CLE_DERNIERE_SYNC)) !== null;
}

export async function marquerSynchronise(): Promise<void> {
  await AsyncStorage.setItem(CLE_DERNIERE_SYNC, new Date().toISOString());
}

export async function derniereSyncLe(): Promise<string | null> {
  return AsyncStorage.getItem(CLE_DERNIERE_SYNC);
}

export async function getZoneEnCache(): Promise<string | null> {
  return AsyncStorage.getItem(CLE_ZONE);
}

export async function setZoneEnCache(zone: string): Promise<void> {
  await AsyncStorage.setItem(CLE_ZONE, zone);
}
