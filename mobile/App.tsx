import { useCallback, useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import LoginScreen from "./src/screens/LoginScreen";
import ChangerMotDePasseObligatoireScreen from "./src/screens/ChangerMotDePasseObligatoireScreen";
import HomeTabs from "./src/navigation/HomeTabs";
import SplashScreen from "./src/components/SplashScreen";
import { IdentiteProvider, useIdentite } from "./src/context/IdentiteContext";
import { getJetonSession } from "./src/storage/secureStore";
import { verifierSessionServeur, logoutAdminServeur } from "./src/api/auth";
import { configurerOrientation } from "./src/utils/orientation";

// Durée minimale d'affichage du splash
const DUREE_MIN_SPLASH_MS = 900;

const Stack = createNativeStackNavigator();

// Garde bloquante si must_change_password
function AccueilAuthentifie({ onDeconnecte }: { onDeconnecte: () => void }) {
  const { identite, rafraichirIdentite } = useIdentite();
  if (identite?.must_change_password) {
    return <ChangerMotDePasseObligatoireScreen onChange={rafraichirIdentite} />;
  }
  return <HomeTabs onDeconnecte={onDeconnecte} />;
}

export default function App() {
  const [connecte, setConnecte] = useState<boolean | null>(null);
  const [splashMinimumEcoule, setSplashMinimumEcoule] = useState(false);

  // Décision de l'écran de démarrage :
  // - La session super-admin passe TOUJOURS par le serveur pour vérifier l'état
  //   réel et valider les changements de mot de passe.
  // - La licence chorale se vérifie avec signature Ed25519 + garde d'horloge + métadonnées disque.
  const rafraichirEtat = useCallback(async () => {
    const jetonSession = await getJetonSession();
    let estConnecte = false;
    if (jetonSession) {
      estConnecte = await verifierSessionServeur();
    }
    setConnecte(estConnecte);
  }, []);

  const gererDeconnexion = useCallback(async () => {
    await logoutAdminServeur();
    setConnecte(false);
    await rafraichirEtat();
  }, [rafraichirEtat]);

  const rendreLogin = useCallback(
    () => (
      <LoginScreen
        onConnecte={() => {
          rafraichirEtat();
        }}
      />
    ),
    [rafraichirEtat],
  );

  const rendreHome = useCallback(
    () => (
      <IdentiteProvider>
        <AccueilAuthentifie onDeconnecte={gererDeconnexion} />
      </IdentiteProvider>
    ),
    [gererDeconnexion],
  );

  useEffect(() => {
    rafraichirEtat();
    configurerOrientation();
    const minuteur = setTimeout(() => setSplashMinimumEcoule(true), DUREE_MIN_SPLASH_MS);
    return () => clearTimeout(minuteur);
  }, [rafraichirEtat]);

  if (connecte === null || !splashMinimumEcoule) {
    return <SplashScreen />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!connecte ? (
          <Stack.Screen name="Login">{rendreLogin}</Stack.Screen>
        ) : (
          <Stack.Screen name="Home">{rendreHome}</Stack.Screen>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
