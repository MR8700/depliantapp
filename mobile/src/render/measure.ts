// Construit les unités atomiques d'une section (titre, refrain, chaque
// couplet), porté de backend/app/render/measure.py. Contrairement au
// backend, ne mesure rien lui-même -- ce fichier ne fait QUE produire le HTML
// et les métadonnées de chaque unité ; la mesure réelle de hauteur passe par
// MeasurementBridge.tsx (WebView), voir genererPdfLocal.ts pour
// l'orchestration complète.
import { Section } from "./model";
import { NomStyle } from "./typography";
import { escapeHtml, formaterTexteLiturgique, mettreEnGrasNumero, mettreEnGrasRefrain } from "./texteUtils";

export interface UniteNonMesuree {
  html: string;
  nomStyle: NomStyle;
  sectionOrdre: number;
  nature: "titre" | "refrain" | "couplet";
  /** Agrandissement ciblé (pt) hérité de section.song.tailleTexteSupplement
   * -- jamais appliqué à "titre_section" (l'étiquette du moment, ex.
   * "ENTRÉE", reste toujours à la taille normale, seul le contenu du
   * chant/texte lui-même grossit). */
  supplement: number;
  /** Fragment intermédiaire d'un même bloc, sans marge de fin. */
  continuation?: boolean;
}

function lignesDeTexte(texte: string): string[] {
  const lignes = texte.split(/\r?\n/).map((ligne) => ligne.trim()).filter(Boolean);
  return lignes.length > 0 ? lignes : [texte];
}

function ajouterFragments(
  unites: UniteNonMesuree[], texte: string, section: Section, nomStyle: "refrain" | "couplet",
  supplement: number, rendre: (ligne: string, index: number) => string,
) {
  const lignes = lignesDeTexte(texte);
  lignes.forEach((ligne, index) => {
    unites.push({
      html: rendre(ligne, index), nomStyle, sectionOrdre: section.ordre, nature: nomStyle,
      supplement, continuation: index < lignes.length - 1,
    });
  });
}

export function construireUnitesSection(section: Section): UniteNonMesuree[] {
  const unites: UniteNonMesuree[] = [];
  const supplement = section.song.tailleTexteSupplement;

  unites.push({
    html: `<u>${escapeHtml(section.label).toUpperCase()}</u>`,
    nomStyle: "titre_section", sectionOrdre: section.ordre, nature: "titre", supplement: 0,
  });

  const song = section.song;
  if (song.titre) {
    let html = formaterTexteLiturgique(song.titre);
    if (song.auteurCompositeur) {
      // Sous-ligne auteur/compositeur intégrée au MÊME html que le titre
      // (jamais une unité séparée) -- une unité est indivisible : il ne faut
      // jamais que le titre et son auteur se retrouvent séparés par un saut
      // de zone/colonne (même invariant que measure.py côté backend).
      html += `<br/><span class="auteur-compositeur">${escapeHtml(song.auteurCompositeur)}</span>`;
    }
    unites.push({ html, nomStyle: "titre_chant", sectionOrdre: section.ordre, nature: "titre", supplement });
  }

  if (song.refrain) {
    ajouterFragments(unites, song.refrain, section, "refrain", supplement, (ligne, index) => (
      index === 0 ? mettreEnGrasRefrain(ligne) : `<b>${formaterTexteLiturgique(ligne)}</b>`
    ));
  }

  song.couplets.forEach((couplet, i) => {
    ajouterFragments(unites, couplet, section, "couplet", supplement, (ligne, index) => (
      index === 0 ? mettreEnGrasNumero(ligne, i + 1) : formaterTexteLiturgique(ligne)
    ));
  });

  return unites;
}

/** Concatène les unités de toutes les sections, déjà triées par ordre --
 * c'est cette liste plate que le LayoutEngine distribue zone par zone. */
export function construireUnites(sections: Section[]): UniteNonMesuree[] {
  return sections.flatMap(construireUnitesSection);
}
