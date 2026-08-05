// Modèle de composition partagé, porté de backend/app/render/model.py :
// résout un feuillet en une liste de sections ordonnées, indépendamment du
// moteur de rendu. Un chant spécial ajouté par l'utilisateur se place
// exactement comme les autres, selon son "ordre".
import { Chant, Feuillet, MomentContenu } from "../types";
import { categorieLabel } from "../utils/labels";

export interface Song {
  titre: string | null;
  refrain: string | null;
  couplets: string[];
  /** Affiché en plus petit sous le titre -- même repli que partout ailleurs
   * (chant.auteur || chant.compositeur). */
  auteurCompositeur: string | null;
}

export interface Section {
  moment: string;
  label: string;
  song: Song;
  ordre: number;
}

/** Chant introuvable localement pour un moment donné -- contrairement au
 * backend (toujours en ligne), le mobile doit signaler explicitement ce cas
 * plutôt que de rendre un moment silencieusement vide : le chant n'est peut-
 * être simplement pas encore dans le cache local (voir storage/chantsCache.ts). */
export class ChantIntrouvableHorsLigne extends Error {
  constructor(public moment: string, public chantId: number) {
    super(`Chant #${chantId} introuvable dans la bibliothèque locale pour le moment « ${moment} ».`);
  }
}

function resoudreChant(moment: MomentContenu, chantsParId: Map<number, Chant>): Song {
  if (moment.type === "chant" && moment.chant_id != null) {
    const chant = chantsParId.get(moment.chant_id);
    if (chant) {
      let couplets = chant.couplets;
      if (moment.couplet_limit != null) couplets = couplets.slice(0, moment.couplet_limit);
      return { titre: chant.titre, refrain: chant.refrain, couplets, auteurCompositeur: chant.auteur || chant.compositeur || null };
    }
    return {
      titre: moment.titre_libre ?? `Chant #${moment.chant_id}`,
      refrain: null,
      couplets: moment.texte_libre ? [moment.texte_libre] : [],
      auteurCompositeur: null,
    };
  }
  return {
    titre: moment.titre_libre ?? null,
    refrain: null,
    couplets: moment.texte_libre ? [moment.texte_libre] : [],
    auteurCompositeur: null,
  };
}

/** Trie les moments par `ordre` explicite (drag&drop / saisie numérique) ; à
 * défaut, l'ordre de la liste `moments` fait foi (index stable). */
export function buildSections(feuillet: Feuillet, chantsParId: Map<number, Chant>): Section[] {
  const indexed = feuillet.moments.map((m, i) => [i, m] as const);
  indexed.sort((a, b) => (a[1].ordre ?? a[0]) - (b[1].ordre ?? b[0]));
  return indexed.map(([, m], i) => ({
    moment: m.moment,
    label: categorieLabel(m.moment),
    song: resoudreChant(m, chantsParId),
    ordre: i,
  }));
}
