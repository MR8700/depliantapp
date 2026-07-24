import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import * as Sharing from "expo-sharing";

interface Props {
  visible: boolean;
  type: "audio" | "video";
  uri: string | null;
  chargement: boolean;
  erreur: string | null;
  onFermer: () => void;
}

// Lecteur audio/vidéo simplifié : même principe que PdfViewer -- WebView sur
// le fichier local déjà téléchargé (le lecteur média intégré au WebView
// système gère nativement les contrôles) + un bouton "Ouvrir avec..." de
// secours si la lecture inline échoue sur un appareil donné.
export default function ChantMediaPlayer({ visible, type, uri, chargement, erreur, onFermer }: Props) {
  const insets = useSafeAreaInsets();
  const [erreurAffichage, setErreurAffichage] = useState(false);

  async function ouvrirAvec() {
    if (!uri) return;
    const disponible = await Sharing.isAvailableAsync();
    if (!disponible) return;
    await Sharing.shareAsync(uri);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onFermer}>
      <View style={{ flex: 1, backgroundColor: "#0f172a" }}>
        {chargement ? (
          <View style={styles.centre}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.texteChargement}>Téléchargement...</Text>
          </View>
        ) : erreur ? (
          <View style={styles.centre}>
            <Text style={styles.texteErreur}>{erreur}</Text>
          </View>
        ) : uri && !erreurAffichage ? (
          <WebView source={{ uri }} style={{ flex: 1 }} allowsInlineMediaPlayback onError={() => setErreurAffichage(true)} />
        ) : (
          <View style={styles.centre}>
            <Text style={styles.texteChargement}>
              La lecture intégrée n'est pas disponible sur cet appareil -- utilise "Ouvrir avec..." ci-dessous.
            </Text>
          </View>
        )}
        <View style={[styles.barreOutils, { paddingBottom: insets.bottom + 10 }]}>
          <Pressable style={styles.boutonPrincipal} onPress={ouvrirAvec}>
            <Text style={styles.texteBoutonPrincipal}>{type === "audio" ? "🎵" : "🎥"} Ouvrir avec...</Text>
          </Pressable>
          <Pressable style={styles.boutonOutil} onPress={onFermer}>
            <Text style={styles.texteBoutonOutil}>Fermer</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  texteChargement: { marginTop: 12, color: "#cbd5e1", fontSize: 14, textAlign: "center" },
  texteErreur: { color: "#fca5a5", fontSize: 14, textAlign: "center" },
  barreOutils: { flexDirection: "row", padding: 10, gap: 10, backgroundColor: "#1e293b" },
  boutonPrincipal: { flex: 2, alignItems: "center", paddingVertical: 12, backgroundColor: "#2563eb", borderRadius: 10 },
  texteBoutonPrincipal: { color: "#fff", fontWeight: "700", fontSize: 14 },
  boutonOutil: { flex: 1, alignItems: "center", paddingVertical: 12, backgroundColor: "#334155", borderRadius: 10 },
  texteBoutonOutil: { color: "#fff", fontWeight: "600", fontSize: 13 },
});
