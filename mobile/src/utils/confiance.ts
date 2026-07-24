// Seuils de confiance ML partagés (Éditeur + Import, voir app.js web) --
// centralisés ici pour ne pas dupliquer les mêmes bornes 0.8/0.4 partout.
export type NiveauConfiance = "importe" | "a_verifier" | "echec";

export function niveauConfiance(confiance: number): NiveauConfiance {
  if (confiance >= 0.8) return "importe";
  if (confiance >= 0.4) return "a_verifier";
  return "echec";
}

export const LABEL_CONFIANCE: Record<NiveauConfiance, string> = {
  importe: "Importé",
  a_verifier: "À vérifier",
  echec: "Échec",
};

export const COULEUR_CONFIANCE: Record<NiveauConfiance, string> = {
  importe: "#16a34a",
  a_verifier: "#d97706",
  echec: "#dc2626",
};
