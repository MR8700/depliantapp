import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

// File d'attente locale des carnets à importer, choisis hors-ligne. Le
// moteur de segmentation (ingestion/*.py) ne peut pas être porté sur mobile
// (dépend de Word COM côté serveur pour les .doc) -- impossible d'analyser
// le carnet localement. À défaut, le fichier choisi est copié dans un
// dossier persistant de l'app (le cache/les URIs `content://` du picker ne
// survivent pas forcément à un redémarrage) et mis en attente d'envoi, pour
// que le retour réseau se traduise par une reprise en un tap plutôt qu'un
// nouveau choix de fichier depuis zéro.
const DOSSIER = `${FileSystem.documentDirectory}import_outbox/`;
const CLE_OUTBOX = "depliantapp.import_outbox";

export interface EntreeImportOutbox {
  cle: string;
  uriLocal: string;
  nom: string;
  mimeType: string;
  categorieDefaut: string;
  occasions: string;
  langue: string;
  auteur: string;
  creeLe: string;
}

export async function lireImportOutbox(): Promise<EntreeImportOutbox[]> {
  const brut = await AsyncStorage.getItem(CLE_OUTBOX);
  return brut ? JSON.parse(brut) : [];
}

export async function ajouterAImportOutbox(
  fichier: { uri: string; nom: string; mimeType: string },
  params: { categorieDefaut: string; occasions: string; langue: string; auteur: string },
): Promise<EntreeImportOutbox> {
  await FileSystem.makeDirectoryAsync(DOSSIER, { intermediates: true }).catch(() => {});
  const cle = `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const uriLocal = `${DOSSIER}${cle}_${fichier.nom}`;
  await FileSystem.copyAsync({ from: fichier.uri, to: uriLocal });
  const entree: EntreeImportOutbox = { cle, uriLocal, nom: fichier.nom, mimeType: fichier.mimeType, ...params, creeLe: new Date().toISOString() };
  const liste = await lireImportOutbox();
  liste.push(entree);
  await AsyncStorage.setItem(CLE_OUTBOX, JSON.stringify(liste));
  return entree;
}

export async function retirerDImportOutbox(cle: string): Promise<void> {
  const liste = await lireImportOutbox();
  const entree = liste.find((e) => e.cle === cle);
  await AsyncStorage.setItem(CLE_OUTBOX, JSON.stringify(liste.filter((e) => e.cle !== cle)));
  if (entree) await FileSystem.deleteAsync(entree.uriLocal, { idempotent: true });
}
