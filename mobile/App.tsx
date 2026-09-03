import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { definirGestionnaireLicenceInvalide } from "./src/api/client";
import ActivationScreen from "./src/screens/ActivationScreen";
import RejoindreAppareilEnfantScreen from "./src/screens/RejoindreAppareilEnfantScreen";
import LoginScreen from "./src/screens/LoginScreen";
import ChangerMotDePasseObligatoireScreen from "./src/screens/ChangerMotDePasseObligatoireScreen";
import HomeTabs from "./src/navigation/HomeTabs";
import SplashScreen from "./src/components/SplashScreen";
import HorlogeBloqueeScreen from "./src/screens/HorlogeBloqueeScreen";
import LicenceExpireeScreen from "./src/screens/LicenceExpireeScreen";
import PinVerrouScreen from "./src/screens/PinVerrouScreen";
import ReinitialiserPinScreen from "./src/screens/ReinitialiserPinScreen";
import DefinirPinScreen from "./src/screens/DefinirPinScreen";
import { IdentiteProvider, useIdentite } from "./src/context/IdentiteContext";
import { LicenceLocale, getJetonSession, getLicenceLocale } from "./src/storage/secureStore";
import { verifierHorlogeEtMettreAJour } from "./src/licence/horlogeGarde";
import { licenceExpiree } from "./src/licence/expiration";
import { pinDefini } from "./src/licence/pinChorale";
import { verifierSessionAdminServeur } from "./src/api/auth";
import { configurerOrientation } from "./src/utils/orientation";

// Durée minimale d'affichage du splash -- comme sur le web (voir
// app.js::afficherSplashGeneration/masquerSplash), pour éviter un flash
// d'une frame si la lecture de SecureStore est instantanée.
const DUREE_MIN_SPLASH_MS = 900;

const Stack = createNativeStackNavigator();

// Garde bloquante équivalente au formulaire forcé de login.html
// (must_change_password) : tant que l'identité résolue porte ce drapeau,
// HomeTabs (et donc tout accès aux données/fonctions de l'app) reste
// injoignable, quelle que soit la façon dont on est arrivé jusqu'ici --
// même invariant que la garde admin/chorale de PlusStack.tsx.
function AccueilAuthentifie({ onDeconnecte }: { onDeconnecte: () => void }) {
  const { identite, rafraichirIdentite } = useIdentite();
  if (identite?.must_change_password) {
    return <ChangerMotDePasseObligatoireScreen onChange={rafraichirIdentite} />;
  }
  return <HomeTabs onDeconnecte={onDeconnecte} />;
}

