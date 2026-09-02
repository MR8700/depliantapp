import { useState } from "react";
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import * as Clipboard from "expo-clipboard";
import { verifierLicenceBlob } from "../licence/verification";
import { verifierHorlogeEtMettreAJour } from "../licence/horlogeGarde";
import { setLicenceLocale } from "../storage/secureStore";
import Carte from "../components/Carte";
import Bouton from "../components/Bouton";
import LecteurQR from "../components/LecteurQR";

interface Props {
  onActivee: () => void;
  onDemandeConnexionAdmin: () => void;
  onDemandeRejoindreAppareil: () => void;
}

// Numéro WhatsApp de vente de licences -- wa.me n'accepte pas le "+", juste
// l'indicatif pays + numéro.
const NUMERO_WHATSAPP_LICENCE = "22652045008";
const MESSAGE_WHATSAPP_LICENCE = "Bonjour, je souhaite payer une licence DepliantApp pour ma chorale.";

async function contacterPourLicence() {
  const texte = encodeURIComponent(MESSAGE_WHATSAPP_LICENCE);
  const urlApp = `whatsapp://send?phone=${NUMERO_WHATSAPP_LICENCE}&text=${texte}`;
  const urlWeb = `https://wa.me/${NUMERO_WHATSAPP_LICENCE}?text=${texte}`;
  try {
    const supporteApp = await Linking.canOpenURL(urlApp);
    await Linking.openURL(supporteApp ? urlApp : urlWeb);
  } catch {
    Alert.alert("WhatsApp indisponible", `Contactez-nous directement au +${NUMERO_WHATSAPP_LICENCE} pour payer une licence.`);
  }
}

// Activation 100% locale ("essence vivante") : le code/QR fourni par l'admin
// est un blob signé Ed25519 -- décodé et vérifié entièrement sur cet
// appareil, AUCUN appel réseau, contrairement à l'ancien flux (POST
// /licences/activer). Le premier appareil à activer un code donné devient
// "maitre" localement (voir storage/secureStore.ts::RoleLicence) ; les
// appareils suivants de la même chorale doivent plutôt passer par
// onDemandeRejoindreAppareil (handshake QR avec l'appareil maître, voir
// screens/RejoindreAppareilEnfantScreen.tsx) pour que le plafond
// d'appareils (dev_max) soit respecté.
export default function ActivationScreen({ onActivee, onDemandeConnexionAdmin, onDemandeRejoindreAppareil }: Props) {
  const [code, setCode] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanTraite, setScanTraite] = useState(false);

  async function activerBlob(blob: string) {
    const nettoye = blob.trim();
    if (!nettoye) return;
    setEnCours(true);
    try {
      const payload = verifierLicenceBlob(nettoye);
      if (!payload) {
        Alert.alert("Code invalide", "Ce code de licence n'est pas reconnu -- vérifie qu'il a été copié en entier, sans espace ajouté.");
        return;
      }
      const horloge = await verifierHorlogeEtMettreAJour();
      if (!horloge.ok) {
        Alert.alert(
          "Horloge incohérente",
          "La date de cet appareil semble avoir reculé. Corrige-la avant de continuer.",
        );
        return;
      }
      await setLicenceLocale(nettoye, "maitre");
      onActivee();
    } finally {
      setEnCours(false);
    }
  }

  async function collerDepuisPressePapiers() {
    const contenu = await Clipboard.getStringAsync();
    if (contenu) setCode(contenu.trim());
  }

  function onQrScanne(donnees: string) {
    if (scanTraite) return;
    setScanTraite(true);
    setScannerVisible(false);
    activerBlob(donnees).finally(() => setScanTraite(false));
  }

  return (
    <KeyboardAvoidingView style={styles.fond} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Carte>
          <Text style={styles.titre}>DepliantApp</Text>
          <Text style={styles.sousTitre}>
            Scanne ou colle le code de licence fourni à ta chorale pour activer l'application sur cet appareil.
            L'activation se fait entièrement en local, aucune connexion internet n'est nécessaire.
          </Text>

          {scannerVisible ? (
            <>
              <LecteurQR onScanne={onQrScanne} actif={!scanTraite} />
              <Pressable style={styles.lienSecondaire} onPress={() => setScannerVisible(false)}>
                <Text style={styles.texteLienSecondaire}>Annuler le scan</Text>
              </Pressable>
            </>
          ) : (
            <>
              <TextInput
                style={styles.champ}
                placeholder="Colle ici le code de licence"
                placeholderTextColor="#9aa5b1"
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                value={code}
                onChangeText={setCode}
                editable={!enCours}
              />
              <Pressable style={styles.lienSecondaire} onPress={collerDepuisPressePapiers}>
                <Text style={styles.texteLienSecondaire}>📋 Coller depuis le presse-papiers</Text>
              </Pressable>
              <Bouton titre="Activer" onPress={() => activerBlob(code)} enCours={enCours} desactive={!code.trim()} />
              <Pressable style={styles.boutonScanner} onPress={() => setScannerVisible(true)}>
                <Text style={styles.texteBoutonScanner}>📷 Scanner un QR code</Text>
              </Pressable>
            </>
          )}

          <Pressable style={styles.boutonWhatsapp} onPress={contacterPourLicence}>
            <Text style={styles.texteBoutonWhatsapp}>💬 Payer une licence</Text>
          </Pressable>
          <Pressable style={styles.lienAdmin} onPress={onDemandeRejoindreAppareil}>
            <Text style={styles.texteLienAdmin}>Ta chorale est déjà active sur un autre appareil ? Rejoindre →</Text>
          </Pressable>
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
    fontSize: 13, marginBottom: 12, backgroundColor: "#fafcff", minHeight: 70, textAlignVertical: "top",
  },
  lienSecondaire: { alignItems: "center", marginBottom: 16 },
  texteLienSecondaire: { color: "#2563eb", fontSize: 13, fontWeight: "600" },
  boutonScanner: {
    marginTop: 14, backgroundColor: "#eef2ff", borderWidth: 1, borderColor: "#2563eb",
    borderRadius: 12, paddingVertical: 13, alignItems: "center",
  },
  texteBoutonScanner: { color: "#2563eb", fontSize: 15, fontWeight: "700" },
  boutonWhatsapp: {
    marginTop: 14, backgroundColor: "#e9fbf0", borderWidth: 1, borderColor: "#25D366",
    borderRadius: 12, paddingVertical: 13, alignItems: "center",
  },
  texteBoutonWhatsapp: { color: "#128C4A", fontSize: 15, fontWeight: "700" },
  lienAdmin: { marginTop: 18, alignItems: "center" },
  texteLienAdmin: { color: "#2563eb", fontSize: 13, fontWeight: "600" },
});
