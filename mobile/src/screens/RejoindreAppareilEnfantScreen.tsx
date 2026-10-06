import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import * as Device from "expo-device";
import { idAppareil } from "../api/licences";
import { verifierLicenceBlob } from "../licence/verification";
import { verifierHorlogeEtMettreAJour } from "../licence/horlogeGarde";
import { calculerAutorisationAppareil, decoderRetourMaitre, encoderPaireAppareil } from "../licence/appareils";
import { setAutorisationAppareil, setLicenceLocale } from "../storage/secureStore";
import { sauvegarderMetaDisqueEnTempsReel } from "../licence/metaDisqueLicence";
import Carte from "../components/Carte";
import Bouton from "../components/Bouton";
import LecteurQR from "../components/LecteurQR";

interface Props {
  onRejoint: () => void;
  onAnnuler: () => void;
}

// Côté "enfant" du handshake QR maître/enfant (voir licence/appareils.ts) :
// montre l'identifiant de CET appareil pour que le maître le scanne et
// mint une autorisation, puis scanne le QR retour du maître pour la
// vérifier et rejoindre la chorale -- entièrement pair-à-pair local, aucun
// serveur impliqué. La chorale démarre avec une bibliothèque vide sur ce
// nouvel appareil (chants/dépliants/réglages restent propres à chaque
// appareil, seule l'identité/licence est partagée).
export default function RejoindreAppareilEnfantScreen({ onRejoint, onAnnuler }: Props) {
  const [appareilId, setAppareilId] = useState<string | null>(null);
  const [etapeScan, setEtapeScan] = useState(false);
  const [scanTraite, setScanTraite] = useState(false);

  useEffect(() => {
    idAppareil().then(setAppareilId);
  }, []);

  async function onQrScanne(donnees: string) {
    if (scanTraite || !appareilId) return;
    setScanTraite(true);
    try {
      const retour = decoderRetourMaitre(donnees);
      if (!retour) {
        Alert.alert("QR invalide", "Ce QR ne correspond pas au format attendu.");
        return;
      }
      if (retour.appareilId !== appareilId) {
        Alert.alert("QR invalide", "Ce QR a été généré pour un autre appareil.");
        return;
      }
      const payload = verifierLicenceBlob(retour.licenceBlob, retour.clePublique);
      if (!payload) {
        Alert.alert("Licence invalide", "La signature de la licence transmise par l'appareil maître n'est pas valide.");
        return;
      }
      const attendue = calculerAutorisationAppareil(payload.seed, payload.licenceUid, appareilId);
      if (attendue !== retour.autorisation) {
        Alert.alert("Autorisation invalide", "Cet appareil n'a pas été correctement autorisé par l'appareil maître.");
        return;
      }
      const horloge = await verifierHorlogeEtMettreAJour();
      if (!horloge.ok) {
        Alert.alert("Horloge incohérente", "La date de cet appareil semble avoir reculé. Corrige-la avant de continuer.");
        return;
      }
      await setLicenceLocale(retour.licenceBlob, "enfant", retour.clePublique ?? undefined);
      await setAutorisationAppareil(retour.autorisation);
      // Mémorisation inviolable sur le disque du statut enfant pour cet appareil
      await sauvegarderMetaDisqueEnTempsReel({
        licenceBlob: retour.licenceBlob,
        licenceUid: payload.licenceUid,
        choraleId: payload.choraleId,
        choraleNom: payload.choraleNom,
        role: "enfant",
        clePublique: retour.clePublique ?? null,
      });
      onRejoint();
    } finally {
      setScanTraite(false);
    }
  }

  const nomAppareilCompose = `${Device.manufacturer ?? ""} ${Device.modelName ?? ""}`.trim();
  const nomAppareil = Device.deviceName ?? (nomAppareilCompose || "Appareil inconnu");

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Carte>
        <Text style={styles.titre}>Rejoindre une chorale déjà active</Text>
        {!etapeScan ? (
          <>
            <Text style={styles.texte}>
              1. Montre ce QR à la personne qui a déjà activé l'application sur son téléphone (l'appareil "maître").
            </Text>
            <Text style={styles.texte}>2. Elle l'ajoutera depuis Réglages → Gérer les appareils.</Text>
            {appareilId && (
              <View style={styles.conteneurQr}>
                <QRCode value={encoderPaireAppareil({ appareilId, appareilNom: nomAppareil })} size={220} />
              </View>
            )}
            <Bouton titre="J'ai montré mon QR, continuer →" onPress={() => setEtapeScan(true)} desactive={!appareilId} />
          </>
        ) : (
          <>
            <Text style={styles.texte}>3. Scanne maintenant le QR affiché par l'appareil maître.</Text>
            <LecteurQR onScanne={onQrScanne} actif={!scanTraite} />
            <Pressable style={styles.lien} onPress={() => setEtapeScan(false)}>
              <Text style={styles.texteLien}>← Revenir à mon QR</Text>
            </Pressable>
          </>
        )}
        <Pressable style={styles.lien} onPress={onAnnuler}>
          <Text style={styles.texteLien}>Annuler</Text>
        </Pressable>
      </Carte>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24, backgroundColor: "#eef2f9" },
  titre: { fontSize: 20, fontWeight: "700", textAlign: "center", marginBottom: 16, color: "#1e293b" },
  texte: { fontSize: 13, color: "#475569", marginBottom: 10, lineHeight: 19 },
  conteneurQr: { alignItems: "center", marginVertical: 16 },
  lien: { alignItems: "center", marginTop: 16 },
  texteLien: { color: "#2563eb", fontSize: 13, fontWeight: "600" },
});
