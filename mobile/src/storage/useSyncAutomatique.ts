import { useEffect, useRef, useState } from "react";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";
import { synchroniserTout } from "./syncAll";

export type StatutSyncAuto = "inactif" | "en_cours" | "ok" | "erreur";

/** Déclenche une synchronisation complète (voir syncAll.ts) chaque fois que
 * l'appareil retrouve une connexion, sans action utilisateur -- comblant le
 * trou identifié lors de l'audit : jusqu'ici, seul un redémarrage de l'app ou
 * un passage manuel par Réglages relançait la synchro. Ne se déclenche que
 * sur une vraie transition hors-ligne -> en ligne (pas à chaque changement
 * d'état réseau mineur, ex: wifi -> 4G alors que déjà connecté). */
export function useSyncAutomatique(actif: boolean): StatutSyncAuto {
  const [statut, setStatut] = useState<StatutSyncAuto>("inactif");
  const etaitConnecte = useRef<boolean | null>(null);
  const syncEnCours = useRef(false);

  useEffect(() => {
    if (!actif) return;

    async function lancerSync() {
      if (syncEnCours.current) return;
      syncEnCours.current = true;
      setStatut("en_cours");
      try {
        await synchroniserTout();
        setStatut("ok");
      } catch {
        setStatut("erreur");
      } finally {
        syncEnCours.current = false;
      }
    }

    const desabonner = NetInfo.addEventListener((etat: NetInfoState) => {
      const connecteMaintenant = !!etat.isConnected && etat.isInternetReachable !== false;
      const etaitDeconnecte = etaitConnecte.current === false;
      etaitConnecte.current = connecteMaintenant;
      if (connecteMaintenant && etaitDeconnecte) lancerSync();
    });

    return () => desabonner();
  }, [actif]);

  return statut;
}
