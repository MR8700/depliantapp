// Typographie du corps des chants, portée de backend/app/render/typography.py
// -- jamais réduite en dessous du plancher, jamais de cascade de
// rétrécissement pour faire tenir le texte. Quand un feuillet est léger et
// laisse des zones à moitié vides, la police peut s'agrandir uniformément
// (voir ECHELLES_CORPS / genererPdfLocal.ts) mais jamais en dessous du
// plancher, et jamais chant par chant.

export const POLICE = "'Times New Roman', Times, serif";
export const POLICE_ITALIQUE = "'Times New Roman', Times, serif"; // + font-style: italic à l'usage

export const TAILLE_TEXTE = 8.0;
export const TAILLE_TITRE = 9.0;
export const FACTEUR_INTERLIGNE = 0.95;

// Tailles de corps essayées du plus grand au plus petit (le plancher
// TAILLE_TEXTE en dernier) -- genererPdfLocal.ts retient la première qui
// remplit toutes les zones sans déborder.
export const TAILLE_TEXTE_PLAFOND = 32.0;
const PAS_ECHELLE = 0.5;

function arrondi2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const ECHELLES_CORPS: number[] = (() => {
  const n = Math.round((TAILLE_TEXTE_PLAFOND - TAILLE_TEXTE) / PAS_ECHELLE) + 1;
  return Array.from({ length: n }, (_, i) => arrondi2(TAILLE_TEXTE_PLAFOND - i * PAS_ECHELLE));
})();

export interface StyleParagraphe {
  fontSize: number;
  lineHeight: number;
  fontWeight?: "normal" | "bold";
  marginTop?: number;
  marginBottom?: number;
}

export type NomStyle = "titre_section" | "titre_chant" | "refrain" | "couplet" | "priere_corps";

/** Construit les styles du corps à une taille donnée (l'une des valeurs de
 * ECHELLES_CORPS). Interligne et marges sont mis à l'échelle dans les mêmes
 * proportions que TAILLE_TEXTE -> tailleTexte, pour que l'agrandissement
 * reste visuellement cohérent (pas juste du texte plus gros avec le même
 * espacement serré). */
export function construireStyles(tailleTexte: number = TAILLE_TEXTE): Record<NomStyle, StyleParagraphe> {
  const ratio = tailleTexte / TAILLE_TEXTE;
  const tailleTitre = arrondi2(TAILLE_TITRE * ratio);
  const interligneTexte = arrondi2(tailleTexte * FACTEUR_INTERLIGNE);
  const interligneTitre = arrondi2(tailleTitre * FACTEUR_INTERLIGNE);
  const marge = (base: number) => arrondi2(base * ratio);

  return {
    titre_section: { fontSize: tailleTitre, lineHeight: interligneTitre, fontWeight: "bold", marginTop: marge(4), marginBottom: marge(2.5) },
    titre_chant: { fontSize: tailleTexte, lineHeight: interligneTexte, fontWeight: "bold", marginBottom: marge(1.5) },
    refrain: { fontSize: tailleTexte, lineHeight: interligneTexte, marginBottom: marge(2.0) },
    couplet: { fontSize: tailleTexte, lineHeight: interligneTexte, marginBottom: marge(2.0) },
    priere_corps: { fontSize: tailleTexte, lineHeight: interligneTexte, marginBottom: marge(2.0) },
  };
}
