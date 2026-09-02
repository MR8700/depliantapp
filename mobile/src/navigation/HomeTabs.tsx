import { Text } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import BibliothequeScreen from "../screens/BibliothequeScreen";
import ComposerScreen from "../screens/ComposerScreen";
import DepliantsScreen from "../screens/DepliantsScreen";
import MessagerieScreen from "../screens/MessagerieScreen";
import PlusStack from "./PlusStack";
import ProfilHeaderButton from "../components/ProfilHeaderButton";
import { SessionProvider } from "../context/SessionContext";

const Tab = createBottomTabNavigator();

interface Props {
  onDeconnecte: () => void;
}

// Emoji plutôt qu'une lib d'icônes (@expo/vector-icons) -- rendu garanti
// (police système, aucune police d'icônes à charger) et suffit très bien
// pour 5 onglets. Sans tabBarIcon explicite, react-navigation affiche un
// glyphe manquant (tofu) -- c'est ce que l'utilisateur a signalé.
const ICONES: Record<string, string> = {
  Bibliotheque: "📚",
  Composer: "✏️",
  Depliants: "📄",
  Messages: "💬",
  Plus: "☰",
};

function icone(nom: string) {
  return ({ color, size }: { color: string; size: number }) => (
    <Text style={{ fontSize: size, color }}>{ICONES[nom]}</Text>
  );
}

// 5 onglets principaux (Bibliothèque/Composer/Dépliants/Messages/Plus) --
// les écrans secondaires (Réglages, Profil, Éditeur, Import, Statistiques,
// Administration, À propos) vivent dans le menu "Plus" (voir PlusStack) : 9
// écrans au total dans une seule barre du bas serait inutilisable.
export default function HomeTabs({ onDeconnecte }: Props) {
  return (
    <SessionProvider onDeconnecte={onDeconnecte}>
    <Tab.Navigator screenOptions={{ tabBarActiveTintColor: "#2563eb", headerLeft: () => <ProfilHeaderButton /> }}>
      <Tab.Screen
        name="Bibliotheque" component={BibliothequeScreen}
        options={{ title: "Bibliothèque", tabBarIcon: icone("Bibliotheque") }}
      />
      <Tab.Screen
        name="Composer" component={ComposerScreen}
        options={{ title: "Composer", tabBarIcon: icone("Composer") }}
      />
      <Tab.Screen
        name="Depliants" component={DepliantsScreen}
        options={{ title: "Dépliants", tabBarIcon: icone("Depliants") }}
      />
      <Tab.Screen
        name="Messages" component={MessagerieScreen}
        options={{ title: "Messages", tabBarIcon: icone("Messages") }}
      />
      <Tab.Screen name="Plus" component={PlusStack} options={{ title: "Plus", headerShown: false, tabBarIcon: icone("Plus") }} />
    </Tab.Navigator>
    </SessionProvider>
  );
}
