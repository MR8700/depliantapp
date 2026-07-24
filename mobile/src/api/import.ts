import { apiFetchForm, apiFetch } from "./client";

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

export async function uploaderCarnet(params: {
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
