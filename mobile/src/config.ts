import { Platform } from "react-native";

// Configuration de l'API centrale DepliantApp (Vercel & Neon Postgres)
// Permet de configurer l'URL via la variable d'environnement EXPO_PUBLIC_API_URL
const URL_DEV = "http://localhost:8000";
const URL_PRODUCTION = process.env.EXPO_PUBLIC_API_URL || "https://depliantapp.vercel.app";

function resoudreApiBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin) {
    // Si l'application web tourne en local sur un port différent du backend, on cible le port 8000
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      return URL_DEV;
    }
    return window.location.origin;
  }
  return __DEV__ ? URL_DEV : URL_PRODUCTION;
}

export const API_BASE_URL = resoudreApiBaseUrl();
