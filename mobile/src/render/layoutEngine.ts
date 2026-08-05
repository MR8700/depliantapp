// LayoutEngine : porté de backend/app/render/layout_engine.py. Ne connaît que
// des zones, jamais des pages ni des sections liturgiques -- seulement une
// file d'unités atomiques (titre, refrain, couplet) à distribuer dans un
// ordre de zones fixe (flowOrder).
//
// Règle absolue : une unité ne se coupe jamais. Si elle ne rentre pas dans la
// zone courante, elle passe entièrement à la zone suivante. Si elle ne rentre
// dans AUCUNE zone restante, le moteur ne réduit jamais la police et ne crée
// jamais de 3e page : il signale l'impossibilité (DepassementImpossible).
import { Section } from "./model";
import { StyleParagraphe } from "./typography";
import { Zone } from "./zones";

export type NatureUnite = "titre" | "refrain" | "couplet";

export interface Unite {
  /** Contenu HTML déjà prêt à insérer tel quel (voir measure.ts). */
  html: string;
  nomStyle: "titre_section" | "titre_chant" | "refrain" | "couplet" | "priere_corps";
  /** Style déjà résolu (taille effective = base +/- supplément ciblé par
   * chant, voir measure.ts::UniteNonMesuree.supplement) -- calculé une seule
   * fois à la mesure, réutilisé tel quel à l'assemblage (pdfAssembler.ts)
   * pour ne jamais recalculer/re-dériver un style différent entre les deux
   * passes. */
  style: StyleParagraphe;
  /** Hauteur réellement mesurée (mm), marges de paragraphe incluses. */
  hauteur: number;
  sectionOrdre: number;
  nature: NatureUnite;
}

export class DepassementImpossible extends Error {
  constructor(message: string, public momentsEnCause: string[]) {
    super(message);
  }
}

export class LayoutEngine {
  constructor(private flowOrder: Zone[]) {}

  /** Retourne {nomDeZone: [unite...]} (html + nomStyle, pour que
   * l'assemblage final applique la MÊME feuille de style que celle utilisée
   * pour la mesure -- voir pdfAssembler.ts). Lève DepassementImpossible si
   * toutes les zones du flowOrder sont épuisées avant la fin de la file
   * d'unités. */
  distribuer(unites: Unite[], sections: Section[]): Record<string, Unite[]> {
    const assignation: Record<string, Unite[]> = {};
    for (const zone of this.flowOrder) assignation[zone.nom] = [];

    if (unites.length === 0) return assignation;
    if (this.flowOrder.length === 0) {
      throw new DepassementImpossible(
        "Aucune zone disponible pour composer le feuillet.",
        sections.map((s) => s.moment),
      );
    }

    let idx = 0;
    let zone = this.flowOrder[0];
    let restante = zone.hauteur - 2 * zone.padding;

    for (const unite of unites) {
      while (unite.hauteur > restante) {
        idx += 1;
        if (idx >= this.flowOrder.length) {
          const section = this.sectionPour(unite, sections);
          const nom = section ? (section.song.titre || section.label) : "?";
          throw new DepassementImpossible(
            `Le contenu ne tient pas dans les zones disponibles (bloqué sur « ${nom} »). ` +
            "Réduis le nombre de couplets d'un ou plusieurs chants.",
            sections.map((s) => s.moment),
          );
        }
        zone = this.flowOrder[idx];
        restante = zone.hauteur - 2 * zone.padding;
      }
      assignation[zone.nom].push(unite);
      restante -= unite.hauteur;
    }

    return assignation;
  }

  private sectionPour(unite: Unite, sections: Section[]): Section | undefined {
    return sections.find((s) => s.ordre === unite.sectionOrdre);
  }
}
