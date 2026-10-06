import { useNavigation } from "@react-navigation/native";
import { Image, Pressable, StyleSheet, Text } from "react-native";
import { useIdentite } from "../context/IdentiteContext";

// Équivalent mobile du badge utilisateur en haut de l'en-tête web
// (header-user-badge/header-user-avatar, cliquable -> ouvrirProfil()) :
// un accès direct au profil depuis n'importe quel onglet principal, sans
// passer par le menu "Plus". Placé en haut à gauche (demande explicite,
// contrairement au web qui le met à droite) via screenOptions.headerLeft
// du Tab.Navigator (voir HomeTabs.tsx).
export default function ProfilHeaderButton() {
  const navigation = useNavigation<any>();
  const { identite, avatarUri } = useIdentite();
  const initiale = (identite?.nom || identite?.username || "?").trim().charAt(0).toUpperCase();

  return (
    <Pressable
      style={styles.bouton}
      hitSlop={10}
      onPress={() => navigation.navigate("Plus", { screen: "Profil" })}
    >
      {avatarUri ? (
        <Image source={{ uri: avatarUri }} style={styles.avatar} />
      ) : (
        <Text style={styles.texte}>{initiale}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bouton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 14,
    overflow: "hidden",
  },
  avatar: { width: 34, height: 34 },
  texte: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
