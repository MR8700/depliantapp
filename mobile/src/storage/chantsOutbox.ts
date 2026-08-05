import AsyncStorage from "@react-native-async-storage/async-storage";
import { Chant, ChantCreate, ChantUpdate } from "../types";

// File d'attente locale des opérations sur la bibliothèque de chants
// effectuées hors-ligne, en attente de push vers le serveur (voir
// storage/sync.ts). `cle` est un identifiant local temporaire -- jamais
// envoyé au serveur, juste utilisé pour retirer l'entrée une fois poussée
// (ou fusionnée avec un doublon détecté, pour les créations).
//
// Les entrées "modification"/"suppression" ciblent un chant qui EXISTE déjà
// côté serveur (id connu) -- contrairement à une création, il n'y a pas de
// détection de doublon à faire, juste rejouer l'opération au retour réseau.
//
// `idLocal` (créations uniquement) : identifiant négatif stable, généré une
// seule fois à la création de l'entrée -- permet d'afficher ce chant dans la
// bibliothèque (rechercherChants, voir api/chants.ts) exactement comme un
// chant "réel" (sélection, édition, fiche détail) tant qu'il n'a pas atteint
// le serveur. Sans ça, la bibliothèque affichée une fois en ligne ne montrait
// QUE la réponse serveur : tout chant créé hors-ligne et pas encore
// synchronisé disparaissait purement et simplement de la liste dès que le
// réseau revenait, alors qu'il était toujours "vivant" dans l'outbox --
// donnant l'impression trompeuse que la bibliothèque locale avait été
// "remplacée" par celle du serveur au lieu d'être fusionnée avec elle.
export type EntreeOutbox =
  | { cle: string; type: "creation"; idLocal: number; payload: ChantCreate; creeLe: string }
  | { cle: string; type: "modification"; chantId: number; patch: ChantUpdate; creeLe: string }
  | { cle: string; type: "suppression"; chantId: number; creeLe: string };

const CLE_OUTBOX = "depliantapp.chants_outbox";

