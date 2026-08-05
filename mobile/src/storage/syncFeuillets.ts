import AsyncStorage from "@react-native-async-storage/async-storage";
import { creerFeuilletDistant, mettreAJourFeuilletDistant } from "../api/feuillets";
import { listerEnAttenteSync, marquerSynchronise } from "./feuilletsLocal";

const CLE_DERNIERE_SYNC = "depliantapp.derniere_sync_feuillets";

export interface ResultatSyncFeuillets {
  pousses: number;
  enAttente: number;
}

// Pousse les créations/modifications de feuillets en attente (voir
// feuilletsLocal.ts) vers le serveur. Appelle les variantes *Distant* de
// l'API (jamais creerFeuillet/mettreAJourFeuillet eux-mêmes) : celles-ci
// re-mettent en file d'attente locale sur échec réseau, ce qui doublonnerait
// l'entrée si on les appelait ici plutôt que de laisser l'entrée telle
// quelle pour une prochaine tentative.
export async function synchroniserFeuillets(): Promise<ResultatSyncFeuillets> {
  const enAttente = await listerEnAttenteSync();
  let pousses = 0;
  for (const entree of enAttente) {
    if (!entree.payloadEnAttente) continue;
    try {
      const resultat = entree.idServeurCible
        ? await mettreAJourFeuilletDistant(entree.idServeurCible, entree.payloadEnAttente)
        : await creerFeuilletDistant(entree.payloadEnAttente);
      await marquerSynchronise(entree.feuillet.id, resultat);
      pousses++;
    } catch {
      // Pas de connexion ou erreur serveur -- reste en attente, sera
      // retenté à la prochaine synchronisation.
    }
  }
  await AsyncStorage.setItem(CLE_DERNIERE_SYNC, new Date().toISOString());
  return { pousses, enAttente: enAttente.length - pousses };
}

export async function dernieresSyncFeuilletsLe(): Promise<string | null> {
  return AsyncStorage.getItem(CLE_DERNIERE_SYNC);
}
