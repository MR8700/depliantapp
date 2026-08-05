import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { apiFetch, ApiError } from "../api/client";
import Bouton from "../components/Bouton";

interface Props {
  onChange: () => void;
}

// Équivalent mobile du formulaire bloquant de login.html (must_change_password
// -- voir routers/auth.py) : un compte avec mot de passe temporaire ne doit
// jamais pouvoir naviguer dans l'app tant qu'il n'a pas changé de mot de
// passe. Contrairement à ProfilScreen (qui a le même formulaire mais en
// facultatif dans Réglages), cet écran remplace entièrement HomeTabs -- pas
// de bouton "annuler", pas de barre de navigation, aucune échappatoire.
export default function ChangerMotDePasseObligatoireScreen({ onChange }: Props) {
  const [motDePasseActuel, setMotDePasseActuel] = useState("");
  const [nouveauMotDePasse, setNouveauMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [enCours, setEnCours] = useState(false);

  const exigences = {
    longueur: nouveauMotDePasse.length >= 8,
    majuscule: /[A-Z]/.test(nouveauMotDePasse),
    minuscule: /[a-z]/.test(nouveauMotDePasse),
    chiffre: /[0-9]/.test(nouveauMotDePasse),
    special: /[^A-Za-z0-9]/.test(nouveauMotDePasse),
  };
  const scoreForce = Object.values(exigences).filter(Boolean).length;
  const labelForce = scoreForce <= 2 ? "Faible" : scoreForce <= 4 ? "Moyenne" : "Forte";
  const couleurForce = scoreForce <= 2 ? "#ef4444" : scoreForce <= 4 ? "#d97706" : "#16a34a";

  async function valider() {
    if (nouveauMotDePasse !== confirmation) {
      Alert.alert("Erreur", "La confirmation ne correspond pas au nouveau mot de passe.");
      return;
    }
    setEnCours(true);
    try {
      await apiFetch("/auth/change-password", {
        method: "POST",
        body: { mot_de_passe_actuel: motDePasseActuel, nouveau_mot_de_passe: nouveauMotDePasse },
      });
      onChange();
    } catch (erreur) {
      const message = erreur instanceof ApiError ? erreur.message : "Impossible de contacter le serveur -- vérifie ta connexion internet";
      Alert.alert("Changement impossible", message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.fond} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.titre}>Mot de passe temporaire</Text>
        <Text style={styles.sousTitre}>
          Pour des raisons de sécurité, tu dois choisir un nouveau mot de passe avant de continuer.
        </Text>

        <Text style={styles.label}>Mot de passe actuel (temporaire)</Text>
        <TextInput style={styles.champ} secureTextEntry value={motDePasseActuel} onChangeText={setMotDePasseActuel} editable={!enCours} />
        <Text style={styles.label}>Nouveau mot de passe</Text>
        <TextInput style={styles.champ} secureTextEntry value={nouveauMotDePasse} onChangeText={setNouveauMotDePasse} editable={!enCours} />
        <Text style={styles.label}>Confirmation</Text>
        <TextInput style={styles.champ} secureTextEntry value={confirmation} onChangeText={setConfirmation} editable={!enCours} />

        <View style={styles.rangeeForce}>
          <Text style={styles.labelForce}>Robustesse :</Text>
          <Text style={[styles.labelForce, { color: couleurForce, fontWeight: "700" }]}>{labelForce}</Text>
        </View>
        <View style={styles.barreForce}>
          <View style={[styles.barreForceRemplie, { width: `${(scoreForce / 5) * 100}%`, backgroundColor: couleurForce }]} />
        </View>

        <View style={styles.exigences}>
          <Text style={styles.titreExigences}>Exigences de sécurité :</Text>
          <Text style={styles.exigence}>{exigences.longueur ? "✅" : "❌"} minimum 8 caractères</Text>
          <Text style={styles.exigence}>{exigences.majuscule ? "✅" : "❌"} une lettre majuscule</Text>
          <Text style={styles.exigence}>{exigences.minuscule ? "✅" : "❌"} une lettre minuscule</Text>
          <Text style={styles.exigence}>{exigences.chiffre ? "✅" : "❌"} un chiffre</Text>
          <Text style={styles.exigence}>{exigences.special ? "✅" : "❌"} un caractère spécial</Text>
        </View>

        <Bouton
          titre="Valider le nouveau mot de passe"
          onPress={valider}
          enCours={enCours}
          desactive={!motDePasseActuel || nouveauMotDePasse.length < 8 || !confirmation}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fond: { flex: 1, backgroundColor: "#eef2f9" },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  titre: { fontSize: 22, fontWeight: "800", textAlign: "center", marginBottom: 8, color: "#1e293b" },
  sousTitre: { fontSize: 13, color: "#555", textAlign: "center", marginBottom: 24, lineHeight: 19 },
  label: { fontSize: 12, color: "#64748b", marginBottom: 4, marginTop: 6 },
  champ: { borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 10, padding: 12, backgroundColor: "#fff", marginBottom: 4, fontSize: 15 },
  rangeeForce: { flexDirection: "row", justifyContent: "space-between", marginTop: 14 },
  labelForce: { fontSize: 11, color: "#64748b" },
  barreForce: { height: 6, backgroundColor: "#e2e8f0", borderRadius: 3, marginTop: 4, overflow: "hidden" },
  barreForceRemplie: { height: "100%" },
  exigences: { backgroundColor: "#fff", borderRadius: 10, padding: 14, marginTop: 16, marginBottom: 20 },
  titreExigences: { fontSize: 12, fontWeight: "700", color: "#475569", marginBottom: 6 },
  exigence: { fontSize: 12, color: "#64748b", marginBottom: 4 },
});
