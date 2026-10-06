import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { definirPin } from "../licence/pinChorale";
import Carte from "../components/Carte";
import Bouton from "../components/Bouton";

const LONGUEUR_MIN = 8;

interface Props {
  /** Utilisé à la fois pour une définition volontaire depuis Réglages
   * (navigue en arrière) et pour l'étape finale d'une réinitialisation
   * (déverrouille l'appli) -- ce composant reste agnostique de son
   * contexte d'appel, voir PlusStack.tsx et App.tsx. */
  onTermine: () => void;
  onAnnuler?: () => void;
  titre?: string;
}

// Aucune saisie de l'ancien code : depuis Réglages, l'appli est déjà
// déverrouillée (donc déjà "authentifié") ; après une réinitialisation via
// licence, l'ancien code est par définition oublié.
export default function DefinirPinScreen({ onTermine, onAnnuler, titre }: Props) {
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [enCours, setEnCours] = useState(false);

  async function enregistrer() {
    if (pin.length < LONGUEUR_MIN) {
      Alert.alert("Code trop court", `Le code de verrouillage doit contenir au moins ${LONGUEUR_MIN} caractères.`);
      return;
    }
    if (pin !== confirmation) {
      Alert.alert("Erreur", "La confirmation ne correspond pas au code saisi.");
      return;
    }
    setEnCours(true);
    try {
      await definirPin(pin);
      onTermine();
    } finally {
      setEnCours(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.fond} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Carte>
          <Text style={styles.titre}>{titre ?? "🔒 Définir un code de verrouillage"}</Text>
          <Text style={styles.texte}>
            Ce code protège l'accès à l'application sur cet appareil uniquement -- il n'est jamais transmis ni connu de
            l'administrateur. Au moins {LONGUEUR_MIN} caractères.
          </Text>
          <TextInput
            style={styles.champ}
            placeholder="Nouveau code"
            placeholderTextColor="#9aa5b1"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={pin}
            onChangeText={setPin}
            editable={!enCours}
          />
          <TextInput
            style={styles.champ}
            placeholder="Confirmer le nouveau code"
            placeholderTextColor="#9aa5b1"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={confirmation}
            onChangeText={setConfirmation}
            editable={!enCours}
          />
          <Bouton
            titre="Enregistrer"
            onPress={enregistrer}
            enCours={enCours}
            desactive={pin.length < LONGUEUR_MIN || !confirmation}
          />
          {onAnnuler && (
            <Pressable style={styles.lienAnnuler} onPress={onAnnuler} disabled={enCours}>
              <Text style={styles.texteLienAnnuler}>Annuler</Text>
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
  titre: { fontSize: 19, fontWeight: "700", textAlign: "center", marginBottom: 12, color: "#1e293b" },
  texte: { fontSize: 13, color: "#475569", textAlign: "center", marginBottom: 20, lineHeight: 19 },
  champ: {
    borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 12, padding: 14,
    fontSize: 15, marginBottom: 10, backgroundColor: "#fafcff",
  },
  lienAnnuler: { alignItems: "center", marginTop: 16 },
  texteLienAnnuler: { color: "#64748b", fontSize: 13, fontWeight: "600" },
});
