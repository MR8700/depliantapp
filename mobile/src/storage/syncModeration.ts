import { demanderSuppressionDistant } from "../api/moderation";
import { demanderPublicationFeuilletDistant } from "../api/feuillets";
import {
  lireDemandesEnAttente, retirerDemandeEnAttente,
  lirePublicationsEnAttente, retirerPublicationEnAttente,
} from "./moderationOutbox";
import { estFeuilletLocal } from "./feuilletsLocal";

// Pousse les demandes de suppression faites hors-ligne (voir
// api/moderation.ts::demanderSuppression) dès le retour du réseau.
export async function synchroniserDemandesSuppression(): Promise<void> {
  const enAttente = await lireDemandesEnAttente();
  for (const demande of enAttente) {
    try {
      await demanderSuppressionDistant(demande.typeCible, demande.cibleId, demande.raison);
      await retirerDemandeEnAttente(demande.cle);
    } catch {
      // Pas de connexion ou erreur serveur -- reste en attente.
    }
  }
}

// Pousse les demandes de publication de dépliant faites hors-ligne (voir
// api/feuillets.ts::demanderPublicationFeuillet) dès le retour du réseau.
export async function synchroniserDemandesPublication(): Promise<void> {
  const enAttente = await lirePublicationsEnAttente();
  for (const demande of enAttente) {
    if (estFeuilletLocal(demande.feuilletId)) {
      // Le dépliant lui-même n'a pas encore été synchronisé -- laissé en
      // attente, synchroniserFeuillets() s'en charge avant cette étape.
      continue;
    }
    try {
      await demanderPublicationFeuilletDistant(demande.feuilletId);
      await retirerPublicationEnAttente(demande.cle);
    } catch {
      // Pas de connexion ou erreur serveur -- reste en attente.
    }
  }
}
