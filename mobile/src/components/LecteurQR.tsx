import { StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import Bouton from "./Bouton";

interface Props {
  onScanne: (donnees: string) => void;
  /** false une fois qu'un scan a déjà été traité -- évite de redéclencher
   * onScanne en rafale tant que la caméra reste ouverte sur le même QR. */
  actif: boolean;
}

// Scanner QR minimal réutilisé par ActivationScreen.tsx (code de licence
// racine), AjouterAppareilMaitreScreen.tsx et
// RejoindreAppareilEnfantScreen.tsx (handshake maître/enfant) -- toute la
// logique de permission caméra vit ici, une seule fois.
export default function LecteurQR({ onScanne, actif }: Props) {
  const [permission, demanderPermission] = useCameraPermissions();

  if (!permission) return null;

  if (!permission.granted) {
    return (
      <View style={styles.conteneurPermission}>
        <Text style={styles.textePermission}>Autorise l'accès à la caméra pour scanner un code QR.</Text>
        <Bouton titre="Autoriser la caméra" onPress={demanderPermission} />
      </View>
    );
  }

  return (
    <View style={styles.conteneur}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={actif ? (resultat) => onScanne(resultat.data) : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  conteneur: { width: "100%", aspectRatio: 1, borderRadius: 16, overflow: "hidden", backgroundColor: "#000" },
  conteneurPermission: { padding: 16, alignItems: "center", gap: 12 },
  textePermission: { fontSize: 13, color: "#475569", textAlign: "center" },
});
