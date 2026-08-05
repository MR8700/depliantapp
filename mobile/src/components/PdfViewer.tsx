import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PdfView } from "@kishannareshpal/expo-pdf";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";

interface Props {
  uri: string | null;
  chargement: boolean;
  erreur: string | null;
  momentsEnCause?: string[];
  onFermer?: () => void;
  /** Taille de police manuelle actuelle (null = auto) -- affiche le
   * stepper +/- si fourni, comme le réglage manuel du web (voir Composer). */
  tailleTexteManuelle?: number | null;
  onChangerTailleTexte?: (taille: number | null) => void;
}

// Aperçu PDF : rendu natif via @kishannareshpal/expo-pdf (PDFium) sur le
// fichier local téléchargé. Remplace une première version basée sur
// react-native-webview -- WebView n'embarque PAS de rendu PDF sur Android
// (contrairement à l'hypothèse initiale) : l'aperçu restait systématiquement
// vide sur appareil réel (confirmé sur Samsung/Android 13), d'où ce
// composant natif dédié. Le bouton "Ouvrir avec..." reste en secours.
export default function PdfViewer({
  uri, chargement, erreur, momentsEnCause, onFermer, tailleTexteManuelle, onChangerTailleTexte,
}: Props) {
  const insets = useSafeAreaInsets();
  const [erreurAffichage, setErreurAffichage] = useState<string | null>(null);
  const [impressionEnCours, setImpressionEnCours] = useState(false);

  async function ouvrirAvec() {
    if (!uri) return;
    const disponible = await Sharing.isAvailableAsync();
    if (!disponible) {
      Alert.alert("Indisponible", "Le partage n'est pas disponible sur cet appareil.");
      return;
    }
    await Sharing.shareAsync(uri, { mimeType: "application/pdf" });
  }

  async function imprimer() {
    if (!uri) return;
    setImpressionEnCours(true);
    try {
      await Print.printAsync({ uri });
    } catch {
      // Annulation de la boîte de dialogue native -- pas une erreur à signaler.
    } finally {
      setImpressionEnCours(false);
    }
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
            L'aperçu intégré n'a pas pu s'afficher ({erreurAffichage}) -- utilise "Ouvrir le PDF" ci-dessous.
          </Text>
        </View>
      ) : (
        <PdfView
          uri={uri}
          style={{ flex: 1 }}
          fitMode="width"
          pagingEnabled
          doubleTapToZoom
          onError={({ message }) => setErreurAffichage(message)}
        />
      )}
      {onChangerTailleTexte && (
        <View style={[styles.barreTaille, { paddingTop: 8 }]}>
          <Text style={styles.texteTaille}>Taille du texte</Text>
          <View style={styles.stepperTaille}>
            <Pressable
              style={styles.boutonStepper}
              onPress={() => onChangerTailleTexte(Math.max(8, (tailleTexteManuelle ?? 8) - 1))}
            >
              <Text style={styles.texteStepper}>－</Text>
            </Pressable>
            <Text style={styles.valeurStepper}>{tailleTexteManuelle != null ? `${tailleTexteManuelle}pt` : "Auto"}</Text>
            <Pressable
              style={styles.boutonStepper}
              onPress={() => onChangerTailleTexte(Math.min(32, (tailleTexteManuelle ?? 8) + 1))}
            >
              <Text style={styles.texteStepper}>＋</Text>
            </Pressable>
            {tailleTexteManuelle != null && (
              <Pressable style={styles.boutonStepper} onPress={() => onChangerTailleTexte(null)}>
                <Text style={[styles.texteStepper, { fontSize: 11 }]}>Auto</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
      <View style={[styles.barreOutils, { paddingBottom: insets.bottom + 10 }]}>
        <Pressable style={styles.boutonPrincipal} onPress={ouvrirAvec}>
          <Text style={styles.texteBoutonPrincipal}>Ouvrir le PDF</Text>
        </Pressable>
        <Pressable style={styles.boutonOutil} onPress={imprimer} disabled={impressionEnCours}>
          <Text style={styles.texteBoutonOutil}>{impressionEnCours ? "…" : "🖨️ Imprimer"}</Text>
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
  barreTaille: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, backgroundColor: "#fff" },
  texteTaille: { fontSize: 12, color: "#64748b", fontWeight: "600" },
  stepperTaille: { flexDirection: "row", alignItems: "center", gap: 6 },
  boutonStepper: { backgroundColor: "#eef2f9", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  texteStepper: { fontSize: 14, fontWeight: "700", color: "#2563eb" },
  valeurStepper: { fontSize: 12, color: "#334155", fontWeight: "700", minWidth: 40, textAlign: "center" },
  barreOutils: { flexDirection: "row", padding: 10, gap: 10, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  boutonPrincipal: { flex: 2, alignItems: "center", paddingVertical: 12, backgroundColor: "#2563eb", borderRadius: 10 },
  texteBoutonPrincipal: { color: "#fff", fontWeight: "700", fontSize: 14 },
  boutonOutil: { flex: 1, alignItems: "center", paddingVertical: 12, backgroundColor: "#eef2f9", borderRadius: 10 },
  texteBoutonOutil: { color: "#2563eb", fontWeight: "600", fontSize: 13 },
});