export default function App() {
  // null = pas encore lu depuis SecureStore ; undefined = lu, absente.
  const [licence, setLicence] = useState<LicenceLocale | null | undefined>(null);
  const [connecte, setConnecte] = useState<boolean | null>(null);
  const [horlogeBloquee, setHorlogeBloquee] = useState(false);
  const [licenceExpireeEtat, setLicenceExpireeEtat] = useState(false);
  // Verrou local optionnel (rôle chorale, voir licence/pinChorale.ts) --
  // résolu UNE SEULE FOIS au démarrage (pas à chaque rafraichirEtat, sous
  // peine de reverrouiller l'appli à chaque rafraîchissement d'état déclenché
  // ailleurs, ex. après un changement de chant). null = pas encore résolu.
  const [pinVerrouille, setPinVerrouille] = useState<boolean | null>(null);
  const [modePinOublie, setModePinOublie] = useState(false);
  const [pinPretADefinir, setPinPretADefinir] = useState(false);
  // Échappatoires pour les comptes super-admin (pas de licence de chorale) et
  // pour rejoindre une chorale déjà active sur un autre appareil (handshake
  // QR maître/enfant, voir RejoindreAppareilEnfantScreen.tsx) : ces drapeaux
  // en mémoire (jamais persistés) sautent directement au bon écran depuis
  // l'écran d'activation.
  const [modeConnexionAdmin, setModeConnexionAdmin] = useState(false);
  const [modeRejoindreAppareil, setModeRejoindreAppareil] = useState(false);
  const [splashMinimumEcoule, setSplashMinimumEcoule] = useState(false);

  // Décision de l'écran de démarrage :
  // - La session super-admin passe TOUJOURS par le serveur pour vérifier l'état
  //   réel et valider les changements de mot de passe.
  // - La licence chorale se vérifie avec signature Ed25519 + garde d'horloge + métadonnées disque.
  const rafraichirEtat = useCallback(async () => {
    const [licenceLocale, jetonSession] = await Promise.all([getLicenceLocale(), getJetonSession()]);
    let adminConnecte = !!jetonSession;
    if (jetonSession) {
      // Vérification serveur en temps réel de la session administrateur
      adminConnecte = await verifierSessionAdminServeur();
    }
    if (licenceLocale) {
      const horloge = await verifierHorlogeEtMettreAJour();
      setHorlogeBloquee(!horloge.ok);
      setLicenceExpireeEtat(licenceExpiree(licenceLocale.payload));
    } else {
      setHorlogeBloquee(false);
      setLicenceExpireeEtat(false);
    }
    setLicence(licenceLocale ?? undefined);
    setConnecte(adminConnecte);
  }, []);

  const gererDeconnexion = useCallback(async () => {
    setModeConnexionAdmin(false);
    const l = await getLicenceLocale();
    if (l && (await pinDefini())) {
      setPinVerrouille(true);
    }
    await rafraichirEtat();
  }, [rafraichirEtat]);

  const demanderConnexionAdmin = useCallback(() => setModeConnexionAdmin(true), []);
  const demanderRejoindreAppareil = useCallback(() => setModeRejoindreAppareil(true), []);
  const annulerRejoindreAppareil = useCallback(() => setModeRejoindreAppareil(false), []);

  const rendreActivation = useCallback(
    () => (
      <ActivationScreen
        onActivee={rafraichirEtat}
        onDemandeConnexionAdmin={demanderConnexionAdmin}
        onDemandeRejoindreAppareil={demanderRejoindreAppareil}
      />
    ),
    [rafraichirEtat, demanderConnexionAdmin, demanderRejoindreAppareil],
  );
  const rendreRejoindreAppareil = useCallback(
    () => <RejoindreAppareilEnfantScreen onRejoint={rafraichirEtat} onAnnuler={annulerRejoindreAppareil} />,
    [rafraichirEtat, annulerRejoindreAppareil],
  );
  const rendreLicenceExpiree = useCallback(
    () => <LicenceExpireeScreen roleActuel={licence?.role ?? "maitre"} onRenouvelee={rafraichirEtat} />,
    [rafraichirEtat, licence?.role],
  );
  const rendrePinVerrou = useCallback(
    () => (
      <PinVerrouScreen
        onDeverrouille={() => setPinVerrouille(false)}
        onOublie={() => setModePinOublie(true)}
        onDemandeConnexionAdmin={demanderConnexionAdmin}
      />
    ),
    [demanderConnexionAdmin],
  );
  const rendreReinitialiserPin = useCallback(
    () => <ReinitialiserPinScreen onReinitialise={() => setPinPretADefinir(true)} onAnnuler={() => setModePinOublie(false)} />,
    [],
  );
  const rendreDefinirPinApresReset = useCallback(
    () => (
      <DefinirPinScreen
        titre="🔒 Nouveau code de verrouillage"
        onTermine={() => { setPinVerrouille(false); setModePinOublie(false); setPinPretADefinir(false); }}
      />
    ),
    [],
  );
  const rendreLogin = useCallback(
    () => (
      <LoginScreen
        onConnecte={() => {
          setModeConnexionAdmin(false);
          rafraichirEtat();
        }}
        onAnnuler={() => setModeConnexionAdmin(false)}
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
    getLicenceLocale().then(async (l) => setPinVerrouille(l ? await pinDefini() : false));
    const minuteur = setTimeout(() => setSplashMinimumEcoule(true), DUREE_MIN_SPLASH_MS);
    return () => clearTimeout(minuteur);
  }, [rafraichirEtat]);

  // Ne reste utile que pour le compte super-admin (seul à encore dépendre
  // d'un jeton de session serveur) -- côté chorale, plus aucune requête
  // réseau ne peut renvoyer ce signal, la validité de la licence se vérifie
  // entièrement en local à chaque rafraichirEtat().
  useEffect(() => {
    definirGestionnaireLicenceInvalide((message) => {
      Alert.alert("Licence non valide", message);
      rafraichirEtat();
    });
  }, [rafraichirEtat]);

  if (licence === null || connecte === null || pinVerrouille === null || !splashMinimumEcoule) {
    return <SplashScreen />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {horlogeBloquee && !modeConnexionAdmin ? (
          <Stack.Screen name="HorlogeBloquee" component={HorlogeBloqueeScreen} />
        ) : licenceExpireeEtat && !modeConnexionAdmin ? (
          <Stack.Screen name="LicenceExpiree">{rendreLicenceExpiree}</Stack.Screen>
        ) : pinVerrouille && !modeConnexionAdmin ? (
          pinPretADefinir ? (
            <Stack.Screen name="DefinirPinApresReset">{rendreDefinirPinApresReset}</Stack.Screen>
          ) : modePinOublie ? (
            <Stack.Screen name="ReinitialiserPin">{rendreReinitialiserPin}</Stack.Screen>
          ) : (
            <Stack.Screen name="PinVerrou">{rendrePinVerrou}</Stack.Screen>
          )
        ) : licence && !modeConnexionAdmin ? (
          <Stack.Screen name="Home">{rendreHome}</Stack.Screen>
        ) : modeRejoindreAppareil && !licence ? (
          <Stack.Screen name="RejoindreAppareil">{rendreRejoindreAppareil}</Stack.Screen>
        ) : !modeConnexionAdmin ? (
          <Stack.Screen name="Activation">{rendreActivation}</Stack.Screen>
        ) : !connecte ? (
          <Stack.Screen name="Login">{rendreLogin}</Stack.Screen>
        ) : (
          <Stack.Screen name="Home">{rendreHome}</Stack.Screen>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
