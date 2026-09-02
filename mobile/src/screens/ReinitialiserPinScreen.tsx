import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import * as Clipboard from "expo-clipboard";
import { reinitialiserPinViaLicence } from "../licence/pinChorale";
import Carte from "../components/Carte";
import Bouton from "../components/Bouton";
import LecteurQR from "../components/LecteurQR";

interface Props {
  /** Le verrou est déjà levé côté stockage (voir reinitialiserPinViaLicence)
   * une fois qu'on appelle onReinitialise -- reste seulement à définir un
   * nouveau code (voir DefinirPinScreen, appelé juste après par App.tsx). */
  onReinitialise: () => void;
  onAnnuler: () => void;
}

// Réinitialisation du verrou local en cas d'oubli : même geste que
// l'activation initiale (coller/scanner le code de licence, voir
// ActivationScreen.tsx/LicenceExpireeScreen.tsx) -- ce code est déjà connu
// de la chorale, aucune notion de mot de passe oublié à gérer séparément.
export default function ReinitialiserPinScreen({ onReinitialise, onAnnuler }: Props) {
  const [code, setCode] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanTraite, setScanTraite] = useState(false);

  async function tenterReinitialisation(blob: string) {
    const nettoye = blob.trim();
    if (!nettoye) return;
    setEnCours(true);
    try {
      const ok = await reinitialiserPinViaLicence(nettoye);
      if (!ok) {
        Alert.alert("Code invalide", "Ce code ne correspond pas à la licence active sur cet appareil.");
        return;
      }
      onReinitialise();
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
    tenterReinitialisation(donnees).finally(() => setScanTraite(false));
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <Carte>
        <Text style={styles.titre}>Réinitialiser le verrouillage</Text>
        <Text style={styles.texte}>
          Colle ou scanne à nouveau le code de licence de ta chorale -- le même que celui utilisé pour activer l'application.
          Un nouveau code de verrouillage te sera ensuite demandé.
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
            <Bouton titre="Vérifier et réinitialiser" onPress={() => tenterReinitialisation(code)} enCours={enCours} desactive={!code.trim()} />
            <Pressable style={styles.boutonScanner} onPress={() => setScannerVisible(true)}>
              <Text style={styles.texteBoutonScanner}>📷 Scanner un QR code</Text>
            </Pressable>
          </>
        )}

        <Pressable style={styles.lienAnnuler} onPress={onAnnuler}>
          <Text style={styles.texteLienAnnuler}>Retour au verrouillage</Text>
        </Pressable>
      </Carte>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24, backgroundColor: "#eef2f9" },
  titre: { fontSize: 20, fontWeight: "700", textAlign: "center", marginBottom: 12, color: "#1e293b" },
  texte: { fontSize: 14, color: "#475569", textAlign: "center", marginBottom: 20, lineHeight: 20 },
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
  lienAnnuler: { marginTop: 18, alignItems: "center" },
  texteLienAnnuler: { color: "#64748b", fontSize: 13, fontWeight: "600" },
});
