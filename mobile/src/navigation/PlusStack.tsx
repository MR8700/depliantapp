import { createNativeStackNavigator } from "@react-navigation/native-stack";
import PlusMenuScreen from "../screens/PlusMenuScreen";
import ReglagesScreen from "../screens/ReglagesScreen";
import ProfilScreen from "../screens/ProfilScreen";
import EditeurScreen from "../screens/EditeurScreen";
import ImportScreen from "../screens/ImportScreen";
import StatistiquesScreen from "../screens/StatistiquesScreen";
import AdministrationScreen from "../screens/AdministrationScreen";
import AProposScreen from "../screens/AProposScreen";

const Stack = createNativeStackNavigator();

interface Props {
  onDeconnecte: () => void;
}

export default function PlusStack({ onDeconnecte }: Props) {
  return (
    <Stack.Navigator>
      <Stack.Screen name="PlusMenu" component={PlusMenuScreen} options={{ title: "Plus" }} />
      <Stack.Screen name="Reglages" component={ReglagesScreen} options={{ title: "Réglages" }} />
      <Stack.Screen name="Profil" options={{ title: "Mon profil" }}>
        {() => <ProfilScreen onDeconnecte={onDeconnecte} />}
      </Stack.Screen>
      <Stack.Screen name="Editeur" component={EditeurScreen} options={{ title: "Éditeur de chants" }} />
      <Stack.Screen name="Import" component={ImportScreen} options={{ title: "Importer" }} />
      <Stack.Screen name="Statistiques" component={StatistiquesScreen} options={{ title: "Statistiques" }} />
      <Stack.Screen name="Administration" component={AdministrationScreen} options={{ title: "Administration" }} />
      <Stack.Screen name="APropos" component={AProposScreen} options={{ title: "À propos" }} />
    </Stack.Navigator>
  );
}
