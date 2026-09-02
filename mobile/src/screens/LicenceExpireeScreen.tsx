import { useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { verifierLicenceBlob } from "../licence/verification";
import { licenceExpiree } from "../licence/expiration";
import { setLicenceLocale, RoleLicence } from "../storage/secureStore";
import Carte from "../components/Carte";
import Bouton from "../components/Bouton";

// Même numéro que ActivationScreen.tsx -- wa.me n'accepte pas le "+".
const NUMERO_WHATSAPP_LICENCE = "22652045008";

interface Props {
  /** Conserve le rôle (maitre/enfant) déjà établi sur cet appareil -- une
   * réactivation ne doit jamais transformer un appareil "enfant" en
   * "maitre" juste parce que la licence a expiré. */
  roleActuel: RoleLicence;
  onRenouvelee: () => void;
}

// Plein écran, sans accès à HomeTabs (voir App.tsx) : affiché dès que
// licence/expiration.ts détecte que payload.expireLe est dépassé -- avant
// ce chantier, une licence expirée continuait de fonctionner indéfiniment
// (seule sa signature Ed25519, valable pour toujours, était revérifiée).
export default function LicenceExpireeScreen({ roleActuel, onRenouvelee }: Props) {
  const [code, setCode] = useState("");
  const [enCours, setEnCours] = useState(false);

  async function contacterAdmin() {
    const texte = encodeURIComponent("Bonjour, ma licence DepliantApp a expiré, je souhaite la renouveler.");
    const urlApp = `whatsapp://send?phone=${NUMERO_WHATSAPP_LICENCE}&text=${texte}`;
    const urlWeb = `https://wa.me/${NUMERO_WHATSAPP_LICENCE}?text=${texte}`;
    try {
      const supporteApp = await Linking.canOpenURL(urlApp);
      await Linking.openURL(supporteApp ? urlApp : urlWeb);
    } catch {
      Alert.alert("WhatsApp indisponible", `Contacte l'administrateur directement au +${NUMERO_WHATSAPP_LICENCE}.`);
    }
  }

  async function activerNouveauCode() {
    const nettoye = code.trim();
    if (!nettoye) return;
    setEnCours(true);
    try {
      const payload = verifierLicenceBlob(nettoye);
      if (!payload) {
        Alert.alert("Code invalide", "Ce code de licence n'est pas reconnu -- vérifie qu'il a été copié en entier.");
        return;
      }
      if (licenceExpiree(payload)) {
        Alert.alert("Toujours expiré", "Ce code correspond lui aussi à une licence déjà expirée.");
        return;
      }
      await setLicenceLocale(nettoye, roleActuel);
      onRenouvelee();
    } finally {
      setEnCours(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Carte>
        <Text style={styles.titre}>⛔ Licence expirée</Text>
        <Text style={styles.texte}>
          La licence de votre chorale a expiré. Contactez l'administrateur pour la renouveler, puis collez ci-dessous le nouveau code qu'il vous
          transmettra.
        </Text>
        <Pressable style={styles.boutonWhatsapp} onPress={contacterAdmin}>
          <Text style={styles.texteBoutonWhatsapp}>💬 Contacter l'administrateur</Text>
        </Pressable>
        <TextInput
          style={styles.champ}
          placeholder="Nouveau code de licence"
          placeholderTextColor="#9aa5b1"
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          value={code}
          onChangeText={setCode}
          editable={!enCours}
        />
        <Bouton titre="Activer le nouveau code" onPress={activerNouveauCode} enCours={enCours} desactive={!code.trim()} />
      </Carte>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24, backgroundColor: "#eef2f9" },
  titre: { fontSize: 20, fontWeight: "700", textAlign: "center", marginBottom: 16, color: "#dc2626" },
  texte: { fontSize: 14, color: "#475569", textAlign: "center", marginBottom: 16, lineHeight: 20 },
  boutonWhatsapp: {
    marginBottom: 16, backgroundColor: "#e9fbf0", borderWidth: 1, borderColor: "#25D366",
    borderRadius: 12, paddingVertical: 13, alignItems: "center",
  },
  texteBoutonWhatsapp: { color: "#128C4A", fontSize: 15, fontWeight: "700" },
  champ: {
    borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 12, padding: 14,
    fontSize: 13, marginBottom: 12, backgroundColor: "#fafcff", minHeight: 70, textAlignVertical: "top",
  },
});
