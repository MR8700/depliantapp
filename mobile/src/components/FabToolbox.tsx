import { useRef, useState } from "react";
import { ActivityIndicator, Dimensions, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export interface FabAction {
  key: string;
  icone: string;
  libelle: string;
  onPress: () => void;
  enCours?: boolean;
  desactive?: boolean;
  primaire?: boolean;
}

interface Props {
  actions: FabAction[];
}

const TAILLE_BOULE = 58;
const MARGE = 14;
const SEUIL_GLISSEMENT = 4;

function borner(valeur: number, min: number, max: number): number {
  return Math.min(Math.max(valeur, min), max);
}

// Reproduit le "floating-toolbox" du web (index.html) : une boule centrale
// déplaçable (glisser = repositionner, taper sans bouger = ouvrir/fermer)
// entourée de ses actions, chacune étiquetée en clair -- contrairement au
// web, le mobile n'a pas de survol pour afficher un tooltip, donc le libellé
// reste visible en permanence à côté de l'icône.
export default function FabToolbox({ actions }: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = Dimensions.get("window");
  const posInitiale = {
    x: width - TAILLE_BOULE - MARGE,
    y: height - TAILLE_BOULE - MARGE - insets.bottom - 90,
  };
  const [pos, setPos] = useState(posInitiale);
  const [ouvert, setOuvert] = useState(false);
  const posRef = useRef(posInitiale);
  const posDepart = useRef(posInitiale);
  const aGlisse = useRef(false);

  function definirPosition(p: { x: number; y: number }) {
    posRef.current = p;
    setPos(p);
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_evt, geste) =>
        Math.abs(geste.dx) > SEUIL_GLISSEMENT || Math.abs(geste.dy) > SEUIL_GLISSEMENT,
      onPanResponderGrant: () => {
        aGlisse.current = false;
        posDepart.current = posRef.current;
      },
      onPanResponderMove: (_evt, geste) => {
        if (Math.abs(geste.dx) > SEUIL_GLISSEMENT || Math.abs(geste.dy) > SEUIL_GLISSEMENT) aGlisse.current = true;
        definirPosition({
          x: borner(posDepart.current.x + geste.dx, MARGE, width - TAILLE_BOULE - MARGE),
          y: borner(posDepart.current.y + geste.dy, insets.top + MARGE, height - TAILLE_BOULE - MARGE - insets.bottom),
        });
      },
      onPanResponderRelease: () => {
        if (!aGlisse.current) setOuvert((v) => !v);
      },
    }),
  ).current;

  return (
    <>
      {ouvert && <Pressable style={StyleSheet.absoluteFill} onPress={() => setOuvert(false)} />}

      {ouvert && (
        <View
          pointerEvents="box-none"
          style={[
            styles.colonneActions,
            { right: width - pos.x - TAILLE_BOULE, bottom: height - pos.y + 12 },
          ]}
        >
          {actions.map((a) => (
            <Pressable
              key={a.key}
              style={[styles.action, a.primaire && styles.actionPrimaire, a.desactive && styles.actionDesactivee]}
              disabled={a.desactive}
              onPress={() => {
                setOuvert(false);
                a.onPress();
              }}
            >
              {a.enCours ? (
                <ActivityIndicator size="small" color={a.primaire ? "#fff" : "#1f4a7c"} />
              ) : (
                <Text style={styles.actionIcone}>{a.icone}</Text>
              )}
              <Text style={[styles.actionLibelle, a.primaire && styles.actionLibellePrimaire]}>{a.libelle}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View {...panResponder.panHandlers} style={[styles.boule, { left: pos.x, top: pos.y }]}>
        <Text style={styles.bouleIcone}>{ouvert ? "✕" : "🛠️"}</Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  boule: {
    position: "absolute",
    width: TAILLE_BOULE,
    height: TAILLE_BOULE,
    borderRadius: TAILLE_BOULE / 2,
    backgroundColor: "#1f4a7c",
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    zIndex: 20,
  },
  bouleIcone: { fontSize: 22 },
  colonneActions: { position: "absolute", alignItems: "flex-end", gap: 10, zIndex: 15 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff",
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    minWidth: 130,
  },
  actionPrimaire: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  actionDesactivee: { opacity: 0.5 },
  actionIcone: { fontSize: 17 },
  actionLibelle: { fontSize: 13, fontWeight: "700", color: "#1e293b" },
  actionLibellePrimaire: { color: "#fff" },
});
