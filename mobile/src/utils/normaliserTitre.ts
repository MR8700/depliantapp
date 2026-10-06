const REGEX_DIACRITIQUES = new RegExp("[\\u0300-\\u036f]", "g");

// Normalisation utilisée pour la détection de doublons (import de carnet,
// voir import/analyserLocal.ts) : accents retirés, casse et ponctuation
// ignorées -- "Ave Maria" / "Avé-Maria" / "AVE  MARIA" se résolvent au même
// identifiant.
export function normaliserTitre(titre: string): string {
  return titre
    .normalize("NFD")
    .replace(REGEX_DIACRITIQUES, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
