import AsyncStorage from "@react-native-async-storage/async-storage";

// File d'attente locale des demandes de suppression (chant/feuillet) faites
// hors-ligne -- même famille de patron que chantsOutbox.ts, en plus simple
// (une seule opération possible, pas de modification/suppression de la
// demande elle-même côté chorale).
export interface DemandeEnAttente {
  cle: string;
  typeCible: "chant" | "feuillet";
  cibleId: number;
  raison: string;
  creeLe: string;
}

const CLE_OUTBOX = "depliantapp.moderation_outbox";

export async function lireDemandesEnAttente(): Promise<DemandeEnAttente[]> {
  const brut = await AsyncStorage.getItem(CLE_OUTBOX);
  return brut ? JSON.parse(brut) : [];
}

export async function ajouterDemandeEnAttente(typeCible: "chant" | "feuillet", cibleId: number, raison: string): Promise<void> {
  const liste = await lireDemandesEnAttente();
  liste.push({ cle: `demande-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, typeCible, cibleId, raison, creeLe: new Date().toISOString() });
  await AsyncStorage.setItem(CLE_OUTBOX, JSON.stringify(liste));
}

export async function retirerDemandeEnAttente(cle: string): Promise<void> {
  const liste = await lireDemandesEnAttente();
  await AsyncStorage.setItem(CLE_OUTBOX, JSON.stringify(liste.filter((d) => d.cle !== cle)));
}

// File d'attente des demandes de publication de dépliant faites hors-ligne
// (voir api/feuillets.ts::demanderPublicationFeuillet) -- même patron, un
// dépliant local (id négatif, pas encore synchronisé) ne peut pas encore
// être marqué publiable, il faut donc que sa création soit passée avant.
export interface PublicationEnAttente {
  cle: string;
  feuilletId: number;
  creeLe: string;
}

const CLE_OUTBOX_PUBLICATION = "depliantapp.publication_feuillet_outbox";

export async function lirePublicationsEnAttente(): Promise<PublicationEnAttente[]> {
  const brut = await AsyncStorage.getItem(CLE_OUTBOX_PUBLICATION);
  return brut ? JSON.parse(brut) : [];
}

export async function ajouterPublicationEnAttente(feuilletId: number): Promise<void> {
  const liste = await lirePublicationsEnAttente();
  if (liste.some((p) => p.feuilletId === feuilletId)) return;
  liste.push({ cle: `publication-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, feuilletId, creeLe: new Date().toISOString() });
  await AsyncStorage.setItem(CLE_OUTBOX_PUBLICATION, JSON.stringify(liste));
}

export async function retirerPublicationEnAttente(cle: string): Promise<void> {
  const liste = await lirePublicationsEnAttente();
  await AsyncStorage.setItem(CLE_OUTBOX_PUBLICATION, JSON.stringify(liste.filter((p) => p.cle !== cle)));
}
