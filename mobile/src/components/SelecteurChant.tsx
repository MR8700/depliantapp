import { useEffect, useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { rechercherChants } from "../api/chants";
import { getMeta } from "../api/meta";
import { Chant } from "../types";
import { categorieLabel, iconeCategorie } from "../utils/labels";
import SelectModal from "./SelectModal";

interface Props {
  visible: boolean;
  onFermer: () => void;
  onSelection: (chant: Chant) => void;
}

export default function SelecteurChant({ visible, onFermer, onSelection }: Props) {
  const insets = useSafeAreaInsets();
  const [recherche, setRecherche] = useState("");
  const [categorie, setCategorie] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [resultats, setResultats] = useState<Chant[]>([]);
  const [chargement, setChargement] = useState(false);
  const [apercu, setApercu] = useState<Chant | null>(null);

  useEffect(() => {
    if (!visible) return;
    getMeta().then((m) => setCategories(m.categories)).catch(() => {});
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    setChargement(true);
    const t = setTimeout(() => {
      rechercherChants({ q: recherche || undefined, categorie: categorie || undefined, limit: 50, resume: true })
        .then(setResultats)
        .catch(() => setResultats([]))
        .finally(() => setChargement(false));
    }, 250);
    return () => clearTimeout(t);
  }, [recherche, categorie, visible]);

  useEffect(() => {
    if (!visible) { setApercu(null); setRecherche(""); setCategorie(""); }
  }, [visible]);

  const optionsCategorie = [{ value: "", label: "Toutes catégories" }, ...categories.map((c) => ({ value: c, label: categorieLabel(c) }))];

  function ajouter(chant: Chant) {
    setApercu(null);
    onSelection(chant);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => (apercu ? setApercu(null) : onFermer())}>
      <View style={styles.conteneur}>
        {apercu ? (
          // Aperçu du chant avant ajout -- le tap sur une carte de la liste
          // ouvre cette vue au lieu d'ajouter directement, comme le clic sur
          // une carte du picker web ouvre chant-detail-modal (ouvrirDetailChant).
          <View style={{ flex: 1 }}>
            <View style={styles.entetePicker}>
              <Pressable onPress={() => setApercu(null)} hitSlop={10}><Text style={styles.retour}>‹ Retour</Text></Pressable>
              <Text style={styles.titrePicker} numberOfLines={1}>{apercu.titre}</Text>
              <View style={{ width: 50 }} />
            </View>
            <ScrollView contentContainerStyle={styles.contenuApercu}>
              <View style={styles.ligneTitreApercu}>
                <Text style={styles.pillCategorie}>{categorieLabel(apercu.categorie)}</Text>
                {!!apercu.code_reference && <Text style={styles.pillReference}>{apercu.code_reference}</Text>}
              </View>
              <Text style={styles.titreApercu}>{apercu.titre}</Text>
              {!!apercu.refrain && (
                <>
                  <Text style={styles.labelApercu}>Refrain</Text>
                  <Text style={styles.texteApercu}>{apercu.refrain}</Text>
                </>
              )}
              {apercu.couplets.map((c, i) => (
                <View key={i}>
                  <Text style={styles.labelApercu}>Couplet {i + 1}</Text>
                  <Text style={styles.texteApercu}>{c}</Text>
                </View>
              ))}
            </ScrollView>
            <View style={[styles.piedApercu, { paddingBottom: insets.bottom + 12 }]}>
              <Pressable style={styles.boutonAjouter} onPress={() => ajouter(apercu)}>
                <Text style={styles.texteBoutonAjouter}>✓ Ajouter ce chant</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
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
            <SelectModal label="Toutes catégories" value={categorie} options={optionsCategorie} onChange={setCategorie} style={styles.selectCategorie} />
            <FlatList
              data={resultats}
              keyExtractor={(c) => String(c.id)}
              contentContainerStyle={{ padding: 16, paddingTop: 8 }}
              renderItem={({ item }) => {
                const apercuTexte = (item.refrain || item.couplets[0] || "").slice(0, 90);
                return (
                  <Pressable style={styles.carte} onPress={() => setApercu(item)}>
                    <View style={styles.iconeCercle}>
                      <Text style={styles.iconeTexte}>{iconeCategorie(item.categorie)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.ligneTitre}>
                        <Text style={styles.pillCategorie}>{categorieLabel(item.categorie)}</Text>
                        {!!item.code_reference && <Text style={styles.pillReference}>{item.code_reference}</Text>}
                      </View>
                      <Text style={styles.titre} numberOfLines={1}>{item.titre}</Text>
                      {!!apercuTexte && <Text style={styles.apercu} numberOfLines={2}>{apercuTexte}</Text>}
                    </View>
                    <Pressable style={styles.boutonAjoutRapide} hitSlop={8} onPress={() => ajouter(item)}>
                      <Text style={styles.texteBoutonAjoutRapide}>➕</Text>
                    </Pressable>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.vide}>
                  {chargement ? "Recherche..." : categorie ? `Aucun chant dans « ${categorieLabel(categorie)} »` : "Aucun résultat"}
                </Text>
              }
            />
            <Pressable style={[styles.annuler, { paddingBottom: insets.bottom + 16 }]} onPress={onFermer}>
              <Text style={styles.texteAnnuler}>Annuler</Text>
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  conteneur: { flex: 1, backgroundColor: "#eef2f9", paddingTop: 50 },
  titrePicker: { fontSize: 16, fontWeight: "800", color: "#1e293b", textAlign: "center", marginBottom: 10 },
  entetePicker: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 4 },
  retour: { color: "#2563eb", fontWeight: "600", fontSize: 14, width: 60 },
  rechercheWrapper: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 12, padding: 12, marginHorizontal: 16, borderWidth: 1, borderColor: "#dbe2ea" },
  iconeRecherche: { fontSize: 14 },
  recherche: { flex: 1, fontSize: 15 },
  selectCategorie: { marginHorizontal: 16, marginTop: 8 },
  carte: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 8 },
  iconeCercle: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#eef2f9", alignItems: "center", justifyContent: "center" },
  iconeTexte: { fontSize: 18 },
  ligneTitre: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  pillCategorie: { fontSize: 10, fontWeight: "700", color: "#2563eb", backgroundColor: "#dbeafe", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, textTransform: "uppercase" },
  pillReference: { fontSize: 10, fontWeight: "600", color: "#64748b" },
  titre: { fontSize: 15, fontWeight: "700", color: "#1e293b" },
  apercu: { fontSize: 12, color: "#94a3b8", fontStyle: "italic", marginTop: 2, lineHeight: 16 },
  boutonAjoutRapide: { padding: 8, backgroundColor: "#eef2f9", borderRadius: 999 },
  texteBoutonAjoutRapide: { fontSize: 15 },
  vide: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
  annuler: { padding: 16, alignItems: "center", borderTopWidth: 1, borderTopColor: "#e2e8f0", backgroundColor: "#fff" },
  texteAnnuler: { color: "#dc2626", fontWeight: "600" },
  contenuApercu: { padding: 24 },
  ligneTitreApercu: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  titreApercu: { fontSize: 20, fontWeight: "700", color: "#1e293b", marginBottom: 12 },
  labelApercu: { fontSize: 12, fontWeight: "600", color: "#94a3b8", marginTop: 14, marginBottom: 4, textTransform: "uppercase" },
  texteApercu: { fontSize: 15, color: "#334155", lineHeight: 22 },
  piedApercu: { padding: 16, borderTopWidth: 1, borderTopColor: "#e2e8f0", backgroundColor: "#fff" },
  boutonAjouter: { backgroundColor: "#2563eb", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  texteBoutonAjouter: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
