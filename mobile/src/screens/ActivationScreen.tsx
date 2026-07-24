import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { activerLicence } from "../api/licences";
import { ApiError } from "../api/client";
import { setActivation } from "../storage/secureStore";
import Carte from "../components/Carte";
import Bouton from "../components/Bouton";

interface Props {
  onActivee: () => void;
  onDemandeConnexionAdmin: () => void;
}

export default function ActivationScreen({ onActivee, onDemandeConnexionAdmin }: Props) {
  const [code, setCode] = useState("");
  const [enCours, setEnCours] = useState(false);

  async function valider() {
    if (!code.trim()) return;
    setEnCours(true);
    try {
      const resultat = await activerLicence(code.trim());
      await setActivation({
        jeton: resultat.jeton,
        choraleId: resultat.chorale_id,
        choraleNom: resultat.chorale_nom,
      });
      onActivee();
    } catch (erreur) {
      const message = erreur instanceof ApiError ? erreur.message : "Impossible de contacter le serveur -- vérifie ta connexion internet";
      Alert.alert("Activation impossible", message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.fond} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Carte>
          <Text style={styles.titre}>DepliantApp</Text>
          <Text style={styles.sousTitre}>
            Saisis le code de licence fourni à ta chorale pour activer l'application sur cet appareil.
            Une connexion internet est nécessaire uniquement pour cette étape.
          </Text>
          <TextInput
            style={styles.champ}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            placeholderTextColor="#9aa5b1"
            autoCapitalize="characters"
            autoCorrect={false}
            value={code}
            onChangeText={setCode}
            editable={!enCours}
          />
          <Bouton titre="Activer" onPress={valider} enCours={enCours} desactive={!code.trim()} />
          <Pressable style={styles.lienAdmin} onPress={onDemandeConnexionAdmin}>
            <Text style={styles.texteLienAdmin}>Vous êtes administrateur ? Se connecter directement →</Text>
          </Pressable>
        </Carte>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fond: { flex: 1, backgroundColor: "#eef2f9" },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  titre: { fontSize: 28, fontWeight: "700", textAlign: "center", marginBottom: 12, color: "#1e293b" },
  sousTitre: { fontSize: 14, color: "#555", textAlign: "center", marginBottom: 28, lineHeight: 20 },
  champ: {
    borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 12, padding: 14,
    fontSize: 18, textAlign: "center", letterSpacing: 2, marginBottom: 20, backgroundColor: "#fafcff",
  },
  lienAdmin: { marginTop: 18, alignItems: "center" },
  texteLienAdmin: { color: "#2563eb", fontSize: 13, fontWeight: "600" },
});
