import { apiFetchForm, apiFetch, ApiError } from "./client";
import { ajouterAImportOutbox } from "../storage/importOutbox";

// Levée quand l'upload échoue faute de réseau (pas une erreur serveur) --
// le fichier a été mis en file d'attente locale (voir storage/importOutbox.ts)
// plutôt que de faire échouer l'import pour rien.
export class ImportMisEnAttente extends Error {
  constructor() {
    super("Pas de connexion -- le carnet a été mis en attente d'envoi, il sera analysable dès le retour du réseau.");
  }
}

export interface ChantExtrait {
  titre: string;
  refrain: string;
  couplets: string[];
  code_reference: string | null;
  confiance: number;
  categorie: string;
  occasions: string[];
  langue: string;
  auteur?: string | null;
  compositeur?: string | null;
  doublons: { id: number; titre: string; similarite: number }[];
  avertissements?: string[];
}

export interface ReponseUpload {
  fichier: string;
  chants: ChantExtrait[];
}

// Variante réseau "brute", sans repli hors-ligne -- réservée à
// storage/sync.ts (ré-essai d'une entrée de importOutbox : un échec ici doit
// la laisser en attente telle quelle, jamais recopier le fichier une
// seconde fois).
export function uploaderCarnetDistant(params: {
  uri: string; nom: string; mimeType: string;
  categorieDefaut: string; occasions: string; langue: string; auteur: string;
}): Promise<ReponseUpload> {
  const form = new FormData();
  form.append("fichier", { uri: params.uri, name: params.nom, type: params.mimeType } as any);
  form.append("categorie_defaut", params.categorieDefaut);
  form.append("occasions", params.occasions);
  form.append("langue", params.langue);
  // Appliqué comme défaut à tous les chants détectés dans ce carnet -- le
  // moteur de segmentation ne détecte pas d'auteur par chant (voir
  // routers/import_.py::upload_carnet).
  form.append("auteur", params.auteur);
  return apiFetchForm<ReponseUpload>("/import/upload", form, { method: "POST" });
}

export async function uploaderCarnet(params: {
  uri: string; nom: string; mimeType: string;
  categorieDefaut: string; occasions: string; langue: string; auteur: string;
}): Promise<ReponseUpload> {
  try {
    return await uploaderCarnetDistant(params);
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    await ajouterAImportOutbox(params, {
      categorieDefaut: params.categorieDefaut, occasions: params.occasions, langue: params.langue, auteur: params.auteur,
    });
    throw new ImportMisEnAttente();
  }
}

export interface ChantAFinaliser {
  action: "save" | "replace" | "ignore";
  replace_id?: number;
  titre: string;
  refrain?: string;
  couplets: string[];
  code_reference?: string | null;
  categorie: string;
  occasions: string[];
  confiance: number;
  langue: string;
  auteur?: string | null;
  compositeur?: string | null;
}

export function finaliserImport(chants: ChantAFinaliser[]) {
  return apiFetch<{ saved: number; replaced: number; ignored: number }>("/import/finalize", {
    method: "POST", body: { chants },
  });
}
