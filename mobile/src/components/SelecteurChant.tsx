import { useEffect, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { rechercherChants } from "../api/chants";
import { Chant } from "../types";

interface Props {
  visible: boolean;
  onFermer: () => void;
  onSelection: (chant: Chant) => void;
}

export default function SelecteurChant({ visible, onFermer, onSelection }: Props) {
  const [recherche, setRecherche] = useState("");
  const [resultats, setResultats] = useState<Chant[]>([]);

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      rechercherChants({ q: recherche || undefined, limit: 50 }).then(setResultats).catch(() => setResultats([]));
    }, 250);
    return () => clearTimeout(t);
  }, [recherche, visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onFermer}>
      <View style={styles.conteneur}>
        <TextInput
          style={styles.recherche}
          placeholder="Rechercher un chant..."
          value={recherche}
          onChangeText={setRecherche}
          autoFocus
        />
        <FlatList
          data={resultats}
          keyExtractor={(c) => String(c.id)}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <Pressable style={styles.ligne} onPress={() => onSelection(item)}>
              <Text style={styles.titre}>{item.titre}</Text>
              <Text style={styles.sousTitre}>{item.categorie}</Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.vide}>Aucun résultat</Text>}
        />
        <Pressable style={styles.annuler} onPress={onFermer}>
          <Text style={styles.texteAnnuler}>Annuler</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  conteneur: { flex: 1, backgroundColor: "#fff", paddingTop: 50 },
  recherche: { margin: 16, borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 12, padding: 12, fontSize: 15 },
  ligne: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  titre: { fontSize: 15, fontWeight: "600", color: "#1e293b" },
  sousTitre: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  vide: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
  annuler: { padding: 16, alignItems: "center", borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  texteAnnuler: { color: "#dc2626", fontWeight: "600" },
});
