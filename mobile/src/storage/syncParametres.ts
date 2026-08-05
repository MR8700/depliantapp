import { sauvegarderParametresDistant } from "../api/parametres";
import { lirePatchEnAttente, marquerParametresSynchronises } from "./parametresCache";

// Pousse les modifications de réglages/À propos faites hors-ligne (voir
// api/parametres.ts::sauvegarderParametres) dès le retour du réseau -- même
// rôle que storage/syncFeuillets.ts pour les feuillets. Appelle la variante
// *Distant (jamais sauvegarderParametres elle-même) : un échec ici doit
// laisser le patch en attente tel quel, jamais le re-fusionner une seconde
// fois.
export async function synchroniserParametres(): Promise<boolean> {
  const patch = await lirePatchEnAttente();
  if (!patch) return false;
  try {
    const resultat = await sauvegarderParametresDistant(patch);
    await marquerParametresSynchronises(resultat);
    return true;
  } catch {
    return false;
  }
}
