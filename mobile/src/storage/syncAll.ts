import { getParametres, getParametresGlobaux } from "../api/parametres";
import { rafraichirParametresCache } from "./parametresCache";
import { synchroniserParametres } from "./syncParametres";
import { synchroniserBibliotheque } from "./sync";
import { synchroniserFeuillets } from "./syncFeuillets";
import { synchroniserDemandesSuppression } from "./syncModeration";

// Point d'entrée unique de la synchronisation complète (paramètres +
// bibliothèque de chants, y compris créations/modifications/suppressions en
// attente + feuillets) -- appelé (1) une fois au démarrage dès qu'une
// identité est résolue (IdentiteContext.tsx), et (2) à chaque retour de
// connexion détecté par le listener réseau (voir useSyncAutomatique.ts).
// Toujours silencieux/best-effort : un échec partiel (ex: hors-ligne) ne
// doit jamais faire planter l'appelant. La messagerie n'a volontairement pas
// de repli hors-ligne -- elle exige une connexion pour communiquer, comme
// convenu -- donc rien à synchroniser ici pour ce module.
export async function synchroniserTout(): Promise<void> {
  // D'abord repousser les modifications de réglages/À propos faites
  // hors-ligne (Réglages comme Administration partagent sauvegarderParametres,
  // voir api/parametres.ts) -- avant de rafraîchir le cache, sinon le GET qui
  // suit écraserait le patch tout juste envoyé avec une réponse potentiellement
  // encore non cohérente si les deux se chevauchent.
  await synchroniserParametres().catch(() => false);
  const params = await getParametres().catch(() => null);
  if (params) {
    await rafraichirParametresCache(params).catch(() => {});
    if (params.sync_bibliotheque_partagee !== false) {
      await synchroniserBibliotheque().catch(() => {});
    }
  }
  await synchroniserFeuillets().catch(() => {});
  await synchroniserDemandesSuppression().catch(() => {});
  // Contenu "À propos" (parametres/global) -- statique mais doit se
  // rafraîchir tout seul dès que le réseau revient, pas seulement quand
  // l'utilisateur ouvre l'écran (voir api/parametres.ts::getParametresGlobaux,
  // qui rafraîchit son propre cache comme effet de bord de cet appel).
  await getParametresGlobaux().catch(() => {});
}