function nouvelleCle(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Compat : les entrées écrites par une version antérieure de l'app n'ont ni
// `type` ni `idLocal` (c'était alors toujours une création, sans identité
// propre) -- on les normalise à la lecture plutôt que de les perdre.
function normaliser(brut: any): EntreeOutbox {
  if (brut.type === "modification" || brut.type === "suppression") return brut;
  return { cle: brut.cle, type: "creation", idLocal: brut.idLocal ?? -Date.parse(brut.creeLe || new Date().toISOString()), payload: brut.payload, creeLe: brut.creeLe };
}

export async function lireOutbox(): Promise<EntreeOutbox[]> {
  const brut = await AsyncStorage.getItem(CLE_OUTBOX);
  if (!brut) return [];
  return (JSON.parse(brut) as any[]).map(normaliser);
}

async function ajouter<T extends EntreeOutbox>(entree: T): Promise<T> {
  const liste = await lireOutbox();
  liste.push(entree);
  await AsyncStorage.setItem(CLE_OUTBOX, JSON.stringify(liste));
  return entree;
}

export function ajouterAOutbox(payload: ChantCreate): Promise<Extract<EntreeOutbox, { type: "creation" }>> {
  return ajouter({ cle: nouvelleCle(), type: "creation", idLocal: -Date.now(), payload, creeLe: new Date().toISOString() });
}

// Si une modification est déjà en attente pour ce même chant, on la remplace
// plutôt que d'empiler deux PATCH (le plus récent contient déjà tous les
// champs modifiés cumulés -- voir api/chants.ts::modifierChant).
export async function ajouterModificationAOutbox(chantId: number, patch: ChantUpdate): Promise<EntreeOutbox> {
  const liste = await lireOutbox();
  const existante = liste.find((e) => e.type === "modification" && e.chantId === chantId) as
    | Extract<EntreeOutbox, { type: "modification" }>
    | undefined;
  if (existante) {
    existante.patch = { ...existante.patch, ...patch };
    await AsyncStorage.setItem(CLE_OUTBOX, JSON.stringify(liste));
    return existante;
  }
  return ajouter({ cle: nouvelleCle(), type: "modification", chantId, patch, creeLe: new Date().toISOString() });
}

// Une suppression en attente rend caduque toute modification déjà en file
// pour le même chant (pas la peine de pousser un PATCH sur un chant qu'on va
// supprimer juste après).
export async function ajouterSuppressionAOutbox(chantId: number): Promise<EntreeOutbox> {
  const liste = (await lireOutbox()).filter((e) => !("chantId" in e) || e.chantId !== chantId);
  await AsyncStorage.setItem(CLE_OUTBOX, JSON.stringify(liste));
  return ajouter({ cle: nouvelleCle(), type: "suppression", chantId, creeLe: new Date().toISOString() });
}

export async function retirerDeOutbox(cle: string): Promise<void> {
  const liste = await lireOutbox();
  await AsyncStorage.setItem(CLE_OUTBOX, JSON.stringify(liste.filter((e) => e.cle !== cle)));
}

/** Nombre d'opérations en attente pour un chant donné (modification et/ou
 * suppression) -- sert à avertir l'UI (ex: SongDetailModal) qu'une action
 * locale n'a pas encore atteint le serveur. */
export async function operationsEnAttentePour(chantId: number): Promise<EntreeOutbox[]> {
  const liste = await lireOutbox();
  return liste.filter((e) => "chantId" in e && e.chantId === chantId);
}

type EntreeCreation = Extract<EntreeOutbox, { type: "creation" }>;

/** Reconstruit un `Chant` affichable à partir d'une création en attente --
 * mêmes champs par défaut que le placeholder historique de
 * SongDetailModal.tsx::enregistrer(), centralisés ici pour être réutilisés
 * partout où la bibliothèque doit fusionner "serveur + en attente". */
function versChant(entree: EntreeCreation): Chant {
  return {
    ...entree.payload, id: entree.idLocal, source_file: null, confiance: 1,
    valide_manuellement: false, propose_par_chorale_id: null, propose_par_chorale_nom: null,
  };
}

/** Toutes les créations encore en attente, sous forme de `Chant` -- à
 * fusionner avec la réponse serveur (voir api/chants.ts::rechercherChants). */
export async function chantsEnAttente(): Promise<Chant[]> {
  const liste = await lireOutbox();
  return liste.filter((e): e is EntreeCreation => e.type === "creation").map(versChant);
}

export function estChantLocal(id: number): boolean {
  return id < 0;
}

export async function getChantEnAttente(idLocal: number): Promise<Chant | null> {
  const liste = await lireOutbox();
  const entree = liste.find((e): e is EntreeCreation => e.type === "creation" && e.idLocal === idLocal);
  return entree ? versChant(entree) : null;
}

/** Édite une création encore en attente EN PLACE (jamais atteint le serveur,
 * donc pas de PATCH à envoyer -- juste mettre à jour le payload qui sera
 * poussé au prochain essai de synchronisation). */
export async function modifierChantEnAttente(idLocal: number, patch: ChantUpdate): Promise<Chant | null> {
  const liste = await lireOutbox();
  const entree = liste.find((e): e is EntreeCreation => e.type === "creation" && e.idLocal === idLocal);
  if (!entree) return null;
  entree.payload = { ...entree.payload, ...patch };
  await AsyncStorage.setItem(CLE_OUTBOX, JSON.stringify(liste));
  return versChant(entree);
}

/** Retire une création encore en attente (le chant n'a jamais existé côté
 * serveur -- rien à supprimer là-bas). */
export async function supprimerChantEnAttente(idLocal: number): Promise<void> {
  const liste = await lireOutbox();
  const entree = liste.find((e) => e.type === "creation" && e.idLocal === idLocal);
  if (entree) await retirerDeOutbox(entree.cle);
}
