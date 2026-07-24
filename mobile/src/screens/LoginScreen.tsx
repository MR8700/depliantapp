import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { login } from "../api/auth";
import { ApiError } from "../api/client";
import Carte from "../components/Carte";
import Bouton from "../components/Bouton";

interface Props {
  choraleNom?: string;
  onConnecte: () => void;
}

export default function LoginScreen({ choraleNom, onConnecte }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [enCours, setEnCours] = useState(false);

  async function valider() {
    if (!username.trim() || !password) return;
    setEnCours(true);
    try {
      await login(username.trim(), password);
      onConnecte();
    } catch (erreur) {
      const message = erreur instanceof ApiError ? erreur.message : "Impossible de contacter le serveur -- vérifie ta connexion internet";
      Alert.alert("Connexion impossible", message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.fond} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Carte>
          <Text style={styles.titre}>{choraleNom ?? "Connexion"}</Text>
          <Text style={styles.sousTitre}>
            {choraleNom ? "Connecte-toi avec le compte de ta chorale." : "Connexion avec un compte administrateur (aucune licence requise)."}
          </Text>
          <TextInput
            style={styles.champ}
            placeholder="Identifiant"
            placeholderTextColor="#9aa5b1"
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
            editable={!enCours}
          />
          <TextInput
            style={styles.champ}
            placeholder="Mot de passe"
            placeholderTextColor="#9aa5b1"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            editable={!enCours}
          />
          <Bouton titre="Se connecter" onPress={valider} enCours={enCours} desactive={!username.trim() || !password} />
        </Carte>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fond: { flex: 1, backgroundColor: "#eef2f9" },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  titre: { fontSize: 24, fontWeight: "700", textAlign: "center", marginBottom: 8, color: "#1e293b" },
  sousTitre: { fontSize: 14, color: "#555", textAlign: "center", marginBottom: 28 },
  champ: { borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 12, padding: 14, fontSize: 16, marginBottom: 16, backgroundColor: "#fafcff" },
});
