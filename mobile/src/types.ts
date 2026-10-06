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
  /** Références bibliques saisies manuellement (ex. "Mt 17, 1-9") -- sert au
   * rapprochement EXACT avec les lectures du jour AELF, voir aelf/matching.ts. */
  references_bibliques: string[];
  actif: boolean;
  favori: boolean;
  chant_principal: boolean;
  duree_estimee: string | null;
  tonalite: string | null;
  remarques: string | null;
  auteur: string | null;
  compositeur: string | null;
  source_file: string | null;
  confiance: number;
  // Validation manuelle du badge "à vérifier" -- distincte de `confiance`
  // (score ML), voir schemas.Chant côté backend.
  valide_manuellement: boolean;
  propose_par_chorale_id: number | null;
  propose_par_chorale_nom: string | null;
  // Jamais réglable côté client -- décidé par le serveur selon qui crée le
  // chant et le réglage admin chants_publication_auto (voir
  // routers/chants.py::create_chant). "chorale" = visible seulement de
  // chorale_proprietaire_id (et du super-admin) tant qu'un administrateur ne
  // l'a pas publié.
  chorale_proprietaire_id: number | null;
  chorale_proprietaire_nom: string | null;
  visibilite: "publique" | "chorale";
}

export type ChantCreate = Omit<Chant, "id" | "source_file" | "confiance" | "valide_manuellement" | "propose_par_chorale_id" | "propose_par_chorale_nom" | "chorale_proprietaire_id" | "chorale_proprietaire_nom" | "visibilite">;

export type ChantUpdate = Partial<ChantCreate>;

// Audio/vidéo facultatifs attachés à un chant -- voir db.py::chant_medias.
// Jamais utilisés sur les feuillets PDF, juste affichés/écoutables dans le
// détail du chant.
export interface ChantMedia {
  id: number;
  chant_id: number;
  type: "audio" | "video";
  filename: string;
  content_type: string | null;
  chorale_id: number | null;
  chorale_nom: string | null;
  chant_titre: string | null;
  statut: "a_verifier" | "validee" | "revoquee";
  created_at: string;
}

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
  /** Agrandissement ciblé (en pt, ajouté à la taille de corps de base) pour
   * ce chant/texte uniquement -- voir render/typography.ts. */
  taille_texte_supplement?: number | null;
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
  visibilite: "chorale" | "demande_publication" | "publique";
  created_at: string | null;
}
