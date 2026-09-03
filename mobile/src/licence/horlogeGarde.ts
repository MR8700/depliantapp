// Garde anti-recul d'horloge -- sans ça, un appareil hors-ligne pourrait
// reculer sa date système pour rajeunir artificiellement une licence
// expirée ou un quota. Approche par plafond haute-eau (le plus grand
// timestamp jamais observé, persisté dans SecureStore) plutôt qu'une
// horloge monotone matérielle (SystemClock.elapsedRealtime) : évite
// d'introduire un module natif rien que pour ça. Contournable par une
// désinstallation complète de l'app (SecureStore/Keychain est alors
// effacé) -- limite acceptée, même catégorie que le tradeoff "confiance
// locale" du plafond d'appareils (voir licence/appareils.ts).
import { getHorodatagePlafond, setHorodatagePlafond } from "../storage/secureStore";
import { chargerMetaDisque, synchroniserHorlogeDisque } from "./metaDisqueLicence";

const TOLERANCE_SECONDES = 60;

export interface ResultatGardeHorloge {
  ok: boolean;
  bloque?: boolean;
}

/** À appeler à chaque ouverture de l'app (et avant toute décision locale
 * d'expiration/quota) -- avance le plafond si l'horloge a avancé
 * normalement, ou signale un blocage si elle a reculé de plus de
 * TOLERANCE_SECONDES sous le plafond déjà connu (en SecureStore ET sur le disque caché). */
export async function verifierHorlogeEtMettreAJour(): Promise<ResultatGardeHorloge> {
  const maintenant = Math.floor(Date.now() / 1000);
  const [plafondStore, metaDisque] = await Promise.all([
    getHorodatagePlafond(),
    chargerMetaDisque().catch(() => null),
  ]);

  // Le plafond inviolable est le maximum observé entre SecureStore et le fichier caché sur disque
  const plafond = Math.max(plafondStore || 0, metaDisque?.horodatagePlafond || 0);

  if (plafond && maintenant < plafond - TOLERANCE_SECONDES) {
    return { ok: false, bloque: true };
  }
  if (maintenant > plafond) {
    await Promise.all([
      setHorodatagePlafond(maintenant),
      synchroniserHorlogeDisque(maintenant).catch(() => {}),
    ]);
  }
  return { ok: true };
}
