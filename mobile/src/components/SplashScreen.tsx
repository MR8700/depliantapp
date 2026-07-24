import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

interface Props {
  message?: string;
}

// Reprend le splash de l'app web (index.html #splash / style.css .splash) :
// même dégradé bleu nuit, même titre/sous-titre, même respiration douce --
// approximé en React Native sans SVG (pas de dépendance native
// supplémentaire, voir mémoire sur les frictions Expo Go / SDK).
export default function SplashScreen({ message = "Chargement…" }: Props) {
  const respiration = useRef(new Animated.Value(0)).current;
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const boucleRespiration = Animated.loop(
      Animated.sequence([
        Animated.timing(respiration, { toValue: 1, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(respiration, { toValue: 0, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    const boucleRotation = Animated.loop(
      Animated.timing(rotation, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }),
    );
    boucleRespiration.start();
    boucleRotation.start();
    return () => { boucleRespiration.stop(); boucleRotation.stop(); };
  }, [respiration, rotation]);

  const echelle = respiration.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <View style={styles.fond}>
      <Animated.View style={[styles.symbole, { transform: [{ scale: echelle }] }]}>
        <Animated.View style={[styles.anneau, { transform: [{ rotate }] }]} />
        <Text style={styles.emoji}>🕊️</Text>
      </Animated.View>
      <Text style={styles.titre}>DepliantApp</Text>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fond: { flex: 1, backgroundColor: "#1a3c6e", alignItems: "center", justifyContent: "center", gap: 14 },
  symbole: { width: 110, height: 110, alignItems: "center", justifyContent: "center" },
  anneau: {
    position: "absolute", width: 110, height: 110, borderRadius: 55,
    borderWidth: 3, borderColor: "rgba(255,255,255,0.35)", borderTopColor: "#ffffff",
  },
  emoji: { fontSize: 42 },
  titre: { fontSize: 22, fontWeight: "800", color: "#fff", letterSpacing: 0.5 },
  message: { fontSize: 13, color: "#fff", opacity: 0.85 },
});
