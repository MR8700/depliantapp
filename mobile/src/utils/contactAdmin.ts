import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, Linking } from "react-native";
import { apiFetch } from "../api/client";

const CLE_CACHE = "depliantapp.contact_whatsapp_admin";
const NUMERO_DEFAUT = "22652045008";

async function numeroAdmin(): Promise<string> {
  try {
    const res = await apiFetch<{ whatsapp?: string }>("/parametres/contact-admin", { authentifie: false });
    const numero = String(res.whatsapp ?? "").replace(/\D/g, "");
    if (numero) { await AsyncStorage.setItem(CLE_CACHE, numero); return numero; }
  } catch {}
  return (await AsyncStorage.getItem(CLE_CACHE)) ?? NUMERO_DEFAUT;
}

export async function contacterAdminWhatsApp(message: string): Promise<void> {
  const numero = await numeroAdmin();
  const texte = encodeURIComponent(message);
  try {
    const urlApp = `whatsapp://send?phone=${numero}&text=${texte}`;
    await Linking.openURL((await Linking.canOpenURL(urlApp)) ? urlApp : `https://wa.me/${numero}?text=${texte}`);
  } catch {
    Alert.alert("WhatsApp indisponible", `Contacte l'administrateur au +${numero}.`);
  }
}
