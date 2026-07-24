import { useCallback } from "react";
import { Text } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import BibliothequeScreen from "../screens/BibliothequeScreen";
import ComposerScreen from "../screens/ComposerScreen";
import DepliantsScreen from "../screens/DepliantsScreen";
import MessagerieScreen from "../screens/MessagerieScreen";
import PlusStack from "./PlusStack";
import ProfilHeaderButton from "../components/ProfilHeaderButton";

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
  // IMPORTANT : ne jamais passer une fonction fléchée inline comme enfant
  // d'un Tab.Screen. React Navigation traite chaque nouvelle référence de
  // fonction comme un composant différent et démonte/remonte tout le
  // sous-arbre -- ici PlusStack perdrait sa navigation interne (retour au
  // menu, plus aucun clic qui ouvre quoi que ce soit) à chaque re-rendu de
  // HomeTabs, ce qui arrive juste après l'activation/connexion quand
  // IdentiteProvider (parent de HomeTabs) récupère l'identité et se
  // re-rend. useCallback garde la même référence tant qu'onDeconnecte
  // (lui-même stable, voir App.tsx::rafraichirEtat) ne change pas.
  const rendrePlusStack = useCallback(() => <PlusStack onDeconnecte={onDeconnecte} />, [onDeconnecte]);

  return (
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
      <Tab.Screen name="Plus" options={{ title: "Plus", headerShown: false, tabBarIcon: icone("Plus") }}>
        {rendrePlusStack}
      </Tab.Screen>
    </Tab.Navigator>
  );
}
