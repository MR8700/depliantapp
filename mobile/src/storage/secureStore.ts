import * as SecureStore from "expo-secure-store";

// Clés SecureStore. Tout ce qui décide de l'écran de démarrage (activation
// faite ? session encore valide ?) est lu ICI, en local, sans appel réseau --
// voir App.tsx::resoudreEcranInitial. Seule l'activation (POST
// /licences/activer) exige une connexion internet.
const CLE_APPAREIL_ID = "depliantapp.appareil_id";
const CLE_JETON_ACTIVATION = "depliantapp.jeton_activation";
const CLE_CHORALE_ID = "depliantapp.chorale_id";
const CLE_CHORALE_NOM = "depliantapp.chorale_nom";
const CLE_JETON_SESSION = "depliantapp.jeton_session";

export async function getAppareilId(): Promise<string | null> {
  return SecureStore.getItemAsync(CLE_APPAREIL_ID);
}

export async function setAppareilId(id: string): Promise<void> {
  await SecureStore.setItemAsync(CLE_APPAREIL_ID, id);
}

export interface ActivationStockee {
  jeton: string;
  choraleId: number;
  choraleNom: string;
}

export async function getActivation(): Promise<ActivationStockee | null> {
  const [jeton, choraleIdStr, choraleNom] = await Promise.all([
    SecureStore.getItemAsync(CLE_JETON_ACTIVATION),
    SecureStore.getItemAsync(CLE_CHORALE_ID),
    SecureStore.getItemAsync(CLE_CHORALE_NOM),
  ]);
  if (!jeton || !choraleIdStr || !choraleNom) return null;
  return { jeton, choraleId: Number(choraleIdStr), choraleNom };
}

export async function setActivation(activation: ActivationStockee): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(CLE_JETON_ACTIVATION, activation.jeton),
    SecureStore.setItemAsync(CLE_CHORALE_ID, String(activation.choraleId)),
    SecureStore.setItemAsync(CLE_CHORALE_NOM, activation.choraleNom),
  ]);
}

export async function effacerActivation(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(CLE_JETON_ACTIVATION),
    SecureStore.deleteItemAsync(CLE_CHORALE_ID),
    SecureStore.deleteItemAsync(CLE_CHORALE_NOM),
  ]);
}

export async function getJetonSession(): Promise<string | null> {
  return SecureStore.getItemAsync(CLE_JETON_SESSION);
}

export async function setJetonSession(jeton: string): Promise<void> {
  await SecureStore.setItemAsync(CLE_JETON_SESSION, jeton);
}

export async function effacerJetonSession(): Promise<void> {
  await SecureStore.deleteItemAsync(CLE_JETON_SESSION);
}
