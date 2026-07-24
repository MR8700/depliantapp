import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import * as Sharing from "expo-sharing";

interface Props {
  uri: string | null;
  chargement: boolean;
  erreur: string | null;
  momentsEnCause?: string[];
  onFermer?: () => void;
}

// Aperçu PDF simplifié : WebView sur le fichier local téléchargé (Android
// WebView moderne intègre PDFium et l'affiche directement) + un bouton
// "Ouvrir avec..." de secours si l'affichage inline échoue sur un appareil
// donné. Pas de live-preview débattue comme le web (nécessiterait un
// composant PDF natif dédié, hors Expo Go) -- voir memory pour ce choix assumé.
export default function PdfViewer({ uri, chargement, erreur, momentsEnCause, onFermer }: Props) {
  const [erreurAffichage, setErreurAffichage] = useState(false);

  async function ouvrirAvec() {
    if (!uri) return;
    const disponible = await Sharing.isAvailableAsync();
    if (!disponible) {
      Alert.alert("Indisponible", "Le partage n'est pas disponible sur cet appareil.");
      return;
    }
    await Sharing.shareAsync(uri, { mimeType: "application/pdf" });
  }

  if (chargement) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.texteChargement}>Génération du PDF...</Text>
      </View>
    );
  }

  if (erreur) {
    return (
      <View style={styles.centre}>
        <Text style={styles.titreErreur}>Le feuillet ne tient pas dans la page</Text>
        <Text style={styles.texteErreur}>{erreur}</Text>
        {momentsEnCause && momentsEnCause.length > 0 && (
          <View style={styles.listeMoments}>
            {momentsEnCause.map((m) => <Text key={m} style={styles.momentEnCause}>• {m}</Text>)}
          </View>
        )}
      </View>
    );
  }

  if (!uri) {
    return (
      <View style={styles.centre}>
        <Text style={styles.texteChargement}>Aucun aperçu pour le moment.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {erreurAffichage ? (
        <View style={styles.centre}>
          <Text style={styles.texteChargement}>
            L'aperçu intégré n'est pas disponible sur cet appareil -- utilise "Ouvrir le PDF" ci-dessous.
          </Text>
        </View>
      ) : (
        <>
          <Text style={styles.astuce}>
            Si l'aperçu ci-dessous reste vide, utilise le bouton "Ouvrir le PDF" -- ça reste le moyen le plus fiable de le consulter.
          </Text>
          <WebView source={{ uri }} style={{ flex: 1 }} onError={() => setErreurAffichage(true)} />
        </>
      )}
      <View style={styles.barreOutils}>
        <Pressable style={styles.boutonPrincipal} onPress={ouvrirAvec}>
          <Text style={styles.texteBoutonPrincipal}>Ouvrir le PDF</Text>
        </Pressable>
        {onFermer && (
          <Pressable style={styles.boutonOutil} onPress={onFermer}>
            <Text style={styles.texteBoutonOutil}>Fermer</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  texteChargement: { marginTop: 12, color: "#64748b", fontSize: 14, textAlign: "center" },
  titreErreur: { fontSize: 16, fontWeight: "700", color: "#dc2626", marginBottom: 8, textAlign: "center" },
  texteErreur: { fontSize: 14, color: "#7f1d1d", textAlign: "center" },
  listeMoments: { marginTop: 12 },
  momentEnCause: { fontSize: 13, color: "#991b1b" },
  astuce: { fontSize: 11, color: "#94a3b8", textAlign: "center", padding: 8, backgroundColor: "#f8fafc" },
  barreOutils: { flexDirection: "row", padding: 10, gap: 10, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  boutonPrincipal: { flex: 2, alignItems: "center", paddingVertical: 12, backgroundColor: "#2563eb", borderRadius: 10 },
  texteBoutonPrincipal: { color: "#fff", fontWeight: "700", fontSize: 14 },
  boutonOutil: { flex: 1, alignItems: "center", paddingVertical: 12, backgroundColor: "#eef2f9", borderRadius: 10 },
  texteBoutonOutil: { color: "#2563eb", fontWeight: "600", fontSize: 13 },
});
