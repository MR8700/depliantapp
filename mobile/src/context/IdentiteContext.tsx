import { createContext, useCallback, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getIdentite } from "../api/meta";
import { dernieresSyncLe } from "../storage/sync";
import { synchroniserTout } from "../storage/syncAll";
import { useSyncAutomatique, StatutSyncAuto } from "../storage/useSyncAutomatique";
import { Identite } from "../types";

const CLE_CACHE_IDENTITE = "depliantapp.identite_cache";
// Même principe que le web (localStorage `profil_avatar_${username}`, voir
// app.js) : l'avatar est une préférence locale à l'appareil, jamais envoyée
// au serveur (pas de colonne dédiée côté backend). Clé par username pour
// survivre à un changement de compte connecté sur le même appareil.
const CLE_AVATAR_PREFIX = "depliantapp.profil_avatar_";

interface IdentiteContextValeur {
  identite: Identite | null;
  rafraichirIdentite: () => Promise<void>;
  estSuperAdmin: boolean;
  avatarUri: string | null;
  definirAvatar: (uri: string | null) => Promise<void>;
  /** Vrai tant qu'aucune synchronisation de la bibliothèque partagée n'a
   * jamais réussi sur cet appareil -- sert au bandeau d'invitation non
   * bloquant du premier lancement (voir ActivationScreen.tsx). */
  syncBibliothequeJamaisEffectuee: boolean;
  /** Statut de la dernière synchronisation automatique déclenchée par le
   * retour de connexion (voir useSyncAutomatique.ts) -- affichable en badge
   * discret dans Réglages ou ailleurs. */
  statutSyncAuto: StatutSyncAuto;
}

const IdentiteContext = createContext<IdentiteContextValeur | null>(null);

// Résout l'identité (chorale vs super-admin) pour piloter les branches de
// rôle dans l'UI (voir §2 de l'inventaire des écrans web -- ce même
// branchement apparaît dans ~6 endroits côté web). Toujours revalidé par le
// serveur à chaque requête sensible : cette valeur ne sert qu'à l'affichage,
// jamais de contrôle d'accès réel.
export function IdentiteProvider({ children }: { children: React.ReactNode }) {
  const [identite, setIdentite] = useState<Identite | null>(null);
  const [avatarUri, setAvatarUriState] = useState<string | null>(null);
  const [syncBibliothequeJamaisEffectuee, setSyncBibliothequeJamaisEffectuee] = useState(false);

  const rafraichirIdentite = useCallback(async () => {
    try {
      const fraiche = await getIdentite();
      setIdentite(fraiche);
      await AsyncStorage.setItem(CLE_CACHE_IDENTITE, JSON.stringify(fraiche));
    } catch {
      // Hors-ligne : on garde l'identité déjà chargée, ou celle du cache local
    }
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(CLE_CACHE_IDENTITE).then((brut) => {
      if (brut) setIdentite(JSON.parse(brut));
    });
    rafraichirIdentite();
  }, [rafraichirIdentite]);

  useEffect(() => {
    if (!identite?.username) { setAvatarUriState(null); return; }
    AsyncStorage.getItem(`${CLE_AVATAR_PREFIX}${identite.username}`).then(setAvatarUriState);
  }, [identite?.username]);

  // Synchronisation best-effort de la bibliothèque partagée + des feuillets
  // en attente dès qu'une identité est résolue -- silencieuse, jamais
  // bloquante (voir storage/syncAll.ts). Avant, seule l'ouverture manuelle de
  // Réglages déclenchait ce PULL ; un tout premier lancement hors-ligne
  // pouvait donc rester avec une bibliothèque vide indéfiniment si
  // l'utilisateur n'allait jamais dans Réglages.
  useEffect(() => {
    if (!identite) return;
    dernieresSyncLe().then((derniere) => setSyncBibliothequeJamaisEffectuee(derniere === null));
    synchroniserTout()
      .then(() => dernieresSyncLe().then((derniere) => setSyncBibliothequeJamaisEffectuee(derniere === null)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identite?.username]);

  // Retour de connexion détecté en cours de session (pas seulement au
  // démarrage) -- voir useSyncAutomatique.ts : comble le trou où l'app
  // restait ouverte des heures hors-ligne sans jamais repousser l'outbox ni
  // retirer les nouvelles données, tant que l'utilisateur n'ouvrait pas
  // Réglages ni ne relançait l'app.
  const statutSyncAuto = useSyncAutomatique(!!identite);

  const definirAvatar = useCallback(async (uri: string | null) => {
    if (!identite?.username) return;
    setAvatarUriState(uri);
    if (uri) await AsyncStorage.setItem(`${CLE_AVATAR_PREFIX}${identite.username}`, uri);
    else await AsyncStorage.removeItem(`${CLE_AVATAR_PREFIX}${identite.username}`);
  }, [identite?.username]);

  return (
    <IdentiteContext.Provider
      value={{
        identite, rafraichirIdentite, estSuperAdmin: identite?.type === "super",
        avatarUri, definirAvatar, syncBibliothequeJamaisEffectuee, statutSyncAuto,
      }}
    >
      {children}
    </IdentiteContext.Provider>
  );
}

export function useIdentite(): IdentiteContextValeur {
  const ctx = useContext(IdentiteContext);
  if (!ctx) throw new Error("useIdentite doit être utilisé sous IdentiteProvider");
  return ctx;
}
