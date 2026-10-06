import { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import { rechercherChants, bulkCategoriser, bulkSupprimer, modifierChant } from "../api/chants";
import { getMeta } from "../api/meta";
import { useIdentite } from "../context/IdentiteContext";
import { Chant, Meta } from "../types";
import { niveauConfiance, LABEL_CONFIANCE, COULEUR_CONFIANCE } from "../utils/confiance";
import { LANGUES_OPTIONS, categorieLabel, NOMS_LANGUES } from "../utils/labels";
import SongDetailModal from "../components/SongDetailModal";
import SelectModal from "../components/SelectModal";
import Bouton from "../components/Bouton";

type FiltreStat = "importes" | "a-verifier" | "echecs" | "tous";
type Tri = "recent" | "creation" | "titre" | "confiance" | "auteur";

export default function EditeurScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { estSuperAdmin } = useIdentite();
  const [chants, setChants] = useState<Chant[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const categories = meta?.categories ?? [];
  const [recherche, setRecherche] = useState("");
  const [filtreStat, setFiltreStat] = useState<FiltreStat>("tous");
  const [filtreCategorie, setFiltreCategorie] = useState("");
  const [filtreLangue, setFiltreLangue] = useState("");
  const [filtreOrigine, setFiltreOrigine] = useState<"" | "manuel" | "importe">("");
  const [filtreVisibilite, setFiltreVisibilite] = useState<"" | "chorale" | "publique">("");
  const [tri, setTri] = useState<Tri>("recent");
  const [drawerOuvert, setDrawerOuvert] = useState(false);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [chantOuvert, setChantOuvert] = useState<Chant | null>(null);
  const [detailsChant, setDetailsChant] = useState<Chant | null>(null);
  const [modeCreation, setModeCreation] = useState(false);
  const [pageIndex, setPageIndex] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [exportEnCours, setExportEnCours] = useState(false);

  useEffect(() => {
    getMeta().then(setMeta).catch(() => {});
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
      // Origine "Manuel" = créé via "+ Ajouter un chant" (source_file=null),
      // par opposition à un chant issu de l'import (source_file="import_workspace").
      // Le web filtre sur `confiance === null`, un état qui n'existe plus dans
      // le schéma actuel (colonne NOT NULL DEFAULT 1.0, voir db.py) -- ce
      // filtre serait donc toujours vide côté web ; source_file est le champ
      // qui porte réellement cette distinction.
      if (filtreOrigine === "manuel" && c.source_file) return false;
      if (filtreOrigine === "importe" && !c.source_file) return false;
      if (filtreVisibilite && c.visibilite !== filtreVisibilite) return false;
      if (q && !c.titre.toLowerCase().includes(q)) return false;
      return true;
    });
    liste = [...liste].sort((a, b) => {
      if (tri === "titre") return a.titre.localeCompare(b.titre);
      if (tri === "confiance") return b.confiance - a.confiance;
      if (tri === "auteur") return (a.auteur || a.compositeur || "").localeCompare(b.auteur || b.compositeur || "");
      return 0; // recent/creation : created_at non exposé par l'API, comparaison neutre
    });
    return liste;
  }, [chants, recherche, filtreStat, filtreCategorie, filtreLangue, filtreOrigine, filtreVisibilite, tri]);

  useEffect(() => { setPageIndex(1); }, [recherche, filtreStat, filtreCategorie, filtreLangue, filtreOrigine, filtreVisibilite, tri]);

  const totalPages = Math.max(1, Math.ceil(filtres.length / pageSize));
  const pageEffective = Math.min(Math.max(1, pageIndex), totalPages);
  const page = filtres.slice((pageEffective - 1) * pageSize, pageEffective * pageSize);

  function cibleExport(): Chant[] {
    return selection.size > 0 ? chants.filter((c) => selection.has(c.id)) : filtres;
  }

  async function exporterJson() {
    const cible = cibleExport();
    if (cible.length === 0) return;
    setExportEnCours(true);
    try {
      const dest = `${FileSystem.cacheDirectory}chants_export_${Date.now()}.json`;
      await FileSystem.writeAsStringAsync(dest, JSON.stringify(cible, null, 2));
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(dest, { mimeType: "application/json" });
    } catch {
      Alert.alert("Erreur", "Impossible d'exporter cette sélection.");
    } finally {
      setExportEnCours(false);
    }
  }

  // Recueil PDF imprimable de tous les chants exportés (titre, refrain, tous
  // les couplets) -- distinct de l'export JSON (sauvegarde de données) : ici
  // le but est un document lisible/imprimable, un chant par page.
  async function exporterPdf() {
    const cible = cibleExport();
    if (cible.length === 0) return;
    setExportEnCours(true);
    try {
      const echap = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const pages = cible.map((c) => `
        <div class="chant">
          <h1>${echap(c.titre)}</h1>
          <div class="meta">${echap(c.categorie)}${c.code_reference ? ` · Réf : ${echap(c.code_reference)}` : ""}</div>
          ${c.refrain ? `<div class="refrain"><strong>Refrain :</strong><br>${echap(c.refrain).replace(/\n/g, "<br>")}</div>` : ""}
          ${c.couplets.map((cp, i) => `<div class="couplet"><span class="num">${i + 1}.</span>${echap(cp).replace(/\n/g, "<br>")}</div>`).join("")}
        </div>`).join("");
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body { font-family: 'Times New Roman', Times, serif; padding: 0; margin: 0; }
        .chant { padding: 24px 32px; page-break-after: always; }
        .chant:last-child { page-break-after: auto; }
        h1 { font-size: 20pt; border-bottom: 1.5pt solid #1a3c6e; padding-bottom: 8pt; color: #1a3c6e; }
        .meta { font-size: 10pt; color: #666; margin-bottom: 14pt; }
        .refrain { font-weight: bold; background: #f0f4fa; padding: 10pt; border-left: 3pt solid #1a3c6e; margin-bottom: 14pt; }
        .couplet { margin-bottom: 10pt; } .num { font-weight: bold; color: #1a3c6e; margin-right: 4pt; }
      </style></head><body>${pages}</body></html>`;
      await Print.printAsync({ html });
    } catch {
      // Annulation de la boîte de dialogue -- pas une erreur à signaler.
    } finally {
      setExportEnCours(false);
    }
  }

  function exporter() {
    const cible = cibleExport();
    if (cible.length === 0) return;
    Alert.alert("Exporter", `${cible.length} chant(s) -- sous quel format ?`, [
      { text: "Annuler", style: "cancel" },
      { text: "📄 PDF (imprimable)", onPress: exporterPdf },
      { text: "🗂️ JSON (sauvegarde)", onPress: exporterJson },
    ]);
  }

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

  // Comme le web (bulk-rendre-public/bulk-rendre-prive, app.js) mais via
  // PATCH plutôt qu'un GET+PUT complet par chant -- même résultat (actif
  // basculé sur toute la sélection), moins d'aller-retours réseau.
  async function basculerVisibiliteSelection(actif: boolean) {
    const ids = Array.from(selection);
    const resultats = await Promise.allSettled(ids.map((id) => modifierChant(id, { actif })));
    setChants((prev) => prev.map((c) => {
      const index = ids.indexOf(c.id);
      return index !== -1 && resultats[index].status === "fulfilled" ? { ...c, actif } : c;
    }));
    const echecs = resultats.filter((r) => r.status === "rejected").length;
    setSelection(new Set());
    if (echecs > 0) Alert.alert("Erreur", `${echecs} chant(s) n'ont pas pu être mis à jour.`);
  }

  // bulkSupprimer (api/chants.ts) branche déjà lui-même sur la licence locale
  // (compte chorale : suppression directe en local ; compte super-admin :
  // suppression réseau) -- plus de "demande de suppression" à envoyer, une
  // chorale 100% locale est seule propriétaire de sa bibliothèque.
  function supprimerSelection() {
    const ids = Array.from(selection);
    if (ids.length === 0) return;
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

      <View style={styles.rangeeCompteExport}>
        <Text style={styles.hintPagination}>{filtres.length} chant{filtres.length !== 1 ? "s" : ""}</Text>
        <Pressable onPress={exporter} disabled={exportEnCours}>
          <Text style={styles.lienExportTout}>
            {exportEnCours ? "Export..." : selection.size > 0 ? `⬇️ Exporter la sélection (${selection.size})` : "⬇️ Exporter tout"}
          </Text>
        </Pressable>
      </View>

      <FlatList
        data={page}
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
              {!!item.source_file && (
                <Pressable onPress={() => setDetailsChant(item)} hitSlop={8} style={styles.boutonDetails}>
                  <Text style={styles.texteBoutonDetails}>🔍</Text>
                </Pressable>
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text style={styles.vide}>Aucun chant.</Text>}
      />

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
        options={[{ value: "20", label: "20 par page" }, { value: "50", label: "50 par page" }, { value: "100", label: "100 par page" }]}
        onChange={(v) => { setPageSize(Number(v)); setPageIndex(1); }}
        style={styles.selectPageSize}
      />

      {selection.size > 0 && (
        <View style={[styles.barreActions, { paddingBottom: 14 + insets.bottom }]}>
          <Text style={styles.texteSelection}>{selection.size} sélectionné(s)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rangeeLiensBarre}>
            <Pressable onPress={() => categoriserSelection(categories[0] ?? "Autre")}>
              <Text style={styles.lienBarre}>Déplacer</Text>
            </Pressable>
            <Pressable onPress={() => basculerVisibiliteSelection(true)}>
              <Text style={styles.lienBarre}>Rendre public</Text>
            </Pressable>
            <Pressable onPress={() => basculerVisibiliteSelection(false)}>
              <Text style={styles.lienBarre}>Rendre privé</Text>
            </Pressable>
            <Pressable onPress={supprimerSelection}>
              <Text style={[styles.lienBarre, { color: "#fecaca" }]}>Supprimer</Text>
            </Pressable>
          </ScrollView>
        </View>
      )}

      <Modal visible={drawerOuvert} animationType="slide" transparent onRequestClose={() => setDrawerOuvert(false)}>
        <Pressable style={styles.fondDrawer} onPress={() => setDrawerOuvert(false)}>
          <Pressable style={[styles.drawer, { paddingBottom: 20 + insets.bottom }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.titreDrawer}>⚙️ Filtres avancés</Text>
            <Text style={styles.labelFiltre}>Catégorie liturgique</Text>
            <SelectModal label="Catégorie" value={filtreCategorie} options={[{ value: "", label: "Toutes" }, ...categories.map((c) => ({ value: c, label: c }))]} onChange={setFiltreCategorie} />
            <Text style={styles.labelFiltre}>Langue</Text>
            <SelectModal label="Langue" value={filtreLangue} options={LANGUES_OPTIONS} onChange={setFiltreLangue} />
            <Text style={styles.labelFiltre}>Origine</Text>
            <SelectModal
              label="Origine" value={filtreOrigine}
              options={[
                { value: "", label: "Toutes origines" },
                { value: "manuel", label: "Manuel" },
                { value: "importe", label: "Importé" },
              ]}
              onChange={(v) => setFiltreOrigine(v as "" | "manuel" | "importe")}
            />
            <Text style={styles.labelFiltre}>Visibilité</Text>
            <SelectModal
              label="Visibilité" value={filtreVisibilite}
              options={[
                { value: "", label: "Toutes" },
                { value: "publique", label: "Public" },
                { value: "chorale", label: "Privé" },
              ]}
              onChange={(v) => setFiltreVisibilite(v as "" | "chorale" | "publique")}
            />
            <Text style={styles.labelFiltre}>Trier par</Text>
            <SelectModal
              label="Trier par" value={tri}
              options={[
                { value: "recent", label: "Date de modification" }, { value: "creation", label: "Date de création" },
                { value: "titre", label: "Titre (A-Z)" }, { value: "confiance", label: "Score de confiance" },
                { value: "auteur", label: "Auteur" },
              ]}
              onChange={(v) => setTri(v as Tri)}
            />
            <View style={{ marginTop: 20 }}><Bouton titre="Fermer" onPress={() => setDrawerOuvert(false)} /></View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Détails d'import (🔍) -- équivalent de ouvrirImportDetails (app.js
          ~5530) : score de confiance, structure détectée, catégorie/langue.
          Le web affiche aussi une liste "avertissements", mais ce champ
          n'existe nulle part côté backend (schemas.py) -- toujours vide en
          pratique -- on ne reproduit donc pas cette section morte. */}
      <Modal visible={!!detailsChant} animationType="fade" transparent onRequestClose={() => setDetailsChant(null)}>
        <Pressable style={styles.fondDrawer} onPress={() => setDetailsChant(null)}>
          <Pressable style={[styles.drawer, { paddingBottom: 20 + insets.bottom }]} onPress={(e) => e.stopPropagation()}>
            {detailsChant && (
              <>
                <Text style={styles.titreDrawer}>🔍 Détails de l'import -- {detailsChant.titre}</Text>
                <View style={styles.grilleDetails}>
                  <View style={styles.carteDetail}>
                    <Text style={styles.labelDetail}>Score de confiance</Text>
                    <Text style={styles.valeurDetail}>{Math.round(detailsChant.confiance * 100)}%</Text>
                  </View>
                  <View style={styles.carteDetail}>
                    <Text style={styles.labelDetail}>Couplets détectés</Text>
                    <Text style={styles.valeurDetail}>{detailsChant.couplets.length}</Text>
                  </View>
                  <View style={styles.carteDetail}>
                    <Text style={styles.labelDetail}>Refrain détecté</Text>
                    <Text style={styles.valeurDetail}>{detailsChant.refrain ? "Oui" : "Non"}</Text>
                  </View>
                  <View style={styles.carteDetail}>
                    <Text style={styles.labelDetail}>Catégorie</Text>
                    <Text style={styles.valeurDetail}>{categorieLabel(detailsChant.categorie)}</Text>
                  </View>
                  <View style={styles.carteDetail}>
                    <Text style={styles.labelDetail}>Langue</Text>
                    <Text style={styles.valeurDetail}>{NOMS_LANGUES[detailsChant.langue] || detailsChant.langue}</Text>
                  </View>
                </View>
                <View style={{ marginTop: 20 }}><Bouton titre="Fermer" onPress={() => setDetailsChant(null)} /></View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <SongDetailModal
        visible={!!chantOuvert || modeCreation}
        chant={chantOuvert}
        meta={meta}
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
  rangeeCompteExport: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, marginBottom: 4 },
  hintPagination: { fontSize: 11, color: "#94a3b8" },
  lienExportTout: { fontSize: 12, color: "#2563eb", fontWeight: "600" },
  pagination: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 20, marginTop: 4 },
  pageBouton: { fontSize: 20, color: "#2563eb", fontWeight: "700" },
  pageBoutonDesactive: { color: "#cbd5e1" },
  pageInfo: { fontSize: 13, color: "#64748b" },
  selectPageSize: { marginTop: 8, marginHorizontal: 16, marginBottom: 8, alignSelf: "center", minWidth: 140 },
  barreActions: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#1e293b", flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  texteSelection: { color: "#fff", fontSize: 12 },
  rangeeLiensBarre: { flexDirection: "row", alignItems: "center", gap: 16 },
  lienBarre: { color: "#93c5fd", fontWeight: "600" },
  fondDrawer: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)", justifyContent: "flex-end" },
  drawer: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "80%" },
  titreDrawer: { fontSize: 16, fontWeight: "700", marginBottom: 14, color: "#1e293b" },
  labelFiltre: { fontSize: 11, color: "#94a3b8", fontWeight: "600", marginTop: 10, marginBottom: 4 },
  boutonDetails: { padding: 6, marginLeft: 4 },
  texteBoutonDetails: { fontSize: 16 },
  grilleDetails: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  carteDetail: { flexBasis: "47%", backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, padding: 12 },
  labelDetail: { fontSize: 11, color: "#64748b" },
  valeurDetail: { fontSize: 15, fontWeight: "700", color: "#0f172a", marginTop: 2 },
});
