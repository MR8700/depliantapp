import { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";

interface Option {
  value: string;
  label: string;
}

interface Props {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  style?: object;
}

// Équivalent mobile d'un <select> HTML -- React Native n'a pas de picker
// natif standard, ce champ ouvre une liste modale (même contenu/valeurs que
// le <select> web, juste un widget différent pour un usage tactile).
export default function SelectModal({ label, value, options, onChange, style }: Props) {
  const [ouvert, setOuvert] = useState(false);
  const selection = options.find((o) => o.value === value);

  return (
    <>
      <Pressable style={[styles.champ, style]} onPress={() => setOuvert(true)}>
        <Text style={styles.texteChamp} numberOfLines={1}>{selection?.label ?? label}</Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>
      <Modal visible={ouvert} transparent animationType="fade" onRequestClose={() => setOuvert(false)}>
        <Pressable style={styles.fond} onPress={() => setOuvert(false)}>
          <View style={styles.feuille}>
            <Text style={styles.titre}>{label}</Text>
            <FlatList
              data={options}
              keyExtractor={(o) => o.value}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.option, item.value === value && styles.optionActive]}
                  onPress={() => { onChange(item.value); setOuvert(false); }}
                >
                  <Text style={[styles.texteOption, item.value === value && styles.texteOptionActive]}>{item.label}</Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  champ: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: "#fff",
  },
  texteChamp: { fontSize: 13, color: "#334155", flexShrink: 1 },
  chevron: { color: "#94a3b8", marginLeft: 6 },
  fond: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)", justifyContent: "center", padding: 32 },
  feuille: { backgroundColor: "#fff", borderRadius: 16, maxHeight: "70%", padding: 12 },
  titre: { fontSize: 13, fontWeight: "700", color: "#64748b", padding: 10 },
  option: { padding: 14, borderRadius: 8 },
  optionActive: { backgroundColor: "#eef2f9" },
  texteOption: { fontSize: 15, color: "#334155" },
  texteOptionActive: { color: "#2563eb", fontWeight: "700" },
});
