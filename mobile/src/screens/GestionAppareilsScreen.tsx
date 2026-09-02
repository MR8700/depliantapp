import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { getLicenceLocale, getAppareilsAutorises, AppareilAutorise, RoleLicence } from "../storage/secureStore";
import Carte from "../components/Carte";
import Bouton from "../components/Bouton";

interface Props {
  navigation: any;
}

export default function GestionAppareilsScreen({ navigation }: Props) {
  const [role, setRole] = useState<RoleLicence | null>(null);
  const [devMax, setDevMax] = useState(1);
  const [appareils, setAppareils] = useState<AppareilAutorise[]>([]);

  useEffect(() => {
    (async () => {
      const [licence, liste] = await Promise.all([getLicenceLocale(), getAppareilsAutorises()]);
      if (!licence) return;
      setRole(licence.role);
      setDevMax(licence.payload.devMax);
      setAppareils(liste);
    })();
  }, []);

  if (role === "enfant") {
    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        <Carte>
          <Text style={styles.titre}>📱 Appareils</Text>
          <Text style={styles.texte}>
            Cet appareil a été autorisé par l'appareil principal (maître) de ta chorale. Pour ajouter/retirer des appareils, utilise l'appareil qui a activé la licence en premier.
          </Text>
        </Carte>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Carte>
        <Text style={styles.titre}>📱 Appareils autorisés</Text>
        <Text style={styles.texte}>
          {appareils.length + 1} / {devMax} appareil(s) utilisé(s) sur cette licence (cet appareil compte comme le premier).
        </Text>
        <View style={styles.liste}>
          <View style={styles.ligne}>
            <Text style={styles.nomAppareil}>Cet appareil (maître)</Text>
          </View>
          {appareils.map((a) => (
            <View key={a.appareilId} style={styles.ligne}>
              <Text style={styles.nomAppareil}>{a.appareilNom ?? "Appareil"}</Text>
              <Text style={styles.dateAutorisation}>{new Date(a.autoriseLe * 1000).toLocaleDateString("fr-FR")}</Text>
            </View>
          ))}
        </View>
        <Bouton
          titre="+ Ajouter un appareil"
          onPress={() => navigation.navigate("AjouterAppareil")}
          desactive={appareils.length >= devMax - 1}
        />
      </Carte>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, padding: 16, backgroundColor: "#eef2f9" },
  titre: { fontSize: 18, fontWeight: "700", marginBottom: 12, color: "#1e293b" },
  texte: { fontSize: 13, color: "#475569", marginBottom: 14, lineHeight: 19 },
  liste: { marginBottom: 16 },
  ligne: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: "#fff", borderRadius: 10, padding: 12, marginBottom: 8,
  },
  nomAppareil: { fontSize: 13, fontWeight: "600", color: "#1e293b" },
  dateAutorisation: { fontSize: 11, color: "#94a3b8" },
});
