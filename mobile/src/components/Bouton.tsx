import { useRef } from "react";
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text } from "react-native";

interface Props {
  titre: string;
  onPress: () => void;
  enCours?: boolean;
  desactive?: boolean;
  variante?: "plein" | "contour";
}

// Effet d'enfoncement (scale) au toucher -- retour tactile plus vivant
// qu'une simple opacité, sans dépendance externe (Animated natif).
export default function Bouton({ titre, onPress, enCours, desactive, variante = "plein" }: Props) {
  const echelle = useRef(new Animated.Value(1)).current;
  const inactif = !!enCours || !!desactive;

  function presser(actif: boolean) {
    Animated.spring(echelle, { toValue: actif ? 0.96 : 1, useNativeDriver: true, friction: 6 }).start();
  }

  return (
    <Pressable onPress={onPress} disabled={inactif} onPressIn={() => presser(true)} onPressOut={() => presser(false)}>
      <Animated.View
        style={[
          styles.bouton,
          variante === "contour" ? styles.contour : styles.plein,
          inactif && styles.desactive,
          { transform: [{ scale: echelle }] },
        ]}
      >
        {enCours ? (
          <ActivityIndicator color={variante === "contour" ? "#2563eb" : "#fff"} />
        ) : (
          <Text style={[styles.texte, variante === "contour" && styles.texteContour]}>{titre}</Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bouton: { borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  plein: { backgroundColor: "#2563eb" },
  contour: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: "#2563eb" },
  desactive: { opacity: 0.5 },
  texte: { color: "#fff", fontSize: 16, fontWeight: "600" },
  texteContour: { color: "#2563eb" },
});
