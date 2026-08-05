import AsyncStorage from "@react-native-async-storage/async-storage";
import type { FilThread, Message } from "../api/messages";

// Cache de LECTURE seule pour la messagerie -- équivalent du localStorage
// web (cached_messages_super_{id} / cached_messages_chorale, voir app.js) :
// affiche les derniers messages/threads connus si le réseau échoue, pour
// éviter un écran vide. Aucune file d'envoi ici : la messagerie garde
// volontairement son exigence de connexion pour COMMUNIQUER (envoyer,
// réagir, marquer lu) -- seule la lecture du dernier état connu doit
// survivre à une coupure, comme sur le web.
const CLE_THREADS = "depliantapp.messagerie_threads_cache";
const clePourFil = (choraleId?: number) => `depliantapp.messagerie_cache_${choraleId ?? "chorale"}`;

export async function mettreEnCacheMessages(choraleId: number | undefined, messages: Message[]): Promise<void> {
  await AsyncStorage.setItem(clePourFil(choraleId), JSON.stringify(messages));
}

export async function lireMessagesCache(choraleId: number | undefined): Promise<Message[]> {
  const brut = await AsyncStorage.getItem(clePourFil(choraleId));
  return brut ? JSON.parse(brut) : [];
}

export async function mettreEnCacheThreads(threads: FilThread[]): Promise<void> {
  await AsyncStorage.setItem(CLE_THREADS, JSON.stringify(threads));
}

export async function lireThreadsCache(): Promise<FilThread[]> {
  const brut = await AsyncStorage.getItem(CLE_THREADS);
  return brut ? JSON.parse(brut) : [];
}
