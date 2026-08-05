import { useCallback } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import PlusMenuScreen from "../screens/PlusMenuScreen";
import ReglagesScreen from "../screens/ReglagesScreen";
import ProfilScreen from "../screens/ProfilScreen";
import EditeurScreen from "../screens/EditeurScreen";
import ImportScreen from "../screens/ImportScreen";
import StatistiquesScreen from "../screens/StatistiquesScreen";
import AdministrationScreen from "../screens/AdministrationScreen";
import AProposScreen from "../screens/AProposScreen";
import { useIdentite } from "../context/IdentiteContext";

const Stack = createNativeStackNavigator();

interface Props {
  onDeconnecte: () => void;
}

export default function PlusStack({ onDeconnecte }: Props) {
  // Même précaution qu'HomeTabs : une fonction fléchée inline ici
  // redémonterait l'écran Profil (et sa navigation interne) à chaque
  // re-rendu de PlusStack.
  const rendreProfil = useCallback(() => <ProfilScreen onDeconnecte={onDeconnecte} />, [onDeconnecte]);
  const { estSuperAdmin } = useIdentite();

  return (
    <Stack.Navigator>
      <Stack.Screen name="PlusMenu" component={PlusMenuScreen} options={{ title: "Plus" }} />
      <Stack.Screen name="Reglages" component={ReglagesScreen} options={{ title: "Réglages" }} />
      <Stack.Screen name="Profil" options={{ title: "Mon profil" }}>
        {rendreProfil}
      </Stack.Screen>
      <Stack.Screen name="Editeur" component={EditeurScreen} options={{ title: "Éditeur de chants" }} />
      <Stack.Screen name="Import" component={ImportScreen} options={{ title: "Importer" }} />
      {/* Équivalent mobile du garde de routage web (VUES_SUPERADMIN_UNIQUEMENT,
          app.js) : ces écrans ne sont même pas enregistrés dans le navigateur
          pour un compte chorale, donc injoignables par un deep link ou un bug
          de navigation ailleurs -- pas seulement masqués du menu. */}
      {estSuperAdmin && (
        <Stack.Screen name="Statistiques" component={StatistiquesScreen} options={{ title: "Statistiques" }} />
      )}
      {estSuperAdmin && (
        <Stack.Screen name="Administration" component={AdministrationScreen} options={{ title: "Administration" }} />
      )}
      <Stack.Screen name="APropos" component={AProposScreen} options={{ title: "À propos" }} />
    </Stack.Navigator>
  );
}
