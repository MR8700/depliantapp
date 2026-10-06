import { useEffect, useRef } from "react";
import { Animated, StyleSheet, ViewStyle } from "react-native";

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
}

// Légère entrée animée (fondu + glissement) au montage -- rendu moins figé
// qu'un simple View, sans système d'animation complet (Animated natif
// uniquement, aucune dépendance de plus).
export default function Carte({ children, style }: Props) {
  const opacite = useRef(new Animated.Value(0)).current;
  const translation = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacite, { toValue: 1, duration: 320, useNativeDriver: true }),
      Animated.spring(translation, { toValue: 0, useNativeDriver: true, friction: 8 }),
    ]).start();
  }, [opacite, translation]);

  return (
    <Animated.View style={[styles.carte, style, { opacity: opacite, transform: [{ translateY: translation }] }]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  carte: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
});
