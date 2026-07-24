import { useEffect, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { rechercherChants } from "../api/chants";
import { Chant } from "../types";
import { categorieLabel, iconeCategorie } from "../utils/labels";

interface Props {
  visible: boolean;
  onFermer: () => void;
  onSelection: (chant: Chant) => void;
}

export default function SelecteurChant({ visible, onFermer, onSelection }: Props) {
  const [recherche, setRecherche] = useState("");
  const [resultats, setResultats] = useState<Chant[]>([]);
  const [chargement, setChargement] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setChargement(true);
    const t = setTimeout(() => {
      rechercherChants({ q: recherche || undefined, limit: 50, resume: true })
        .then(setResultats)
        .catch(() => setResultats([]))
        .finally(() => setChargement(false));
    }, 250);
    return () => clearTimeout(t);
  }, [recherche, visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onFermer}>
      <View style={styles.conteneur}>
        <Text style={styles.titrePicker}>Choisir un chant</Text>
        <View style={styles.rechercheWrapper}>
          <Text style={styles.iconeRecherche}>🔍</Text>
          <TextInput
            style={styles.recherche}
            placeholder="Rechercher un chant..."
            value={recherche}
            onChangeText={setRecherche}
            autoFocus
          />
        </View>
        <FlatList
          data={resultats}
          keyExtractor={(c) => String(c.id)}
          contentContainerStyle={{ padding: 16, paddingTop: 4 }}
          renderItem={({ item }) => {
            const apercu = (item.refrain || item.couplets[0] || "").slice(0, 90);
            return (
              <Pressable style={styles.carte} onPress={() => onSelection(item)}>
                <View style={styles.iconeCercle}>
                  <Text style={styles.iconeTexte}>{iconeCategorie(item.categorie)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.ligneTitre}>
                    <Text style={styles.pillCategorie}>{categorieLabel(item.categorie)}</Text>
                    {!!item.code_reference && <Text style={styles.pillReference}>{item.code_reference}</Text>}
                  </View>
                  <Text style={styles.titre} numberOfLines={1}>{item.titre}</Text>
                  {!!apercu && <Text style={styles.apercu} numberOfLines={2}>{apercu}</Text>}
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.vide}>{chargement ? "Recherche..." : "Aucun résultat"}</Text>
          }
        />
        <Pressable style={styles.annuler} onPress={onFermer}>
          <Text style={styles.texteAnnuler}>Annuler</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  conteneur: { flex: 1, backgroundColor: "#eef2f9", paddingTop: 50 },
  titrePicker: { fontSize: 16, fontWeight: "800", color: "#1e293b", textAlign: "center", marginBottom: 10 },
  rechercheWrapper: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 12, padding: 12, marginHorizontal: 16, borderWidth: 1, borderColor: "#dbe2ea" },
  iconeRecherche: { fontSize: 14 },
  recherche: { flex: 1, fontSize: 15 },
  carte: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 8 },
  iconeCercle: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#eef2f9", alignItems: "center", justifyContent: "center" },
  iconeTexte: { fontSize: 18 },
  ligneTitre: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  pillCategorie: { fontSize: 10, fontWeight: "700", color: "#2563eb", backgroundColor: "#dbeafe", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, textTransform: "uppercase" },
  pillReference: { fontSize: 10, fontWeight: "600", color: "#64748b" },
  titre: { fontSize: 15, fontWeight: "700", color: "#1e293b" },
  apercu: { fontSize: 12, color: "#94a3b8", fontStyle: "italic", marginTop: 2, lineHeight: 16 },
  chevron: { fontSize: 20, color: "#cbd5e1" },
  vide: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
  annuler: { padding: 16, alignItems: "center", borderTopWidth: 1, borderTopColor: "#e2e8f0", backgroundColor: "#fff" },
  texteAnnuler: { color: "#dc2626", fontWeight: "600" },
});
