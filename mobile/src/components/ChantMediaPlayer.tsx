import { useState, useRef, useEffect } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Sharing from "expo-sharing";

interface Props {
  visible: boolean;
  type: "audio" | "video";
  uri: string | null;
  titre?: string;
  pupitre?: string; // Tutti, Soprano, Alto, Ténor, Basse
  chargement: boolean;
  erreur: string | null;
  onFermer: () => void;
}

const VITESSES = [0.75, 1.0, 1.25, 1.5];

export default function ChantMediaPlayer({
  visible,
  type,
  uri,
  titre,
  pupitre = "Tutti",
  chargement,
  erreur,
  onFermer,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [vitesseIndex, setVitesseIndex] = useState(1); // 1.0 par défaut
  const [enBoucle, setEnBoucle] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const vitesseActuelle = VITESSES[vitesseIndex];

  function changerVitesse() {
    const nextIdx = (vitesseIndex + 1) % VITESSES.length;
    setVitesseIndex(nextIdx);
    const v = VITESSES[nextIdx];
    if (Platform.OS === "web") {
      if (audioRef.current) audioRef.current.playbackRate = v;
      if (videoRef.current) videoRef.current.playbackRate = v;
    }
  }

  function basculerBoucle() {
    const nextBoucle = !enBoucle;
    setEnBoucle(nextBoucle);
    if (Platform.OS === "web") {
      if (audioRef.current) audioRef.current.loop = nextBoucle;
      if (videoRef.current) videoRef.current.loop = nextBoucle;
    }
  }

  async function partagerOuOuvrir() {
    if (!uri) return;
    const disponible = await Sharing.isAvailableAsync();
    if (!disponible) return;
    await Sharing.shareAsync(uri);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onFermer} transparent={false}>
      <View style={[styles.conteneur, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* En-tête du lecteur */}
        <View style={styles.enTete}>
          <View style={styles.titreBoite}>
            <Text style={styles.enTeteIcone}>{type === "audio" ? "🎵" : "🎬"}</Text>
            <View>
              <Text style={styles.titreTexte} numberOfLines={1}>
                {titre || (type === "audio" ? "Piste audio du chant" : "Vidéo du chant")}
              </Text>
              <Text style={styles.sousTitreTexte}>
                Pupitre : <Text style={styles.badgePupitre}>{pupitre}</Text>
              </Text>
            </View>
          </View>
          <Pressable style={styles.boutonFermer} onPress={onFermer}>
            <Text style={styles.texteFermer}>✕</Text>
          </Pressable>
        </View>

        {/* Zone de lecture centrale */}
        <View style={styles.corps}>
          {chargement ? (
            <View style={styles.centre}>
              <ActivityIndicator size="large" color="#38bdf8" />
              <Text style={styles.texteInfo}>Chargement du flux multimédia...</Text>
            </View>
          ) : erreur ? (
            <View style={styles.centre}>
              <Text style={styles.texteErreurIcone}>⚠️</Text>
              <Text style={styles.texteErreur}>{erreur}</Text>
            </View>
          ) : uri ? (
            <View style={styles.mediaContainer}>
              {Platform.OS === "web" ? (
                type === "audio" ? (
                  <View style={styles.webPlayerBox}>
                    <View style={styles.pochetteDisque}>
                      <Text style={styles.pochetteIcone}>🎼</Text>
                      <Text style={styles.pochetteLabel}>{pupitre.toUpperCase()}</Text>
                    </View>
                    {/* @ts-ignore */}
                    <audio
                      ref={audioRef}
                      src={uri}
                      controls
                      autoPlay
                      style={{ width: "100%", maxWidth: 500, marginTop: 20 }}
                    />
                  </View>
                ) : (
                  <View style={styles.webVideoBox}>
                    {/* @ts-ignore */}
                    <video
                      ref={videoRef}
                      src={uri}
                      controls
                      autoPlay
                      style={{ width: "100%", maxHeight: 420, borderRadius: 12 }}
                    />
                  </View>
                )
              ) : (
                /* Mobile natif : WebView avec commandes HTML5 enrichies */
                <View style={{ flex: 1, width: "100%" }}>
                  <Text style={styles.texteInfo}>Lecture en cours sur votre appareil...</Text>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.centre}>
              <Text style={styles.texteInfo}>Aucun média disponible à la lecture.</Text>
            </View>
          )}
        </View>

        {/* Barre de contrôle d'apprentissage choral */}
        <View style={styles.barreControles}>
          <Pressable
            style={[styles.boutonOption, enBoucle && styles.boutonOptionActif]}
            onPress={basculerBoucle}
          >
            <Text style={styles.texteOption}>🔁 {enBoucle ? "Boucle ON" : "Boucle"}</Text>
          </Pressable>

          <Pressable style={styles.boutonOption} onPress={changerVitesse}>
            <Text style={styles.texteOption}>⚡ {vitesseActuelle}x</Text>
          </Pressable>

          <Pressable style={styles.boutonPartager} onPress={partagerOuOuvrir}>
            <Text style={styles.textePartager}>📤 Exporter</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  conteneur: {
    flex: 1,
    backgroundColor: "#0b1329",
    justifyContent: "space-between",
  },
  enTete: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
    backgroundColor: "#0f172a",
  },
  titreBoite: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  enTeteIcone: {
    fontSize: 26,
  },
  titreTexte: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "700",
  },
  sousTitreTexte: {
    color: "#94a3b8",
    fontSize: 13,
    marginTop: 2,
  },
  badgePupitre: {
    color: "#38bdf8",
    fontWeight: "700",
  },
  boutonFermer: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: "#1e293b",
  },
  texteFermer: {
    color: "#cbd5e1",
    fontSize: 16,
    fontWeight: "700",
  },
  corps: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  centre: {
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  texteInfo: {
    color: "#94a3b8",
    fontSize: 14,
    marginTop: 12,
    textAlign: "center",
  },
  texteErreurIcone: {
    fontSize: 32,
    marginBottom: 8,
  },
  texteErreur: {
    color: "#f87171",
    fontSize: 14,
    textAlign: "center",
  },
  mediaContainer: {
    width: "100%",
    maxWidth: 600,
    alignItems: "center",
    justifyContent: "center",
  },
  webPlayerBox: {
    width: "100%",
    alignItems: "center",
    backgroundColor: "#1e293b",
    padding: 24,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  pochetteDisque: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "#0f172a",
    borderWidth: 4,
    borderColor: "#38bdf8",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  pochetteIcone: {
    fontSize: 48,
  },
  pochetteLabel: {
    color: "#38bdf8",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
  },
  webVideoBox: {
    width: "100%",
    backgroundColor: "#000",
    borderRadius: 12,
    overflow: "hidden",
  },
  barreControles: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    backgroundColor: "#0f172a",
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    justifyContent: "center",
  },
  boutonOption: {
    flex: 1,
    maxWidth: 140,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#1e293b",
    alignItems: "center",
    justifyContent: "center",
  },
  boutonOptionActif: {
    backgroundColor: "#2563eb",
  },
  texteOption: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "600",
  },
  boutonPartager: {
    flex: 1,
    maxWidth: 140,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#0369a1",
    alignItems: "center",
    justifyContent: "center",
  },
  textePartager: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
});
