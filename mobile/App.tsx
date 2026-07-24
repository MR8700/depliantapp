import { useCallback, useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import ActivationScreen from "./src/screens/ActivationScreen";
import LoginScreen from "./src/screens/LoginScreen";
import HomeTabs from "./src/navigation/HomeTabs";
import SplashScreen from "./src/components/SplashScreen";
import { IdentiteProvider } from "./src/context/IdentiteContext";
import { ActivationStockee, getActivation, getJetonSession } from "./src/storage/secureStore";

// Durée minimale d'affichage du splash -- comme sur le web (voir
// app.js::afficherSplashGeneration/masquerSplash), pour éviter un flash
// d'une frame si la lecture de SecureStore est instantanée.
const DUREE_MIN_SPLASH_MS = 900;

const Stack = createNativeStackNavigator();

export default function App() {
  // null = pas encore lu depuis SecureStore ; undefined = lu, absent.
  const [activation, setActivation] = useState<ActivationStockee | null | undefined>(null);
  const [connecte, setConnecte] = useState<boolean | null>(null);
  // Échappatoire pour les comptes super-admin, qui n'ont pas de licence de
  // chorale : ce drapeau en mémoire (jamais persisté) saute directement à
  // l'écran de connexion classique depuis l'écran d'activation.
  const [modeConnexionAdmin, setModeConnexionAdmin] = useState(false);
  const [splashMinimumEcoule, setSplashMinimumEcoule] = useState(false);

  // Décision de l'écran de démarrage lue UNIQUEMENT en local (SecureStore) :
  // seule l'activation elle-même exige une connexion internet, tout le
  // reste (savoir si on est déjà activé/connecté) doit marcher hors-ligne.
  const rafraichirEtat = useCallback(async () => {
    const [act, jetonSession] = await Promise.all([getActivation(), getJetonSession()]);
    setActivation(act ?? undefined);
    setConnecte(!!jetonSession);
  }, []);

  useEffect(() => {
    rafraichirEtat();
    const minuteur = setTimeout(() => setSplashMinimumEcoule(true), DUREE_MIN_SPLASH_MS);
    return () => clearTimeout(minuteur);
  }, [rafraichirEtat]);

  if (activation === null || connecte === null || !splashMinimumEcoule) {
    return <SplashScreen />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!activation && !modeConnexionAdmin ? (
          <Stack.Screen name="Activation">
            {() => <ActivationScreen onActivee={rafraichirEtat} onDemandeConnexionAdmin={() => setModeConnexionAdmin(true)} />}
          </Stack.Screen>
        ) : !connecte ? (
          <Stack.Screen name="Login">
            {() => <LoginScreen choraleNom={activation?.choraleNom} onConnecte={rafraichirEtat} />}
          </Stack.Screen>
        ) : (
          <Stack.Screen name="Home">
            {() => (
              <IdentiteProvider>
                <HomeTabs onDeconnecte={rafraichirEtat} />
              </IdentiteProvider>
            )}
          </Stack.Screen>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
