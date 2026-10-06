import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { login } from "../api/auth";
import { ApiError } from "../api/client";
import Carte from "../components/Carte";
import Bouton from "../components/Bouton";

interface Props {
  onConnecte: () => void;
}

export default function LoginScreen({ onConnecte }: Props) {
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
      const message = erreur instanceof ApiError ? erreur.message : "Identifiant ou mot de passe incorrect. Vérifiez vos accès.";
      Alert.alert("Connexion impossible", message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.fond} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.entete}>
          <View style={styles.logoConteneur}>
            <Text style={styles.logoEmbleme}>🕊️</Text>
          </View>
          <Text style={styles.titreApp}>DepliantApp</Text>
          <Text style={styles.sousTitreApp}>Recueils & Dépliants Liturgiques</Text>
        </View>

        <Carte>
          <Text style={styles.titreCarte}>Connexion</Text>
          <Text style={styles.sousTitreCarte}>
            Espace chorale ou administration
          </Text>

          <Text style={styles.label}>Identifiant</Text>
          <TextInput
            style={styles.champ}
            placeholder="Nom de compte"
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
            editable={!enCours}
          />

          <Text style={styles.label}>Mot de passe</Text>
          <TextInput
            style={styles.champ}
            placeholder="Mot de passe"
            placeholderTextColor="#94a3b8"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            editable={!enCours}
          />

          <View style={{ marginTop: 8 }}>
            <Bouton titre="Se connecter" onPress={valider} enCours={enCours} desactive={!username.trim() || !password} />
          </View>

          <View style={styles.noteSecurite}>
            <Text style={styles.texteNoteSecurite}>
              🔒 Chaque compte est créé par l'administrateur de l'application. Accès multi-appareils libre & illimité.
            </Text>
          </View>
        </Carte>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fond: { flex: 1, backgroundColor: "#f1f5f9" },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  entete: { alignItems: "center", marginBottom: 24 },
  logoConteneur: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: "#1e40af", alignItems: "center", justifyContent: "center",
    marginBottom: 12, shadowColor: "#1e40af", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 4,
  },
  logoEmbleme: { fontSize: 32 },
  titreApp: { fontSize: 24, fontWeight: "800", color: "#1e3a8a", letterSpacing: 0.5 },
  sousTitreApp: { fontSize: 13, color: "#64748b", marginTop: 2, fontWeight: "500" },
  titreCarte: { fontSize: 20, fontWeight: "700", textAlign: "center", marginBottom: 4, color: "#1e293b" },
  sousTitreCarte: { fontSize: 13, color: "#64748b", textAlign: "center", marginBottom: 20 },
  label: { fontSize: 13, fontWeight: "600", color: "#334155", marginBottom: 6 },
  champ: {
    borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
    marginBottom: 16, backgroundColor: "#ffffff", color: "#0f172a",
  },
  noteSecurite: {
    marginTop: 18, padding: 12, backgroundColor: "#f8fafc",
    borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0",
  },
  texteNoteSecurite: { fontSize: 11, color: "#64748b", textAlign: "center", lineHeight: 16 },
});
