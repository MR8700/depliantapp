import { demanderSuppressionDistant } from "../api/moderation";
import { lireDemandesEnAttente, retirerDemandeEnAttente } from "./moderationOutbox";

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
