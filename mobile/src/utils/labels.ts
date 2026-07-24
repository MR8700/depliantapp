// Recopié à l'identique depuis app.js (web) -- mêmes libellés, mêmes clés.
export const LABELS_MOMENTS: Record<string, string> = {
  Entree: "Entrée",
  Kyrie: "Kyrie",
  Gloria: "Gloria",
  Psaume: "Psaume",
  Acclamation: "Acclamation",
  Credo: "Credo",
  Priere_universelle: "Prière universelle",
  Offertoire: "Offertoire",
  Sanctus: "Sanctus",
  Anamnese: "Anamnèse",
  Notre_Pere: "Notre Père",
  Agnus: "Agnus",
  Communion: "Communion",
  Action_de_grace: "Action de grâce",
  Sortie: "Sortie",
};

export function categorieLabel(c: string | null | undefined): string {
  if (!c) return "Autre";
  return LABELS_MOMENTS[c] || c.replace(/_/g, " ");
}

export const NOMS_LANGUES: Record<string, string> = {
  fr: "Français",
  moore: "Mooré",
  dioula: "Dioula",
  la: "Latin",
  en: "Anglais",
  dagara: "Dagara",
  bissa: "Bissa",
  gulmancema: "Gulmancema",
  lingala: "Lingala",
  autre: "Autre",
};

export const LANGUES_OPTIONS = [
  { value: "", label: "Toutes langues" },
  { value: "fr", label: "Français" },
  { value: "moore", label: "Mooré" },
  { value: "dioula", label: "Dioula" },
  { value: "la", label: "Latin" },
  { value: "en", label: "Anglais" },
  { value: "dagara", label: "Dagara" },
  { value: "bissa", label: "Bissa" },
  { value: "gulmancema", label: "Gulmancema" },
  { value: "lingala", label: "Lingala" },
  { value: "autre", label: "Autre" },
];

const ICONES_CATEGORIE: Record<string, string> = {
  entree: "🎵", kyrie: "🙏", gloria: "✨", psaume: "📖", acclamation: "🎺",
  credo: "⛪", offertoire: "🍷", sanctus: "🔥", anamnese: "🙌", notre_pere: "🙏",
  agnus: "🐑", communion: "🍷", action_de_grace: "☀️", sortie: "🚶", autre: "🎵",
};

export function iconeCategorie(categorie: string | null | undefined): string {
  return ICONES_CATEGORIE[(categorie || "").toLowerCase()] || "🎵";
}

export type EtatChant = "actif" | "a-verifier" | "archive";

// Seuil et libellés identiques à chantCardHtml() côté web -- distinct du
// scoring ML de l'Éditeur/Import (voir utils/confiance.ts, seuils 0.8/0.4).
// `valide_manuellement` est une validation humaine explicite, distincte de
// `confiance` (score ML) -- voir schemas.Chant côté backend.
export function etatChant(chant: { actif: boolean; confiance: number; valide_manuellement?: boolean }): EtatChant {
  if (chant.actif === false) return "archive";
  if (chant.valide_manuellement) return "actif";
  if (chant.confiance < 0.7) return "a-verifier";
  return "actif";
}

export const LABEL_ETAT: Record<EtatChant, string> = {
  actif: "Actif",
  "a-verifier": "À vérifier",
  archive: "Archivé",
};

export const COULEUR_ETAT: Record<EtatChant, string> = {
  actif: "#16a34a",
  "a-verifier": "#d97706",
  archive: "#64748b",
};
