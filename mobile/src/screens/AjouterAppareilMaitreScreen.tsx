import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { getLicenceLocale, ajouterAppareilAutorise, getAppareilsAutorises, AppareilAutorise } from "../storage/secureStore";
import { calculerAutorisationAppareil, decoderPaireAppareil, encoderRetourMaitre } from "../licence/appareils";
import Carte from "../components/Carte";
import LecteurQR from "../components/LecteurQR";

// Côté "maître" du handshake QR (voir licence/appareils.ts) : scanne le QR
// d'un nouvel appareil (montré par RejoindreAppareilEnfantScreen.tsx), mint
// localement une autorisation liée à ce `seed` (jamais transmis, jamais
// contacté le serveur), et affiche le QR retour à faire scanner par ce
// nouvel appareil. Le plafond dev_max - 1 (le maître compte lui-même comme
// premier appareil) est appliqué ICI, localement -- contrôle souple, voir
// licence/appareils.ts pour les limites de ce modèle.
export default function AjouterAppareilMaitreScreen() {
  const [licenceUid, setLicenceUid] = useState<string | null>(null);
  const [seed, setSeed] = useState<string | null>(null);
  const [licenceBlob, setLicenceBlob] = useState<string | null>(null);
  const [devMax, setDevMax] = useState(1);
  const [appareilsAutorises, setAppareilsAutorises] = useState<AppareilAutorise[]>([]);
  const [retourQr, setRetourQr] = useState<string | null>(null);
  const [scanTraite, setScanTraite] = useState(false);

  async function charger() {
    const [licence, liste] = await Promise.all([getLicenceLocale(), getAppareilsAutorises()]);
    if (!licence) return;
    setLicenceUid(licence.payload.licenceUid);
    setSeed(licence.payload.seed);
    setLicenceBlob(licence.blob);
    setDevMax(licence.payload.devMax);
    setAppareilsAutorises(liste);
  }

  useEffect(() => {
    charger();
  }, []);

  async function onQrScanne(donnees: string) {
    if (scanTraite || !licenceUid || !seed || !licenceBlob) return;
    setScanTraite(true);
    try {
      const paire = decoderPaireAppareil(donnees);
      if (!paire) {
        Alert.alert("QR invalide", "Ce QR ne correspond pas au format attendu.");
        return;
      }
      const liste = await getAppareilsAutorises();
      const dejaAutorise = liste.find((a) => a.appareilId === paire.appareilId);
      if (!dejaAutorise && liste.length >= devMax - 1) {
        Alert.alert("Plafond atteint", `Cette licence autorise ${devMax} appareil(s) au maximum -- déjà atteint.`);
        return;
      }
      const autorisation = calculerAutorisationAppareil(seed, licenceUid, paire.appareilId);
      if (!dejaAutorise) {
        await ajouterAppareilAutorise({ appareilId: paire.appareilId, appareilNom: paire.appareilNom, autoriseLe: Math.floor(Date.now() / 1000) });
        setAppareilsAutorises(await getAppareilsAutorises());
      }
      setRetourQr(encoderRetourMaitre({ licenceBlob, appareilId: paire.appareilId, autorisation }));
    } finally {
      setScanTraite(false);
    }
  }

  const placesRestantes = Math.max(0, devMax - 1 - appareilsAutorises.length);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Carte>
        <Text style={styles.titre}>Ajouter un appareil</Text>
        <Text style={styles.texte}>
          {placesRestantes > 0
            ? `${placesRestantes} place(s) restante(s) sur cette licence.`
            : "Plafond d'appareils atteint pour cette licence."}
        </Text>
        {retourQr ? (
          <>
            <Text style={styles.texte}>Fais scanner ce QR par le nouvel appareil pour terminer.</Text>
            <View style={styles.conteneurQr}>
              <QRCode value={retourQr} size={220} />
            </View>
            <Pressable style={styles.lien} onPress={() => setRetourQr(null)}>
              <Text style={styles.texteLien}>Ajouter un autre appareil</Text>
            </Pressable>
          </>
        ) : placesRestantes > 0 ? (
          <>
            <Text style={styles.texte}>Scanne le QR affiché sur le nouvel appareil (écran "Rejoindre une chorale déjà active").</Text>
            <LecteurQR onScanne={onQrScanne} actif={!scanTraite} />
          </>
        ) : null}
      </Carte>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, padding: 24, backgroundColor: "#eef2f9" },
  titre: { fontSize: 20, fontWeight: "700", textAlign: "center", marginBottom: 16, color: "#1e293b" },
  texte: { fontSize: 13, color: "#475569", marginBottom: 10, lineHeight: 19, textAlign: "center" },
  conteneurQr: { alignItems: "center", marginVertical: 16 },
  lien: { alignItems: "center", marginTop: 16 },
  texteLien: { color: "#2563eb", fontSize: 13, fontWeight: "600" },
});
