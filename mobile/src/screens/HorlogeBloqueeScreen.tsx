import { StyleSheet, Text, View } from "react-native";
import Carte from "../components/Carte";

// Plein écran, sans navigation possible (voir App.tsx) : affiché tant que
// licence/horlogeGarde.ts détecte que l'horloge de l'appareil a reculé sous
// le plafond déjà connu -- se déverrouille tout seul (App.tsx revérifie à
// chaque changement d'état de l'app) dès que l'horloge avance à nouveau,
// aucune action possible depuis cet écran.
export default function HorlogeBloqueeScreen() {
  return (
    <View style={styles.fond}>
      <Carte>
        <Text style={styles.titre}>⏱️ Horloge de l'appareil incohérente</Text>
        <Text style={styles.texte}>
          La date de cet appareil semble avoir reculé par rapport à la dernière utilisation connue de l'application.
        </Text>
        <Text style={styles.texte}>
          Corrige la date et l'heure de ton téléphone (idéalement en mode automatique) puis rouvre l'application.
        </Text>
      </Carte>
    </View>
  );
}

const styles = StyleSheet.create({
  fond: { flex: 1, backgroundColor: "#eef2f9", justifyContent: "center", padding: 24 },
  titre: { fontSize: 20, fontWeight: "700", textAlign: "center", marginBottom: 16, color: "#1e293b" },
  texte: { fontSize: 14, color: "#475569", textAlign: "center", marginBottom: 12, lineHeight: 20 },
});
