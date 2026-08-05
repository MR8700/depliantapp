// Petits utilitaires de mise en forme du texte des chants, portés de
// backend/app/render/typography.py (mettre_en_gras_numero/refrain).

export function escapeHtml(texte: string): string {
  return texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const NUMERO_DEJA_PRESENT = /^\s*(\d+)\s*([.\-–&]+)\s*/;
const MARQUEUR_REF = /\b(R[ée]f\s*:)/i;
const MARQUEUR_R = /(^|\s)(R\s*:)/;

/** Met le numéro de couplet en gras (« 1. », « 1&2- » etc.), qu'il soit déjà
 * présent dans le texte source ou ajouté ici. Prend le texte BRUT (non
 * échappé) : la détection du préfixe doit voir les vrais caractères (ex: un
 * « & » réel dans « 1&2- »), pas leur forme échappée « &amp; » -- sinon le
 * « & » de l'entité est relu comme séparateur de numéro. `escapeHtml()` n'est
 * donc appliqué qu'après la détection, séparément sur le préfixe et le reste. */
export function mettreEnGrasNumero(texteBrut: string, numero: number): string {
  const m = NUMERO_DEJA_PRESENT.exec(texteBrut);
  if (m) {
    const prefixe = escapeHtml(texteBrut.slice(0, m[0].length).trim());
    const reste = escapeHtml(texteBrut.slice(m[0].length));
    return `<b>${prefixe}</b> ${reste}`;
  }
  return `<b>${numero}.</b> ${escapeHtml(texteBrut)}`;
}

/** Met tout le refrain en gras. Ajoute le préfixe « Réf : » s'il est absent ;
 * le laisse tel quel s'il est déjà présent (ex: rappel « R: » intégré à un
 * Kyrie alterné). Prend le texte DÉJÀ échappé (contrairement à
 * mettreEnGrasNumero) -- appeler escapeHtml() avant. */
export function mettreEnGrasRefrain(texteEchappe: string): string {
  let texte = texteEchappe;
  if (!MARQUEUR_REF.test(texte) && !MARQUEUR_R.test(texte)) {
    texte = `Réf : ${texte}`;
  }
  return `<b>${texte}</b>`;
}
