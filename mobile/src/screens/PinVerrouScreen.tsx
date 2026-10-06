import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { verifierPin } from "../licence/pinChorale";
import { synchroniserVerrouillageDisque } from "../licence/metaDisqueLicence";
import Carte from "../components/Carte";
import Bouton from "../components/Bouton";

interface Props {
  onDeverrouille: () => void;
  onOublie: () => void;
  onDemandeConnexionAdmin?: () => void;
}

// Écran de connexion / verrouillage affiché à l'ouverture de l'application
// dès qu'un mot de passe de connexion est défini ou après déconnexion.
export default function PinVerrouScreen({ onDeverrouille, onOublie, onDemandeConnexionAdmin }: Props) {
  const [pin, setPin] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState(false);

  async function deverrouiller() {
    if (!pin) return;
    setEnCours(true);
    setErreur(false);
    try {
      const ok = await verifierPin(pin);
      if (ok) {
        await synchroniserVerrouillageDisque(false);
        onDeverrouille();
      } else {
        setErreur(true);
      }
    } finally {
      setEnCours(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.fond} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Carte>
          <Text style={styles.titre}>🔒 Connexion</Text>
          <Text style={styles.texte}>
            Saisis ton mot de passe de connexion pour déverrouiller et accéder à l'application.
          </Text>
          <TextInput
            style={styles.champ}
            placeholder="Mot de passe de connexion"
            placeholderTextColor="#9aa5b1"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={pin}
            onChangeText={(v) => { setPin(v); setErreur(false); }}
            editable={!enCours}
            onSubmitEditing={deverrouiller}
          />
          {erreur && <Text style={styles.erreur}>Mot de passe incorrect.</Text>}
          <Bouton titre="Se connecter" onPress={deverrouiller} enCours={enCours} desactive={!pin} />
          <Pressable style={styles.lienOublie} onPress={onOublie}>
            <Text style={styles.texteLienOublie}>Mot de passe oublié ?</Text>
          </Pressable>
          {onDemandeConnexionAdmin && (
            <Pressable style={styles.lienAdmin} onPress={onDemandeConnexionAdmin}>
              <Text style={styles.texteLienAdmin}>Vous êtes administrateur ? Connexion serveur →</Text>
            </Pressable>
          )}
        </Carte>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fond: { flex: 1, backgroundColor: "#eef2f9" },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  titre: { fontSize: 20, fontWeight: "700", textAlign: "center", marginBottom: 12, color: "#1e293b" },
  texte: { fontSize: 14, color: "#475569", textAlign: "center", marginBottom: 20, lineHeight: 20 },
  champ: {
    borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 12, padding: 14,
    fontSize: 15, marginBottom: 8, backgroundColor: "#fafcff",
  },
  erreur: { color: "#dc2626", fontSize: 13, textAlign: "center", marginBottom: 8 },
  lienOublie: { alignItems: "center", marginTop: 18 },
  texteLienOublie: { color: "#2563eb", fontSize: 13, fontWeight: "600" },
  lienAdmin: { alignItems: "center", marginTop: 14 },
  texteLienAdmin: { color: "#2563eb", fontSize: 13, fontWeight: "600" },
});
