import AsyncStorage from "@react-native-async-storage/async-storage";
import { Chant } from "../types";
import { rechercherChants, creerChant } from "../api/chants";
import { fusionnerDansCache, lireCache } from "./chantsCache";
import { lireOutbox, retirerDeOutbox } from "./chantsOutbox";

const CLE_DERNIERE_SYNC = "depliantapp.derniere_sync_bibliotheque";
const REGEX_DIACRITIQUES = new RegExp("[\\u0300-\\u036f]", "g");

export interface ResultatSync {
  tires: number;
  pousses: number;
  doublonsEvites: number;
}

// Normalisation utilisée pour la détection de doublons : accents retirés,
// casse et ponctuation ignorées -- "Ave Maria" / "Avé-Maria" / "AVE  MARIA"
// se résolvent au même identifiant.
function normaliserTitre(titre: string): string {
  return titre
    .normalize("NFD")
    .replace(REGEX_DIACRITIQUES, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function indexerParTitre(chants: Chant[]): Map<string, Chant> {
  const index = new Map<string, Chant>();
  for (const chant of chants) index.set(normaliserTitre(chant.titre), chant);
  return index;
}

function trouverDoublon(titre: string, codeReference: string | null | undefined, index: Map<string, Chant>): Chant | null {
  const parTitre = index.get(normaliserTitre(titre));
  if (parTitre) return parTitre;
  if (codeReference?.trim()) {
    const refNormalisee = codeReference.trim().toLowerCase();
    for (const chant of index.values()) {
      if (chant.code_reference?.trim().toLowerCase() === refNormalisee) return chant;
    }
  }
  return null;
}

// Synchronisation bidirectionnelle de la bibliothèque partagée de chants :
//   1. PULL -- rapatrie l'intégralité de la bibliothèque distante dans le
//      cache local (sert de repli hors-ligne, voir chantsCache.ts).
//   2. PUSH -- envoie les chants créés hors-ligne (voir chantsOutbox.ts), en
//      vérifiant d'abord -- via un index construit une seule fois, donc en
//      O(1) par entrée plutôt qu'un aller-retour serveur par chant -- qu'une
//      autre chorale n'a pas déjà ajouté le même chant entretemps.
// N'est appelée que si la chorale a consenti (paramètre
// sync_bibliotheque_partagee, voir ReglagesScreen).
export async function synchroniserBibliotheque(): Promise<ResultatSync> {
  const distant = await rechercherChants({ limit: 2000 });
  await fusionnerDansCache(distant);

  const enAttente = await lireOutbox();
  let pousses = 0;
  let doublonsEvites = 0;

  if (enAttente.length > 0) {
    const cache = await lireCache();
    const index = indexerParTitre(cache);
    for (const chant of distant) index.set(normaliserTitre(chant.titre), chant);

    for (const entree of enAttente) {
      const doublon = trouverDoublon(entree.payload.titre, entree.payload.code_reference, index);
      if (doublon) {
        doublonsEvites++;
        await retirerDeOutbox(entree.cle);
        continue;
      }
      try {
        const cree = await creerChant(entree.payload);
        index.set(normaliserTitre(cree.titre), cree);
        await fusionnerDansCache([cree]);
        await retirerDeOutbox(entree.cle);
        pousses++;
      } catch {
        // Pas de connexion ou erreur serveur -- reste en attente, sera
        // retenté à la prochaine synchronisation.
      }
    }
  }

  await AsyncStorage.setItem(CLE_DERNIERE_SYNC, new Date().toISOString());
  return { tires: distant.length, pousses, doublonsEvites };
}

export async function dernieresSyncLe(): Promise<string | null> {
  return AsyncStorage.getItem(CLE_DERNIERE_SYNC);
}
