import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { verifierPin } from "../licence/pinChorale";
import Carte from "../components/Carte";
import Bouton from "../components/Bouton";

interface Props {
  onDeverrouille: () => void;
  onOublie: () => void;
}

// Plein écran, sans navigation possible (même famille que
// HorlogeBloqueeScreen.tsx/LicenceExpireeScreen.tsx) : affiché tant qu'un
// code de verrouillage local est défini (voir licence/pinChorale.ts) et pas
// encore déverrouillé pour cette ouverture de l'app -- verrou 100% local,
// jamais transmis, jamais connu de l'administrateur.
export default function PinVerrouScreen({ onDeverrouille, onOublie }: Props) {
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
          <Text style={styles.titre}>🔒 Application verrouillée</Text>
          <Text style={styles.texte}>Entre le code de verrouillage de cet appareil pour continuer.</Text>
          <TextInput
            style={styles.champ}
            placeholder="Code de verrouillage"
            placeholderTextColor="#9aa5b1"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={pin}
            onChangeText={(v) => { setPin(v); setErreur(false); }}
            editable={!enCours}
            onSubmitEditing={deverrouiller}
          />
          {erreur && <Text style={styles.erreur}>Code incorrect.</Text>}
          <Bouton titre="Déverrouiller" onPress={deverrouiller} enCours={enCours} desactive={!pin} />
          <Pressable style={styles.lienOublie} onPress={onOublie}>
            <Text style={styles.texteLienOublie}>Code oublié ?</Text>
          </Pressable>
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
});
