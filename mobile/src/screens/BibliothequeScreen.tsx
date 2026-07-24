import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { rechercherChants, basculerFavori, dupliquerChant, proposerValidationChant, validerChant, retirerValidationChant } from "../api/chants";
import { getMeta } from "../api/meta";
import { fusionnerDansCache, lireCache } from "../storage/chantsCache";
import { useIdentite } from "../context/IdentiteContext";
import { Chant, Meta } from "../types";
import ChantCard from "../components/ChantCard";
import SongDetailModal from "../components/SongDetailModal";
import SelectModal from "../components/SelectModal";
import { LANGUES_OPTIONS } from "../utils/labels";

const DELAI_DEBOUNCE_MS = 300;
const CLE_VUE_MODE = "depliantapp.bibliotheque_vue_mode";
const CLE_PAGE_SIZE = "depliantapp.bibliotheque_page_size";

type TriCle = "titre" | "code" | "creation" | "confiance";
type VueMode = "list" | "grid";

const OPTIONS_TRI: { value: TriCle; label: string }[] = [
  { value: "titre", label: "Ordre alphabétique" },
  { value: "code", label: "Référence" },
  { value: "creation", label: "Date de création" },
  { value: "confiance", label: "Popularité" },
];

const OPTIONS_ETAT = [
  { value: "", label: "Tous les états" },
  { value: "actif", label: "Actif" },
  { value: "a-verifier", label: "À vérifier" },
  { value: "archive", label: "Archivé" },
];

