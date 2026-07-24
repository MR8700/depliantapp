import { createContext, useCallback, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getIdentite } from "../api/meta";
import { Identite } from "../types";

const CLE_CACHE_IDENTITE = "depliantapp.identite_cache";

interface IdentiteContextValeur {
  identite: Identite | null;
  rafraichirIdentite: () => Promise<void>;
  estSuperAdmin: boolean;
}

const IdentiteContext = createContext<IdentiteContextValeur | null>(null);

// Résout l'identité (chorale vs super-admin) pour piloter les branches de
// rôle dans l'UI (voir §2 de l'inventaire des écrans web -- ce même
// branchement apparaît dans ~6 endroits côté web). Toujours revalidé par le
// serveur à chaque requête sensible : cette valeur ne sert qu'à l'affichage,
// jamais de contrôle d'accès réel.
export function IdentiteProvider({ children }: { children: React.ReactNode }) {
  const [identite, setIdentite] = useState<Identite | null>(null);

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

  return (
    <IdentiteContext.Provider value={{ identite, rafraichirIdentite, estSuperAdmin: identite?.type === "super" }}>
      {children}
    </IdentiteContext.Provider>
  );
}

export function useIdentite(): IdentiteContextValeur {
  const ctx = useContext(IdentiteContext);
  if (!ctx) throw new Error("useIdentite doit être utilisé sous IdentiteProvider");
  return ctx;
}
