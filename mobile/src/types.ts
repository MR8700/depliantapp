export interface Chant {
  id: number;
  titre: string;
  categorie: string;
  refrain: string | null;
  couplets: string[];
  code_reference: string | null;
  langue: string;
  occasions: string[];
  slug: string | null;
  mots_cles: string[];
  actif: boolean;
  favori: boolean;
  chant_principal: boolean;
  duree_estimee: string | null;
  tonalite: string | null;
  remarques: string | null;
  source_file: string | null;
  confiance: number;
  // Validation manuelle du badge "à vérifier" -- distincte de `confiance`
  // (score ML), voir schemas.Chant côté backend.
  valide_manuellement: boolean;
  propose_par_chorale_id: number | null;
  propose_par_chorale_nom: string | null;
}

export type ChantCreate = Omit<Chant, "id" | "source_file" | "confiance" | "valide_manuellement" | "propose_par_chorale_id" | "propose_par_chorale_nom">;

export type ChantUpdate = Partial<ChantCreate>;

export interface Identite {
  authenticated: boolean;
  type: "super" | "chorale";
  compte_id: number;
  nom: string;
  username: string;
  must_change_password: boolean;
  suppression_date_butoir: string | null;
  suppression_raison: string | null;
  suppression_delai_jours: number | null;
  suppression_demande_revision: number;
  suppression_revision_raison: string | null;
}

export interface Meta {
  moments: string[];
  categories: string[];
}

export interface MomentContenu {
  moment: string;
  type: "chant" | "texte_libre" | "reference";
  chant_id?: number | null;
  code_reference?: string | null;
  titre_libre?: string | null;
  texte_libre?: string | null;
  couplet_limit?: number | null;
  ordre?: number | null;
}

export interface Lectures {
  premiere_lecture?: string | null;
  psaume?: string | null;
  deuxieme_lecture?: string | null;
  evangile?: string | null;
}

export interface FeuilletBase {
  date: string;
  lieu?: string | null;
  lectures: Lectures;
  moments: MomentContenu[];
  priere_active: boolean;
  priere_texte?: string | null;
  taille_texte_manuelle?: number | null;
  one_page_mode: boolean;
  banniere_active: boolean;
}

export type FeuilletCreate = FeuilletBase;

export interface Feuillet extends FeuilletBase {
  id: number;
  chorale_id: number | null;
  clone_de_id: number | null;
  chorale_nom: string | null;
  created_at: string | null;
}