export default function BibliothequeScreen() {
  const navigation = useNavigation<any>();
  const { estSuperAdmin } = useIdentite();

  const [recherche, setRecherche] = useState("");
  const [rechercheDebattue, setRechercheDebattue] = useState("");
  const [categorieFiltre, setCategorieFiltre] = useState("");
  const [occasionFiltre, setOccasionFiltre] = useState("");
  const [occasionDebattue, setOccasionDebattue] = useState("");
  const [langueFiltre, setLangueFiltre] = useState("");
  const [etatFiltre, setEtatFiltre] = useState("");
  const [filtresAvancesOuverts, setFiltresAvancesOuverts] = useState(false);

  const [vueMode, setVueMode] = useState<VueMode>("list");
  const [tri, setTri] = useState<TriCle>("titre");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [pageIndex, setPageIndex] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [meta, setMeta] = useState<Meta | null>(null);
  const [chants, setChants] = useState<Chant[]>([]);
  const [chargement, setChargement] = useState(true);
  const [rafraichissement, setRafraichissement] = useState(false);
  const [chantSelectionne, setChantSelectionne] = useState<Chant | null>(null);
  const [modeEditionDirecte, setModeEditionDirecte] = useState(false);
  const [modeCreation, setModeCreation] = useState(false);
  const timerRecherche = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerOccasion = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(CLE_VUE_MODE).then((v) => { if (v === "grid" || v === "list") setVueMode(v); });
    AsyncStorage.getItem(CLE_PAGE_SIZE).then((v) => { if (v) setPageSize(Number(v)); });
    getMeta().then(setMeta).catch(() => {});
  }, []);

  useEffect(() => {
    if (timerRecherche.current) clearTimeout(timerRecherche.current);
    timerRecherche.current = setTimeout(() => setRechercheDebattue(recherche), DELAI_DEBOUNCE_MS);
    return () => { if (timerRecherche.current) clearTimeout(timerRecherche.current); };
  }, [recherche]);

  useEffect(() => {
    if (timerOccasion.current) clearTimeout(timerOccasion.current);
    timerOccasion.current = setTimeout(() => setOccasionDebattue(occasionFiltre), DELAI_DEBOUNCE_MS);
    return () => { if (timerOccasion.current) clearTimeout(timerOccasion.current); };
  }, [occasionFiltre]);

  // Seuls q/categorie/occasion partent au serveur -- langue/état filtrent
  // uniquement le cache local ensuite (identique à actualiserListeBibliotheque
  // / actualiserListeBibliothequeRendering côté web).
  const charger = useCallback(async (q: string, categorie: string, occasion: string) => {
    try {
      const resultats = await rechercherChants({ q: q || undefined, categorie: categorie || undefined, occasion: occasion || undefined });
      setChants(resultats);
      fusionnerDansCache(resultats);
    } catch {
      const local = await lireCache();
      const q_ = q.trim().toLowerCase();
      const filtres = local.filter((c) => {
        const matchQ = !q_ || c.titre.toLowerCase().includes(q_) || (c.refrain ?? "").toLowerCase().includes(q_);
        const matchCat = !categorie || c.categorie === categorie;
        return matchQ && matchCat;
      });
      setChants(filtres);
    }
  }, []);

  useEffect(() => {
    setChargement(true);
    setPageIndex(1);
    charger(rechercheDebattue, categorieFiltre, occasionDebattue).finally(() => setChargement(false));
  }, [rechercheDebattue, categorieFiltre, occasionDebattue, charger]);

  const onRafraichir = useCallback(async () => {
    setRafraichissement(true);
    await charger(rechercheDebattue, categorieFiltre, occasionDebattue);
    setRafraichissement(false);
  }, [rechercheDebattue, categorieFiltre, occasionDebattue, charger]);

  function changerVueMode(mode: VueMode) {
    setVueMode(mode);
    AsyncStorage.setItem(CLE_VUE_MODE, mode);
  }

  function changerPageSize(taille: number) {
    setPageSize(taille);
    AsyncStorage.setItem(CLE_PAGE_SIZE, String(taille));
    setPageIndex(1);
  }

  // Filtre client (langue/état) + tri + pagination -- même logique que
  // actualiserListeBibliothequeRendering().
  const filtres = chants.filter((c) => {
    if (langueFiltre && c.langue !== langueFiltre) return false;
    if (etatFiltre === "archive" && c.actif !== false) return false;
    if (etatFiltre === "a-verifier" && (c.actif === false || c.confiance >= 0.7)) return false;
    if (etatFiltre === "actif" && (c.actif === false || c.confiance < 0.7)) return false;
    return true;
  });

  const trie = [...filtres].sort((a, b) => {
    if (tri === "confiance") return (b.confiance - a.confiance) * direction;
    let valA = "", valB = "";
    // "creation" : le champ created_at n'est pas exposé par l'API /chants
    // (voir schemas.Chant) -- comparaison neutre, comme côté web (a.created_at
    // y est tout aussi absent, ce tri est un no-op assumé des deux côtés).
    if (tri === "titre") { valA = a.titre.toLowerCase(); valB = b.titre.toLowerCase(); }
    else if (tri === "code") { valA = (a.code_reference || "").toLowerCase(); valB = (b.code_reference || "").toLowerCase(); }
    if (valA < valB) return -1 * direction;
    if (valA > valB) return 1 * direction;
    return 0;
  });

  const totalPages = Math.max(1, Math.ceil(trie.length / pageSize));
  const pageEffective = Math.min(Math.max(1, pageIndex), totalPages);
  const page = trie.slice((pageEffective - 1) * pageSize, pageEffective * pageSize);

  function onToggleFavori(chant: Chant) {
    setChants((prev) => prev.map((c) => (c.id === chant.id ? { ...c, favori: !c.favori } : c)));
    basculerFavori(chant).catch(() => {
      setChants((prev) => prev.map((c) => (c.id === chant.id ? { ...c, favori: chant.favori } : c)));
    });
  }

  // Clic sur le badge "à vérifier"/"Actif" : la chorale propose seulement,
  // l'admin valide/annule directement (voir routers/chants.py).
  async function onChangerEtatChant(chant: Chant) {
    try {
      let misAJour: Chant;
      if (estSuperAdmin) {
        misAJour = chant.valide_manuellement ? await retirerValidationChant(chant.id) : await validerChant(chant.id);
      } else {
        misAJour = await proposerValidationChant(chant.id);
        Alert.alert("Proposition envoyée", "L'administrateur va confirmer.");
      }
      setChants((prev) => prev.map((c) => (c.id === chant.id ? misAJour : c)));
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible de mettre à jour l'état");
    }
  }

  async function onDupliquer(chant: Chant) {
    try {
      await dupliquerChant(chant);
      charger(rechercheDebattue, categorieFiltre, occasionDebattue);
    } catch {}
  }

  function ouvrirActionHeader(cle: string) {
    if (cle === "ajouter") { setModeCreation(true); return; }
    if (cle === "importer") { navigation.navigate("Plus", { screen: "Import" }); return; }
    if (cle === "admin") { navigation.navigate("Plus", { screen: "Administration" }); return; }
    if (cle === "stats") { navigation.navigate("Plus", { screen: "Statistiques" }); return; }
    if (cle === "composer") { navigation.navigate("Composer"); return; }
    if (cle === "depliants") { navigation.navigate("Depliants"); return; }
    if (cle === "reglages") { navigation.navigate("Plus", { screen: "Reglages" }); return; }
  }

  const optionsCategorie = [{ value: "", label: "Toutes catégories" }, ...(meta?.categories ?? []).map((c) => ({ value: c, label: c }))];

  return (
    <View style={styles.conteneur}>
      <ScrollView contentContainerStyle={styles.scroll} stickyHeaderIndices={[]}>
        {/* En-tête */}
        <View style={styles.entete}>
          <View style={styles.ligneTitre}>
            <Text style={styles.titrePrincipal}>Bibliothèque de chants</Text>
            <Text style={styles.badgeTotal}>{filtres.length} chant{filtres.length > 1 ? "s" : ""}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rangeeActionsHeader}>
            {estSuperAdmin ? (
              <>
                <Pressable style={[styles.boutonHeader, styles.boutonHeaderPrimaire]} onPress={() => ouvrirActionHeader("ajouter")}>
                  <Text style={styles.texteBoutonHeaderPrimaire}>➕ Ajouter un chant</Text>
                </Pressable>
                <Pressable style={styles.boutonHeader} onPress={() => ouvrirActionHeader("importer")}><Text style={styles.texteBoutonHeader}>📥 Importer</Text></Pressable>
                <Pressable style={styles.boutonHeader} onPress={() => ouvrirActionHeader("admin")}><Text style={styles.texteBoutonHeader}>🛡 Admin</Text></Pressable>
                <Pressable style={styles.boutonHeader} onPress={() => ouvrirActionHeader("stats")}><Text style={styles.texteBoutonHeader}>📊 Stats</Text></Pressable>
              </>
            ) : (
              <>
                <Pressable style={[styles.boutonHeader, styles.boutonHeaderPrimaire]} onPress={() => ouvrirActionHeader("composer")}>
                  <Text style={styles.texteBoutonHeaderPrimaire}>✍ Composer</Text>
                </Pressable>
                <Pressable style={styles.boutonHeader} onPress={() => ouvrirActionHeader("depliants")}><Text style={styles.texteBoutonHeader}>📂 Dépliants</Text></Pressable>
                <Pressable style={styles.boutonHeader} onPress={() => ouvrirActionHeader("reglages")}><Text style={styles.texteBoutonHeader}>⚙ Réglages</Text></Pressable>
              </>
            )}
          </ScrollView>
        </View>

        {/* Filtres */}
        <View style={styles.carteFiltres}>
          <View style={styles.rechercheWrapper}>
            <Text style={styles.iconeRecherche}>🔍</Text>
            <TextInput
              style={styles.champRecherche}
              placeholder="Rechercher un chant, un mot des paroles…"
              placeholderTextColor="#9aa5b1"
              value={recherche}
              onChangeText={setRecherche}
            />
          </View>
          <View style={styles.rangeeSelects}>
            <SelectModal label="Catégorie" value={categorieFiltre} options={optionsCategorie} onChange={setCategorieFiltre} style={styles.selectMoitie} />
            <SelectModal label="Langue" value={langueFiltre} options={LANGUES_OPTIONS} onChange={setLangueFiltre} style={styles.selectMoitie} />
          </View>
          <Pressable style={styles.boutonFiltresAvances} onPress={() => setFiltresAvancesOuverts((v) => !v)}>
            <Text style={styles.texteFiltresAvances}>⚙ Filtres avancés</Text>
          </Pressable>
          {filtresAvancesOuverts && (
            <View style={styles.blocFiltresAvances}>
              <Text style={styles.labelFiltre}>Occasion</Text>
              <TextInput
                style={styles.champOccasion}
                placeholder="Ex: Messe, Mariage..."
                value={occasionFiltre}
                onChangeText={setOccasionFiltre}
              />
              <Text style={styles.labelFiltre}>État</Text>
              <SelectModal label="État" value={etatFiltre} options={OPTIONS_ETAT} onChange={setEtatFiltre} />
            </View>
          )}
        </View>

        {/* Barre vue/tri */}
        <View style={styles.barreOutils}>
          <View style={styles.toggleVue}>
            <Pressable style={[styles.boutonToggle, vueMode === "list" && styles.boutonToggleActif]} onPress={() => changerVueMode("list")}>
              <Text style={[styles.texteToggle, vueMode === "list" && styles.texteToggleActif]}>☰ Liste</Text>
            </Pressable>
            <Pressable style={[styles.boutonToggle, vueMode === "grid" && styles.boutonToggleActif]} onPress={() => changerVueMode("grid")}>
              <Text style={[styles.texteToggle, vueMode === "grid" && styles.texteToggleActif]}>⚏ Grille</Text>
            </Pressable>
          </View>
          <View style={styles.rangeeTri}>
            <Text style={styles.labelTri}>Trier par</Text>
            <SelectModal label="Trier par" value={tri} options={OPTIONS_TRI} onChange={(v) => setTri(v as TriCle)} style={styles.selectTri} />
            <Pressable style={styles.boutonDirection} onPress={() => setDirection((d) => (d === 1 ? -1 : 1))}>
              <Text style={styles.texteDirection}>⇅</Text>
            </Pressable>
          </View>
        </View>

        {/* Liste */}
        {chargement ? (
          <ActivityIndicator style={{ marginTop: 40 }} />
        ) : page.length === 0 ? (
          <Text style={styles.videTexte}>
            {recherche.trim() ? `Aucun résultat pour « ${recherche.trim()} »` : "Aucun chant disponible"}
          </Text>
        ) : (
          <FlatList
            key={vueMode}
            data={page}
            keyExtractor={(c) => String(c.id)}
            numColumns={vueMode === "grid" ? 2 : 1}
            columnWrapperStyle={vueMode === "grid" ? { gap: 10 } : undefined}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <View style={vueMode === "grid" ? { flex: 1 } : undefined}>
                <ChantCard
                  chant={item}
                  estSuperAdmin={estSuperAdmin}
                  modeGrille={vueMode === "grid"}
                  onVoir={() => { setModeEditionDirecte(false); setChantSelectionne(item); }}
                  onModifier={() => { setModeEditionDirecte(true); setChantSelectionne(item); }}
                  onDupliquer={() => onDupliquer(item)}
                  onFavori={() => onToggleFavori(item)}
                  onChangerEtat={() => onChangerEtatChant(item)}
                />
              </View>
            )}
          />
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <View style={styles.pagination}>
            <Pressable disabled={pageEffective === 1} onPress={() => setPageIndex(pageEffective - 1)}>
              <Text style={[styles.pageBouton, pageEffective === 1 && styles.pageBoutonDesactive]}>‹</Text>
            </Pressable>
            <Text style={styles.pageInfo}>{pageEffective} / {totalPages}</Text>
            <Pressable disabled={pageEffective === totalPages} onPress={() => setPageIndex(pageEffective + 1)}>
              <Text style={[styles.pageBouton, pageEffective === totalPages && styles.pageBoutonDesactive]}>›</Text>
            </Pressable>
          </View>
        )}
        <SelectModal
          label="Par page"
          value={String(pageSize)}
          options={[{ value: "10", label: "10 par page" }, { value: "20", label: "20 par page" }, { value: "50", label: "50 par page" }, { value: "100", label: "100 par page" }]}
          onChange={(v) => changerPageSize(Number(v))}
          style={styles.selectPageSize}
        />
      </ScrollView>

      <SongDetailModal
        visible={!!chantSelectionne || modeCreation}
        chant={chantSelectionne}
        meta={meta}
        estSuperAdmin={estSuperAdmin}
        ouvrirEnEdition={modeEditionDirecte}
        onClose={() => { setChantSelectionne(null); setModeCreation(false); setModeEditionDirecte(false); }}
        onChange={(maj) => {
          setChants((prev) => prev.map((c) => (c.id === maj.id ? maj : c)));
          setChantSelectionne(maj);
        }}
        onCreated={() => {
          setModeCreation(false);
          charger(rechercheDebattue, categorieFiltre, occasionDebattue);
        }}
        onDelete={(id) => {
          setChants((prev) => prev.filter((c) => c.id !== id));
          setChantSelectionne(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  conteneur: { flex: 1, backgroundColor: "#eef2f9" },
  scroll: { padding: 16, paddingBottom: 24 },
  entete: { marginBottom: 12 },
  ligneTitre: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  titrePrincipal: { fontSize: 19, fontWeight: "800", color: "#1e293b" },
  badgeTotal: { fontSize: 12, color: "#64748b", backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  rangeeActionsHeader: { gap: 8 },
  boutonHeader: { backgroundColor: "#fff", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  boutonHeaderPrimaire: { backgroundColor: "#2563eb" },
  texteBoutonHeader: { fontSize: 12, color: "#334155", fontWeight: "600" },
  texteBoutonHeaderPrimaire: { fontSize: 12, color: "#fff", fontWeight: "700" },

  carteFiltres: { backgroundColor: "#fff", borderRadius: 14, padding: 12, marginBottom: 10 },
  rechercheWrapper: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 10, paddingHorizontal: 10, marginBottom: 8 },
  iconeRecherche: { marginRight: 6 },
  champRecherche: { flex: 1, paddingVertical: 10, fontSize: 14 },
  rangeeSelects: { flexDirection: "row", gap: 8 },
  selectMoitie: { flex: 1 },
  boutonFiltresAvances: { marginTop: 8, alignSelf: "flex-start" },
  texteFiltresAvances: { fontSize: 12, color: "#2563eb", fontWeight: "600" },
  blocFiltresAvances: { marginTop: 10, gap: 4 },
  labelFiltre: { fontSize: 11, color: "#94a3b8", fontWeight: "600", marginTop: 6 },
  champOccasion: { borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 10, padding: 10, fontSize: 13 },

  barreOutils: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 },
  toggleVue: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 10, padding: 3 },
  boutonToggle: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  boutonToggleActif: { backgroundColor: "#2563eb" },
  texteToggle: { fontSize: 12, color: "#475569", fontWeight: "600" },
  texteToggleActif: { color: "#fff" },
  rangeeTri: { flexDirection: "row", alignItems: "center", gap: 6 },
  labelTri: { fontSize: 12, color: "#64748b" },
  selectTri: { minWidth: 150 },
  boutonDirection: { backgroundColor: "#fff", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  texteDirection: { fontSize: 14 },

  videTexte: { textAlign: "center", color: "#94a3b8", marginTop: 40, fontSize: 14 },

  pagination: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 20, marginTop: 12 },
  pageBouton: { fontSize: 20, color: "#2563eb", fontWeight: "700" },
  pageBoutonDesactive: { color: "#cbd5e1" },
  pageInfo: { fontSize: 13, color: "#64748b" },
  selectPageSize: { marginTop: 10, alignSelf: "center", minWidth: 140 },

});
