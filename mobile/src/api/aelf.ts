import { apiFetch, ApiError } from "./client";
import { Chant } from "../types";
import { getJourEnCache, enregistrerJour, enregistrerLot, marquerSynchronise, getZoneEnCache, setZoneEnCache } from "../storage/lecturesCache";
import { lireCache as lireCacheChants } from "../storage/chantsCache";
import { scoreChantPourLectures, extraireLectures, ChantPourRapprochement } from "../aelf/matching";

export interface LectureAelf {
  type: string; // "lecture_1" | "lecture_2" | "psaume" | "evangile"
  titre: string | null;
  contenu: string | null; // HTML
  ref: string | null;
  intro_lue: string | null;
  refrain_psalmique: string | null;
  ref_refrain: string | null;
  verset_evangile: string | null;
  ref_verset: string | null;
}

export interface MesseAelf {
  nom: string;
  lectures: LectureAelf[];
}

export interface InformationsJourAelf {
  date: string;
  zone: string;
  couleur: string | null;
  jour_liturgique_nom: string | null;
  fete: string | null;
  degre: string | null;
  ligne1: string | null;
  ligne2: string | null;
  ligne3: string | null;
}

export interface JourAelf {
  date: string;
  zone: string;
  informations: InformationsJourAelf;
  messes: MesseAelf[];
}

export function chargerLecturesJourDistant(jour: string): Promise<JourAelf> {
  return apiFetch<JourAelf>(`/aelf/jour?jour=${jour}`);
}

export interface ReponseSynchronisation {
  traites: number;
  echecs: string[];
  restants: number;
}

export function synchroniserLot(depuis: string): Promise<ReponseSynchronisation> {
  return apiFetch<ReponseSynchronisation>(`/aelf/synchroniser?depuis=${depuis}`, { method: "POST" });
}

export interface JourEnCache {
  date: string;
  informations: InformationsJourAelf;
  messes: MesseAelf[];
}

export function telechargerAnneeEnCache(depuis: string): Promise<{ zone: string; jours: JourEnCache[] }> {
  return apiFetch(`/aelf/annee?depuis=${depuis}`);
}

export interface ChantAvecCorrespondance extends Chant {
  correspondance: number;
}

export function chargerChantsDuJourDistant(jour: string): Promise<{ date: string; informations: InformationsJourAelf; chants: ChantAvecCorrespondance[] }> {
  return apiFetch(`/aelf/chants-du-jour?jour=${jour}`);
}

// --- Réseau prioritaire, repli hors-ligne (même patron que partout ailleurs
// dans l'app -- voir api/feuillets.ts, api/chants.ts) -----------------------

/** Lectures d'un jour donné -- réseau si possible (et met à jour le cache
 * local au passage), sinon le cache local (utile seulement si ce jour a
 * déjà été synchronisé, voir synchroniserBibliothequeBiblique). */
export async function chargerLecturesJour(jour: string): Promise<JourAelf> {
  try {
    const distant = await chargerLecturesJourDistant(jour);
    await enregistrerJour(distant);
    return distant;
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    const local = await getJourEnCache(jour);
    if (local) return local;
    throw erreur;
  }
}

export interface ProgresSynchronisation {
  traites: number;
  total: number | null;
}

/** Télécharge l'année liturgique complète (~366 jours à partir
 * d'aujourd'hui) -- boucle sur /synchroniser (chaque appel ne traite qu'un
 * lot borné côté serveur, voir routers/aelf.py) puis rapatrie tout le cache
 * serveur d'un coup via /annee. `onProgres` permet d'afficher une barre de
 * progression (l'opération peut prendre plusieurs dizaines de secondes la
 * toute première fois, avant que le cache serveur -- partagé entre TOUTES
 * les chorales -- ne soit chaud). */
export async function synchroniserBibliothequeBiblique(
  onProgres?: (p: ProgresSynchronisation) => void,
): Promise<{ zone: string; nbJours: number }> {
  const aujourdHui = new Date().toISOString().slice(0, 10);
  let traites = 0;
  // Garde-fous anti-boucle-infinie : si AELF est injoignable, chaque lot
  // échoue en entier (traites=0) mais "restants" ne redescend jamais --
  // sans ce contrôle, la boucle tournerait indéfiniment (requêtes
  // ininterrompues vers le serveur) au lieu de remonter une erreur claire.
  // Le compteur d'itérations est une seconde limite indépendante, au cas où
  // "restants" progresserait mais anormalement lentement.
  let echecsConsecutifs = 0;
  let iterations = 0;
  for (;;) {
    iterations++;
    const resultat = await synchroniserLot(aujourdHui);
    traites += resultat.traites;
    onProgres?.({ traites, total: resultat.restants > 0 ? traites + resultat.restants : traites });
    if (resultat.restants <= 0) break;
    echecsConsecutifs = resultat.traites === 0 ? echecsConsecutifs + 1 : 0;
    if (echecsConsecutifs >= 3) {
      throw new Error("Impossible de contacter AELF -- la synchronisation a été interrompue. Réessaie plus tard.");
    }
    if (iterations >= 100) {
      throw new Error("La synchronisation prend anormalement longtemps -- réessaie plus tard.");
    }
  }
  const { zone, jours } = await telechargerAnneeEnCache(aujourdHui);
  await enregistrerLot(jours, zone);
  await setZoneEnCache(zone);
  await marquerSynchronise();
  return { zone, nbJours: jours.length };
}

/** Chants triés par correspondance avec les lectures d'un jour -- réseau
 * (rapprochement sur la bibliothèque COMPLÈTE côté serveur) si possible,
 * sinon rapprochement ENTIÈREMENT local (voir aelf/matching.ts) sur le
 * cache de chants déjà synchronisé -- ne fonctionne donc hors-ligne que si
 * la bibliothèque biblique (ce module) ET la bibliothèque de chants (voir
 * storage/chantsCache.ts) ont toutes deux déjà été synchronisées au moins
 * une fois. */
export async function chargerChantsDuJour(jour: string): Promise<{ date: string; informations: InformationsJourAelf | null; chants: ChantAvecCorrespondance[] }> {
  try {
    return await chargerChantsDuJourDistant(jour);
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    const jourCache = await getJourEnCache(jour);
    if (!jourCache) throw erreur;
    const lectures = extraireLectures(jourCache);
    const chants = await lireCacheChants();
    const resultats: ChantAvecCorrespondance[] = chants.map((chant) => {
      const cible: ChantPourRapprochement = {
        id: chant.id, titre: chant.titre, refrain: chant.refrain, couplets: chant.couplets,
        mots_cles: chant.mots_cles, references_bibliques: chant.references_bibliques,
      };
      return { ...chant, correspondance: Math.round(scoreChantPourLectures(cible, lectures) * 1000) / 1000 };
    });
    resultats.sort((a, b) => b.correspondance - a.correspondance);
    return { date: jour, informations: jourCache.informations, chants: resultats };
  }
}

export { getZoneEnCache, joursDisponibles, estSynchronise, derniereSyncLe } from "../storage/lecturesCache";
