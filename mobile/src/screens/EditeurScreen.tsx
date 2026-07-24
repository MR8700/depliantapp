import { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { rechercherChants, bulkCategoriser, bulkSupprimer } from "../api/chants";
import { demanderSuppression } from "../api/moderation";
import { getMeta } from "../api/meta";
import { useIdentite } from "../context/IdentiteContext";
import { Chant } from "../types";
import { niveauConfiance, LABEL_CONFIANCE, COULEUR_CONFIANCE } from "../utils/confiance";
import { LANGUES_OPTIONS } from "../utils/labels";
import SongDetailModal from "../components/SongDetailModal";
import SelectModal from "../components/SelectModal";
import Bouton from "../components/Bouton";

type FiltreStat = "importes" | "a-verifier" | "echecs" | "tous";
type Tri = "recent" | "creation" | "titre" | "confiance";

export default function EditeurScreen() {
  const navigation = useNavigation<any>();
  const { estSuperAdmin } = useIdentite();
  const [chants, setChants] = useState<Chant[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [recherche, setRecherche] = useState("");
  const [filtreStat, setFiltreStat] = useState<FiltreStat>("tous");
  const [filtreCategorie, setFiltreCategorie] = useState("");
  const [filtreLangue, setFiltreLangue] = useState("");
  const [tri, setTri] = useState<Tri>("recent");
  const [drawerOuvert, setDrawerOuvert] = useState(false);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [chantOuvert, setChantOuvert] = useState<Chant | null>(null);
  const [modeCreation, setModeCreation] = useState(false);

  useEffect(() => {
    getMeta().then((m) => setCategories(m.categories)).catch(() => {});
    rechercherChants({ limit: 500 }).then(setChants).catch(() => {});
  }, []);

  const stats = useMemo(() => {
    const c = { importe: 0, a_verifier: 0, echec: 0 };
    for (const chant of chants) c[niveauConfiance(chant.confiance)]++;
    return c;
  }, [chants]);

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    let liste = chants.filter((c) => {
      if (filtreStat === "importes" && niveauConfiance(c.confiance) !== "importe") return false;
      if (filtreStat === "a-verifier" && niveauConfiance(c.confiance) !== "a_verifier") return false;
      if (filtreStat === "echecs" && niveauConfiance(c.confiance) !== "echec") return false;
      if (filtreCategorie && c.categorie !== filtreCategorie) return false;
      if (filtreLangue && c.langue !== filtreLangue) return false;
      if (q && !c.titre.toLowerCase().includes(q)) return false;
      return true;
    });
    liste = [...liste].sort((a, b) => {
      if (tri === "titre") return a.titre.localeCompare(b.titre);
      if (tri === "confiance") return b.confiance - a.confiance;
      return 0; // recent/creation : created_at non exposé par l'API, comparaison neutre
    });
    return liste;
  }, [chants, recherche, filtreStat, filtreCategorie, filtreLangue, tri]);

  function toggleSelection(id: number) {
    setSelection((prev) => {
      const copie = new Set(prev);
      if (copie.has(id)) copie.delete(id); else copie.add(id);
      return copie;
    });
  }

  async function categoriserSelection(categorie: string) {
    try {
      await bulkCategoriser(Array.from(selection), categorie);
      setChants((prev) => prev.map((c) => (selection.has(c.id) ? { ...c, categorie } : c)));
      setSelection(new Set());
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Échec de l'opération groupée");
    }
  }

  function supprimerSelection() {
    const ids = Array.from(selection);
    if (ids.length === 0) return;
    if (estSuperAdmin) {
      Alert.alert("Supprimer ces chants ?", `${ids.length} chant(s) seront supprimés définitivement.`, [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer", style: "destructive", onPress: async () => {
            try {
              await bulkSupprimer(ids);
              setChants((prev) => prev.filter((c) => !selection.has(c.id)));
              setSelection(new Set());
            } catch (erreur: any) { Alert.alert("Erreur", erreur?.message ?? "Échec de la suppression"); }
          },
        },
      ]);
    } else {
      Alert.alert("Demander la suppression", `Envoyer une demande de suppression pour ${ids.length} chant(s) ?`, [
        { text: "Annuler", style: "cancel" },
        {
          text: "Envoyer", onPress: async () => {
            await Promise.all(ids.map((id) => demanderSuppression("chant", id, "Suppression groupée demandée depuis l'éditeur").catch(() => {})));
            setSelection(new Set());
            Alert.alert("Demandes envoyées");
          },
        },
      ]);
    }
  }

  return (
    <View style={styles.conteneur}>
      <View style={styles.entete}>
        <Text style={styles.titre}>Éditeur de chants</Text>
        <Text style={styles.sousTitre}>Gérez les chants de votre bibliothèque et les résultats des imports automatiques.</Text>
        <View style={styles.rangeeBoutonsEntete}>
          <Pressable style={styles.boutonSecondaire} onPress={() => navigation.navigate("Import")}>
            <Text style={styles.texteBoutonSecondaire}>📤 Importer des chants</Text>
          </Pressable>
          <Pressable style={styles.boutonPrimaire} onPress={() => setModeCreation(true)}>
            <Text style={styles.texteBoutonPrimaire}>+ Ajouter un chant</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.cartes}>
        <Pressable style={[styles.carteStat, filtreStat === "tous" && styles.carteStatActive]} onPress={() => setFiltreStat("tous")}>
          <Text style={styles.nombreStat}>{chants.length}</Text>
          <Text style={styles.labelStat}>Total chants</Text>
        </Pressable>
        <Pressable style={[styles.carteStat, filtreStat === "importes" && { borderColor: COULEUR_CONFIANCE.importe, borderWidth: 2 }]} onPress={() => setFiltreStat(filtreStat === "importes" ? "tous" : "importes")}>
          <Text style={[styles.nombreStat, { color: COULEUR_CONFIANCE.importe }]}>{stats.importe}</Text>
          <Text style={styles.labelStat}>Importés</Text>
        </Pressable>
        <Pressable style={[styles.carteStat, filtreStat === "a-verifier" && { borderColor: COULEUR_CONFIANCE.a_verifier, borderWidth: 2 }]} onPress={() => setFiltreStat(filtreStat === "a-verifier" ? "tous" : "a-verifier")}>
          <Text style={[styles.nombreStat, { color: COULEUR_CONFIANCE.a_verifier }]}>{stats.a_verifier}</Text>
          <Text style={styles.labelStat}>À vérifier</Text>
        </Pressable>
        <Pressable style={[styles.carteStat, filtreStat === "echecs" && { borderColor: COULEUR_CONFIANCE.echec, borderWidth: 2 }]} onPress={() => setFiltreStat(filtreStat === "echecs" ? "tous" : "echecs")}>
          <Text style={[styles.nombreStat, { color: COULEUR_CONFIANCE.echec }]}>{stats.echec}</Text>
          <Text style={styles.labelStat}>Échecs</Text>
        </Pressable>
      </View>

      <View style={styles.rangeeToolbar}>
        <TextInput style={styles.recherche} placeholder="Rechercher par titre, paroles, auteur, catégorie..." value={recherche} onChangeText={setRecherche} />
        <Pressable style={styles.boutonFiltres} onPress={() => setDrawerOuvert(true)}><Text style={styles.texteBoutonFiltres}>⚙️ Filtres avancés</Text></Pressable>
      </View>

      <FlatList
        data={filtres}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: selection.size > 0 ? 80 : 16 }}
        renderItem={({ item }) => {
          const coche = selection.has(item.id);
          return (
            <Pressable style={[styles.ligne, coche && styles.ligneSelectionnee]} onPress={() => setChantOuvert(item)} onLongPress={() => toggleSelection(item.id)}>
              <Pressable onPress={() => toggleSelection(item.id)} hitSlop={10} style={styles.checkbox}>
                <Text>{coche ? "☑" : "☐"}</Text>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.titreLigne}>{item.titre}</Text>
                <Text style={styles.sousLigne}>{item.categorie} · {item.langue} · confiance {(item.confiance * 100).toFixed(0)}%</Text>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text style={styles.vide}>Aucun chant.</Text>}
      />

      {selection.size > 0 && (
        <View style={styles.barreActions}>
          <Text style={styles.texteSelection}>{selection.size} sélectionné(s)</Text>
          <Pressable onPress={() => categoriserSelection(categories[0] ?? "Autre")}>
            <Text style={styles.lienBarre}>Déplacer</Text>
          </Pressable>
          <Pressable onPress={supprimerSelection}>
            <Text style={[styles.lienBarre, { color: "#fecaca" }]}>Supprimer</Text>
          </Pressable>
        </View>
      )}

      <Modal visible={drawerOuvert} animationType="slide" transparent onRequestClose={() => setDrawerOuvert(false)}>
        <Pressable style={styles.fondDrawer} onPress={() => setDrawerOuvert(false)}>
          <Pressable style={styles.drawer} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.titreDrawer}>⚙️ Filtres avancés</Text>
            <Text style={styles.labelFiltre}>Catégorie liturgique</Text>
            <SelectModal label="Catégorie" value={filtreCategorie} options={[{ value: "", label: "Toutes" }, ...categories.map((c) => ({ value: c, label: c }))]} onChange={setFiltreCategorie} />
            <Text style={styles.labelFiltre}>Langue</Text>
            <SelectModal label="Langue" value={filtreLangue} options={LANGUES_OPTIONS} onChange={setFiltreLangue} />
            <Text style={styles.labelFiltre}>Trier par</Text>
            <SelectModal
              label="Trier par" value={tri}
              options={[
                { value: "recent", label: "Date de modification" }, { value: "creation", label: "Date de création" },
                { value: "titre", label: "Titre (A-Z)" }, { value: "confiance", label: "Score de confiance" },
              ]}
              onChange={(v) => setTri(v as Tri)}
            />
            <View style={{ marginTop: 20 }}><Bouton titre="Fermer" onPress={() => setDrawerOuvert(false)} /></View>
          </Pressable>
        </Pressable>
      </Modal>

      <SongDetailModal
        visible={!!chantOuvert || modeCreation}
        chant={chantOuvert}
        meta={null}
        estSuperAdmin={estSuperAdmin}
        onClose={() => { setChantOuvert(null); setModeCreation(false); }}
        onChange={(maj) => { setChants((prev) => prev.map((c) => (c.id === maj.id ? maj : c))); setChantOuvert(maj); }}
        onCreated={(cree) => { setChants((prev) => [cree, ...prev]); setModeCreation(false); }}
        onDelete={(id) => { setChants((prev) => prev.filter((c) => c.id !== id)); setChantOuvert(null); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  conteneur: { flex: 1, backgroundColor: "#eef2f9" },
  entete: { padding: 16, paddingBottom: 0 },
  titre: { fontSize: 19, fontWeight: "800", color: "#1e293b" },
  sousTitre: { fontSize: 12, color: "#64748b", marginTop: 2, marginBottom: 10 },
  rangeeBoutonsEntete: { flexDirection: "row", gap: 8 },
  boutonSecondaire: { backgroundColor: "#fff", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  texteBoutonSecondaire: { fontSize: 12, color: "#334155", fontWeight: "600" },
  boutonPrimaire: { backgroundColor: "#2563eb", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  texteBoutonPrimaire: { fontSize: 12, color: "#fff", fontWeight: "700" },
  cartes: { flexDirection: "row", gap: 8, padding: 16, paddingBottom: 0 },
  carteStat: { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 10, alignItems: "center", borderWidth: 1, borderColor: "transparent" },
  carteStatActive: { borderColor: "#2563eb", borderWidth: 2 },
  nombreStat: { fontSize: 18, fontWeight: "800", color: "#1e293b" },
  labelStat: { fontSize: 10, color: "#64748b", marginTop: 2, textAlign: "center" },
  rangeeToolbar: { flexDirection: "row", gap: 8, padding: 16, alignItems: "center" },
  recherche: { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#dbe2ea", fontSize: 13 },
  boutonFiltres: { backgroundColor: "#fff", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12 },
  texteBoutonFiltres: { fontSize: 12, color: "#334155", fontWeight: "600" },
  ligne: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 10, padding: 12, marginBottom: 6 },
  ligneSelectionnee: { backgroundColor: "#dbeafe" },
  checkbox: { marginRight: 10 },
  titreLigne: { fontSize: 14, fontWeight: "600", color: "#1e293b" },
  sousLigne: { fontSize: 12, color: "#94a3b8" },
  vide: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
  barreActions: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#1e293b", flexDirection: "row", alignItems: "center", padding: 14, gap: 16 },
  texteSelection: { color: "#fff", flex: 1, fontSize: 12 },
  lienBarre: { color: "#93c5fd", fontWeight: "600" },
  fondDrawer: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)", justifyContent: "flex-end" },
  drawer: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "80%" },
  titreDrawer: { fontSize: 16, fontWeight: "700", marginBottom: 14, color: "#1e293b" },
  labelFiltre: { fontSize: 11, color: "#94a3b8", fontWeight: "600", marginTop: 10, marginBottom: 4 },
});
