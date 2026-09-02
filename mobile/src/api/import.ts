import { apiFetchForm, apiFetch, ApiError } from "./client";
import { analyserDocxLocal } from "../import/analyserLocal";
import { getLicenceLocale } from "../storage/secureStore";
import { creerChantLocal, modifierChantLocal } from "../storage/chantsLocal";
import { ChantCreate } from "../types";

// Levée pour un compte chorale (licence locale) qui tente d'importer un
// fichier sans équivalent d'analyse 100% locale (PDF, .doc) sans connexion
// -- seul le .docx a un moteur d'analyse embarqué (voir
// import/analyserLocal.ts, porté fidèlement depuis le serveur). Le PDF reste
// analysé côté serveur (comme .doc, qui exige Word/COM et n'a jamais eu
// d'équivalent local, même pour le compte super-admin).
export class ImportIndisponibleHorsLigne extends Error {
  constructor() {
    super("L'analyse de ce format nécessite une connexion internet -- seul le .docx s'importe entièrement hors-ligne.");
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

// Variante réseau "brute", sans repli hors-ligne -- utilisée directement par
// uploaderCarnet ci-dessous pour le compte super-admin.
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

// Compte chorale (licence locale) : le .docx s'analyse toujours entièrement
// en local (aucun appel réseau tenté). Le PDF n'a pas d'équivalent local
// (voir ImportIndisponibleHorsLigne) -- ImportScreen.tsx ne propose de
// toute façon que .docx/.pdf au sélecteur de fichiers pour ce rôle (.doc
// retiré, sans équivalent local ni serveur viable sur mobile). Compte
// super-admin : comportement réseau inchangé.
export async function uploaderCarnet(params: {
  uri: string; nom: string; mimeType: string;
  categorieDefaut: string; occasions: string; langue: string; auteur: string;
}): Promise<ReponseUpload> {
  const extension = params.nom.toLowerCase().slice(params.nom.lastIndexOf("."));
  if (await getLicenceLocale()) {
    if (extension === ".docx") {
      return analyserDocxLocal(params.uri, params.nom, {
        categorieDefaut: params.categorieDefaut, occasions: params.occasions, langue: params.langue, auteur: params.auteur,
      });
    }
    throw new ImportIndisponibleHorsLigne();
  }
  try {
    return await uploaderCarnetDistant(params);
  } catch (erreur) {
    if (erreur instanceof ApiError) throw erreur;
    if (extension === ".docx") {
      return analyserDocxLocal(params.uri, params.nom, {
        categorieDefaut: params.categorieDefaut, occasions: params.occasions, langue: params.langue, auteur: params.auteur,
      });
    }
    throw erreur;
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

export async function finaliserImport(chants: ChantAFinaliser[]): Promise<{ saved: number; replaced: number; ignored: number }> {
  if (await getLicenceLocale()) {
    let saved = 0, replaced = 0, ignored = 0;
    for (const c of chants) {
      if (c.action === "ignore") { ignored++; continue; }
      const payload: ChantCreate = {
        titre: c.titre, categorie: c.categorie, refrain: c.refrain || null, couplets: c.couplets,
        code_reference: c.code_reference ?? null, langue: c.langue, occasions: c.occasions,
        slug: null, mots_cles: [], references_bibliques: [], actif: true, favori: false,
        chant_principal: false, tonalite: null, duree_estimee: null, remarques: null,
        auteur: c.auteur ?? null, compositeur: c.compositeur ?? null,
      };
      if (c.action === "replace" && c.replace_id != null) {
        await modifierChantLocal(c.replace_id, payload);
        replaced++;
      } else {
        await creerChantLocal(payload);
        saved++;
      }
    }
    return { saved, replaced, ignored };
  }
  return apiFetch<{ saved: number; replaced: number; ignored: number }>("/import/finalize", {
    method: "POST", body: { chants },
  });
}
