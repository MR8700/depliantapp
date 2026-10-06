import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch, ApiError } from "./client";
import { Identite, Meta } from "../types";
import { getLicenceLocale } from "../storage/secureStore";
import { META_PAR_DEFAUT } from "../utils/metaParDefaut";

const CLE_CACHE_META = "depliantapp.meta_cache";

// Moments liturgiques + catégories -- quasi statique, mais utilisé partout
// (Composer, Éditeur, Bibliothèque, sélecteur de chant, Import...). Compte
// chorale (licence locale) : jamais d'appel réseau -- dernier état mis en
// cache localement, ou à défaut la liste par défaut embarquée (voir
// utils/metaParDefaut.ts) pour une chorale qui n'a jamais eu l'occasion de
// se connecter. Compte super-admin : réseau prioritaire, repli sur le
// dernier état connu si l'appel échoue faute de connexion.
export async function getMeta(): Promise<Meta> {
  if (await getLicenceLocale()) {
    const brut = await AsyncStorage.getItem(CLE_CACHE_META);
    return brut ? JSON.parse(brut) : META_PAR_DEFAUT;
  }
  try {
    const meta = await apiFetch<Meta>("/meta");
    await AsyncStorage.setItem(CLE_CACHE_META, JSON.stringify(meta));
    return meta;
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    const brut = await AsyncStorage.getItem(CLE_CACHE_META);
    if (brut) return JSON.parse(brut);
    throw erreur;
  }
}

export function getIdentite(): Promise<Identite> {
  return apiFetch<Identite>("/auth/status");
}

// Équivalent du flux "Autre" du sélecteur de catégorie web (POST /categories,
// voir app.js ~4798) -- une chorale 100% locale n'a personne à qui demander
// validation (elle est seule propriétaire de sa bibliothèque, comme pour les
// médias/partitions ailleurs dans ce module) : la catégorie est ajoutée
// directement au cache local, sans appel réseau. Le super-admin, lui, appelle
// le backend (statut "valide" immédiat côté serveur, voir main.py::ajouter_categorie).
export async function creerCategorie(nom: string): Promise<string[]> {
  const nomNettoye = nom.trim();
  if (await getLicenceLocale()) {
    const meta = await getMeta();
    const categories = meta.categories.includes(nomNettoye) ? meta.categories : [...meta.categories.filter((c) => c !== "Autre"), nomNettoye, "Autre"];
    const nouveauMeta = { ...meta, categories };
    await AsyncStorage.setItem(CLE_CACHE_META, JSON.stringify(nouveauMeta));
    return categories;
  }
  const res = await apiFetch<{ categories: string[] }>("/categories", { method: "POST", body: { nom: nomNettoye } });
  const meta = await getMeta().catch(() => null);
  if (meta) await AsyncStorage.setItem(CLE_CACHE_META, JSON.stringify({ ...meta, categories: res.categories }));
  return res.categories;
}
