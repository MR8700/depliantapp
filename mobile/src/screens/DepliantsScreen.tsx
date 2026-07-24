import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sharing from "expo-sharing";
import { listerFeuillets, getFeuillet, supprimerFeuillet, creerFeuillet, mettreAJourFeuillet, telechargerFeuilletPdf, DepassementPdf } from "../api/feuillets";
import { demanderSuppression } from "../api/moderation";
import { ApiError } from "../api/client";
import { useIdentite } from "../context/IdentiteContext";
import { Feuillet } from "../types";
import PdfViewer from "../components/PdfViewer";
import SelectModal from "../components/SelectModal";
import Bouton from "../components/Bouton";

type Onglet = "mine" | "publics" | "tous" | "favoris" | "recents" | "sauvegardes";
type Tri = "recent" | "ancien" | "nom-asc" | "nom-desc" | "creation" | "modification";

const ONGLETS: { value: Onglet; label: string }[] = [
  { value: "mine", label: "Mes créations" },
  { value: "publics", label: "Feuillets publics" },
  { value: "tous", label: "Tous les feuillets" },
  { value: "favoris", label: "⭐ Favoris" },
  { value: "recents", label: "🕒 Récents" },
  { value: "sauvegardes", label: "💾 Mes sauvegardes" },
];

const OPTIONS_TRI: { value: Tri; label: string }[] = [
  { value: "recent", label: "Plus récent" },
  { value: "ancien", label: "Plus ancien" },
  { value: "nom-asc", label: "Nom A → Z" },
  { value: "nom-desc", label: "Nom Z → A" },
  { value: "creation", label: "Date de création" },
  { value: "modification", label: "Date de modification" },
];

const CLE_FAVORIS = "depliants_favoris";
const CLE_SAUVEGARDES = "depliants_sauvegardes";

function formaterDateAffichage(valeur: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur || "");
  if (!m) return valeur || "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export default function DepliantsScreen() {
  const navigation = useNavigation<any>();
  const { estSuperAdmin, identite } = useIdentite();
  const [onglet, setOnglet] = useState<Onglet>("mine");
  const [tri, setTri] = useState<Tri>("recent");
  const [recherche, setRecherche] = useState("");
  const [feuillets, setFeuillets] = useState<Feuillet[]>([]);
  const [favoris, setFavoris] = useState<number[]>([]);
  const [sauvegardes, setSauvegardes] = useState<number[]>([]);
  const [chargement, setChargement] = useState(true);
  const [rafraichissement, setRafraichissement] = useState(false);
  const [apercuVisible, setApercuVisible] = useState(false);
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [pdfChargement, setPdfChargement] = useState(false);
  const [pdfErreur, setPdfErreur] = useState<DepassementPdf | null>(null);
  const [raisonModal, setRaisonModal] = useState<{ id: number } | null>(null);
  const [raison, setRaison] = useState("");
  const [menuOuvert, setMenuOuvert] = useState<Feuillet | null>(null);
  const [renommerCible, setRenommerCible] = useState<Feuillet | null>(null);
  const [nouvelleDate, setNouvelleDate] = useState("");
  const [infosModal, setInfosModal] = useState<Feuillet | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(CLE_FAVORIS).then((v) => setFavoris(v ? JSON.parse(v) : []));
    AsyncStorage.getItem(CLE_SAUVEGARDES).then((v) => setSauvegardes(v ? JSON.parse(v) : []));
  }, []);

  const charger = useCallback(async () => {
    try {
      const resultats = await listerFeuillets(false);
      setFeuillets(resultats);
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible de charger les dépliants");
    }
  }, []);

  useEffect(() => {
    setChargement(true);
    charger().finally(() => setChargement(false));
  }, [charger]);

  async function onRafraichir() {
    setRafraichissement(true);
    await charger();
    setRafraichissement(false);
  }

  async function toggleFavori(id: number) {
    const nouveau = favoris.includes(id) ? favoris.filter((f) => f !== id) : [...favoris, id];
    setFavoris(nouveau);
    await AsyncStorage.setItem(CLE_FAVORIS, JSON.stringify(nouveau));
  }

  async function ouvrir(feuillet: Feuillet) {
    setApercuVisible(true);
    setPdfChargement(true);
    setPdfErreur(null);
    setPdfUri(null);
    try {
      const { uri } = await telechargerFeuilletPdf(feuillet.id);
      setPdfUri(uri);
    } catch (erreur) {
      if (erreur instanceof ApiError && erreur.status === 409) setPdfErreur(erreur.detail as DepassementPdf);
      else Alert.alert("Erreur", "Impossible d'ouvrir ce dépliant");
    } finally {
      setPdfChargement(false);
    }
  }

  function modifier(feuillet: Feuillet) {
    navigation.navigate("Composer", { feuilletId: feuillet.id });
  }

  function nouveauFeuillet() {
    navigation.navigate("Composer", { feuilletId: undefined });
  }

  async function partager(feuillet: Feuillet) {
    try {
      const { uri } = await telechargerFeuilletPdf(feuillet.id);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf" });
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible de partager");
    }
  }

  function supprimer(feuillet: Feuillet) {
    const estAMoi = feuillet.chorale_id === identite?.compte_id || estSuperAdmin;
    if (estSuperAdmin) {
      Alert.alert("Supprimer ce dépliant ?", "Cette action est irréversible.", [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer", style: "destructive", onPress: async () => {
            try { await supprimerFeuillet(feuillet.id); setFeuillets((p) => p.filter((f) => f.id !== feuillet.id)); }
            catch (erreur: any) { Alert.alert("Erreur", erreur?.message ?? "Impossible de supprimer"); }
          },
        },
      ]);
    } else if (estAMoi) {
      setRaison("");
      setRaisonModal({ id: feuillet.id });
    }
  }

  function ouvrirMenu(feuillet: Feuillet) {
    setMenuOuvert(feuillet);
  }

  function ouvrirRenommer(feuillet: Feuillet) {
    setMenuOuvert(null);
    setNouvelleDate(feuillet.date);
    setRenommerCible(feuillet);
  }

  async function confirmerRenommage() {
    if (!renommerCible || !nouvelleDate.trim() || nouvelleDate.trim() === renommerCible.date) {
      setRenommerCible(null);
      return;
    }
    try {
      const orig = await getFeuillet(renommerCible.id);
      await mettreAJourFeuillet(renommerCible.id, {
        date: nouvelleDate.trim(), lieu: orig.lieu, lectures: orig.lectures,
        moments: orig.moments, priere_active: orig.priere_active, priere_texte: orig.priere_texte,
        taille_texte_manuelle: orig.taille_texte_manuelle, one_page_mode: orig.one_page_mode,
        banniere_active: orig.banniere_active,
      });
      setRenommerCible(null);
      charger();
    } catch (erreur: any) {
      Alert.alert("Erreur lors du renommage", erreur?.message ?? "Impossible de renommer");
    }
  }

  async function creerCopie(feuillet: Feuillet) {
    setMenuOuvert(null);
    try {
      const orig = await getFeuillet(feuillet.id);
      await creerFeuillet({
        date: orig.date + " (Copie)", lieu: orig.lieu, lectures: orig.lectures,
        moments: orig.moments, priere_active: orig.priere_active, priere_texte: orig.priere_texte,
        taille_texte_manuelle: orig.taille_texte_manuelle, one_page_mode: orig.one_page_mode,
        banniere_active: orig.banniere_active,
      });
      Alert.alert("Copie créée avec succès !");
      charger();
    } catch (erreur: any) {
      Alert.alert("Erreur lors de la copie", erreur?.message ?? "Impossible de copier");
    }
  }

  async function telechargerPdf(feuillet: Feuillet) {
    setMenuOuvert(null);
    try {
      const { uri } = await telechargerFeuilletPdf(feuillet.id);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf" });
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible de télécharger le PDF");
    }
  }

  function telechargerDocx() {
    setMenuOuvert(null);
    Alert.alert("Bientôt disponible", "L'export Word sera activé lors d'une prochaine mise à jour.");
  }

  function voirInfos(feuillet: Feuillet) {
    setMenuOuvert(null);
    setInfosModal(feuillet);
  }

  async function envoyerDemande() {
    if (!raisonModal || !raison.trim()) return;
    try {
      await demanderSuppression("feuillet", raisonModal.id, raison.trim());
      setRaisonModal(null);
      Alert.alert("Demande envoyée", "Le super-admin va examiner ta demande.");
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible d'envoyer la demande");
    }
  }

  const filtres = feuillets.filter((f) => {
    if (onglet === "mine") return f.chorale_id === identite?.compte_id;
    if (onglet === "publics") return f.chorale_id !== identite?.compte_id;
    if (onglet === "favoris") return favoris.includes(f.id);
    if (onglet === "sauvegardes") return sauvegardes.includes(f.id) || f.chorale_id === identite?.compte_id;
    return true; // tous, recents
  }).filter((f) => {
    const q = recherche.trim().toLowerCase();
    if (!q) return true;
    return f.date.includes(q) || (f.lieu ?? "").toLowerCase().includes(q) || (f.chorale_nom ?? "").toLowerCase().includes(q);
  });

  const tries = [...filtres].sort((a, b) => {
    if (tri === "ancien") return a.date.localeCompare(b.date);
    if (tri === "nom-asc") return (a.lieu ?? "").localeCompare(b.lieu ?? "");
    if (tri === "nom-desc") return (b.lieu ?? "").localeCompare(a.lieu ?? "");
    if (tri === "creation") return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    if (tri === "modification") return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    return b.date.localeCompare(a.date); // recent (défaut)
  });

  return (
    <View style={styles.conteneur}>
      <View style={styles.entete}>
        <Text style={styles.titrePrincipal}>Mes dépliants</Text>
        <Text style={styles.sousTitre}>Retrouvez tous vos feuillets composés ainsi que ceux partagés par la communauté.</Text>
        <Pressable style={styles.boutonNouveau} onPress={nouveauFeuillet}>
          <Text style={styles.texteBoutonNouveau}>+ Nouveau feuillet</Text>
        </Pressable>
      </View>

      <View style={styles.rechercheWrapper}>
        <Text>🔍</Text>
        <TextInput
          style={styles.champRecherche}
          placeholder="Rechercher un feuillet (paroisse, chant, date, lieu)..."
          value={recherche}
          onChangeText={setRecherche}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.onglets}>
        {ONGLETS.map((o) => (
          <Pressable key={o.value} onPress={() => setOnglet(o.value)} style={[styles.onglet, onglet === o.value && styles.ongletActif]}>
            <Text style={[styles.texteOnglet, onglet === o.value && styles.texteOngletActif]}>{o.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.ligneMeta}>
        <Text style={styles.badgeResultats}>{tries.length} résultat{tries.length !== 1 ? "s" : ""}</Text>
        <SelectModal label="Trier par" value={tri} options={OPTIONS_TRI} onChange={(v) => setTri(v as Tri)} style={styles.selectTri} />
      </View>

      <FlatList
        data={tries}
        keyExtractor={(f) => String(f.id)}
        contentContainerStyle={styles.liste}
        refreshControl={<RefreshControl refreshing={rafraichissement} onRefresh={onRafraichir} tintColor="#2563eb" />}
        ListEmptyComponent={!chargement ? <Text style={styles.vide}>Aucun dépliant.</Text> : null}
        renderItem={({ item }) => {
          const estAMoi = item.chorale_id === identite?.compte_id || estSuperAdmin;
          const nbChants = item.moments.filter((m) => m.type === "chant").length;
          const format = item.one_page_mode ? "1 page paysage" : "2 pages paysage";
          const estFavori = favoris.includes(item.id);
          return (
            <View style={styles.carte}>
              <Text style={[styles.badgeType, estAMoi ? styles.badgePrive : styles.badgePublic]}>{estAMoi ? "Privé" : "Communauté"}</Text>
              <Text style={styles.date}>{formaterDateAffichage(item.date)}{item.lieu ? ` — ${item.lieu}` : ""}</Text>
              {!estAMoi && item.chorale_nom && <Text style={styles.attribution}>Composé par {item.chorale_nom}</Text>}
              <View style={styles.metaLigne}>
                <Text style={styles.meta}>🎵 {nbChants} chant(s)</Text>
                <Text style={styles.meta}>📄 {format}</Text>
              </View>
              <View style={styles.actions}>
                <Pressable style={styles.action} onPress={() => ouvrir(item)}><Text style={styles.iconeAction}>👁️</Text></Pressable>
                <Pressable style={styles.action} onPress={() => toggleFavori(item.id)}><Text style={styles.iconeAction}>{estFavori ? "⭐" : "☆"}</Text></Pressable>
                <Pressable style={styles.action} onPress={() => partager(item)}><Text style={styles.iconeAction}>🔗</Text></Pressable>
                <Pressable style={styles.action} onPress={() => modifier(item)}><Text style={styles.iconeAction}>✏️</Text></Pressable>
                {(estAMoi || estSuperAdmin) && (
                  <Pressable style={styles.action} onPress={() => supprimer(item)}><Text style={styles.iconeAction}>🗑️</Text></Pressable>
                )}
                <Pressable style={styles.action} onPress={() => ouvrirMenu(item)}><Text style={styles.iconeAction}>⋮</Text></Pressable>
              </View>
            </View>
          );
        }}
      />

      <Modal visible={apercuVisible} animationType="slide" onRequestClose={() => setApercuVisible(false)}>
        <PdfViewer uri={pdfUri} chargement={pdfChargement} erreur={pdfErreur?.message ?? null} momentsEnCause={pdfErreur?.moments_en_cause} onFermer={() => setApercuVisible(false)} />
      </Modal>

      <Modal visible={!!raisonModal} animationType="fade" transparent onRequestClose={() => setRaisonModal(null)}>
        <View style={styles.fondModal}>
          <View style={styles.boiteModal}>
            <Text style={styles.titreModal}>Demander la suppression</Text>
            <TextInput style={styles.champModal} placeholder="Raison..." value={raison} onChangeText={setRaison} multiline />
            <View style={styles.rangeeModal}>
              <View style={{ flex: 1 }}><Bouton titre="Annuler" variante="contour" onPress={() => setRaisonModal(null)} /></View>
              <View style={{ flex: 1 }}><Bouton titre="Envoyer" onPress={envoyerDemande} desactive={!raison.trim()} /></View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!menuOuvert} animationType="slide" transparent onRequestClose={() => setMenuOuvert(null)}>
        <Pressable style={styles.fondFeuille} onPress={() => setMenuOuvert(null)}>
          <Pressable style={styles.feuilleBas} onPress={() => {}}>
            <View style={styles.poigneeFeuille} />
            <View style={styles.enteteFeuille}>
              <Text style={styles.titreFeuille}>Options du dépliant</Text>
              <Pressable onPress={() => setMenuOuvert(null)}><Text style={styles.fermerFeuille}>✕</Text></Pressable>
            </View>
            {menuOuvert && (() => {
              const estAMoi = menuOuvert.chorale_id === identite?.compte_id || estSuperAdmin;
              const estFavori = favoris.includes(menuOuvert.id);
              return (
                <>
                  <Pressable style={styles.itemFeuille} onPress={() => { setMenuOuvert(null); ouvrir(menuOuvert); }}>
                    <Text style={styles.texteItemFeuille}>👁️ Ouvrir le PDF</Text>
                  </Pressable>
                  <Pressable style={styles.itemFeuille} onPress={() => { setMenuOuvert(null); modifier(menuOuvert); }}>
                    <Text style={styles.texteItemFeuille}>✏️ {estAMoi ? "Modifier" : "Copier et modifier"}</Text>
                  </Pressable>
                  <Pressable style={styles.itemFeuille} onPress={() => creerCopie(menuOuvert)}>
                    <Text style={styles.texteItemFeuille}>💾 Créer une copie</Text>
                  </Pressable>
                  <Pressable style={styles.itemFeuille} onPress={() => { toggleFavori(menuOuvert.id); setMenuOuvert(null); }}>
                    <Text style={styles.texteItemFeuille}>⭐ {estFavori ? "Retirer des favoris" : "Ajouter aux favoris"}</Text>
                  </Pressable>
                  <Pressable style={styles.itemFeuille} onPress={() => ouvrirRenommer(menuOuvert)}>
                    <Text style={styles.texteItemFeuille}>🏷️ Renommer (Date)</Text>
                  </Pressable>
                  <Pressable style={styles.itemFeuille} onPress={() => voirInfos(menuOuvert)}>
                    <Text style={styles.texteItemFeuille}>ℹ️ Voir les informations</Text>
                  </Pressable>
                  <Pressable style={styles.itemFeuille} onPress={() => telechargerPdf(menuOuvert)}>
                    <Text style={styles.texteItemFeuille}>📥 Télécharger le PDF</Text>
                  </Pressable>
                  <Pressable style={styles.itemFeuille} onPress={telechargerDocx}>
                    <Text style={styles.texteItemFeuille}>📝 Télécharger en DOCX</Text>
                  </Pressable>
                  {estAMoi && (
                    <Pressable style={styles.itemFeuille} onPress={() => { setMenuOuvert(null); supprimer(menuOuvert); }}>
                      <Text style={[styles.texteItemFeuille, styles.texteItemDanger]}>🗑️ Supprimer</Text>
                    </Pressable>
                  )}
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!renommerCible} animationType="fade" transparent onRequestClose={() => setRenommerCible(null)}>
        <View style={styles.fondModal}>
          <View style={styles.boiteModal}>
            <Text style={styles.titreModal}>Nouveau nom (Date de la célébration)</Text>
            <TextInput style={styles.champModalSimple} value={nouvelleDate} onChangeText={setNouvelleDate} autoFocus />
            <View style={styles.rangeeModal}>
              <View style={{ flex: 1 }}><Bouton titre="Annuler" variante="contour" onPress={() => setRenommerCible(null)} /></View>
              <View style={{ flex: 1 }}><Bouton titre="Renommer" onPress={confirmerRenommage} desactive={!nouvelleDate.trim()} /></View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!infosModal} animationType="fade" transparent onRequestClose={() => setInfosModal(null)}>
        <View style={styles.fondModal}>
          <View style={styles.boiteModal}>
            <Text style={styles.titreModal}>ℹ️ Fiche technique du feuillet</Text>
            {infosModal && (() => {
              const f = infosModal;
              const estAMoi = f.chorale_id === identite?.compte_id || estSuperAdmin;
              const format = f.one_page_mode ? "1 page paysage" : "2 pages paysage";
              const nbChants = f.moments.filter((m) => m.type === "chant").length;
              let dateCreation = "Non précisé";
              if (f.created_at) {
                try { dateCreation = new Date(f.created_at.replace(" ", "T")).toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" }); }
                catch { dateCreation = "Date invalide"; }
              }
              const lignes: [string, string][] = [
                ["Titre / Date", formaterDateAffichage(f.date)],
                ["Lieu", f.lieu || "Non précisé"],
                ["Auteur / Chorale", f.chorale_nom || "Ma chorale"],
                ["Créé le", dateCreation],
                ["Format", format],
                ["Nombre de chants", `${nbChants} chant(s)`],
                ["Visibilité", estAMoi ? "Privé" : "Public (Communauté)"],
              ];
              return (
                <View>
                  {lignes.map(([label, valeur]) => (
                    <View key={label} style={styles.ligneInfo}>
                      <Text style={styles.libelleInfo}>{label}</Text>
                      <Text style={styles.valeurInfo}>{valeur}</Text>
                    </View>
                  ))}
                </View>
              );
            })()}
            <View style={{ marginTop: 14 }}><Bouton titre="Fermer" onPress={() => setInfosModal(null)} /></View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  conteneur: { flex: 1, backgroundColor: "#eef2f9" },
  entete: { padding: 16, paddingBottom: 8 },
  titrePrincipal: { fontSize: 19, fontWeight: "800", color: "#1e293b" },
  sousTitre: { fontSize: 12, color: "#64748b", marginTop: 2, marginBottom: 10 },
  boutonNouveau: { backgroundColor: "#2563eb", borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  texteBoutonNouveau: { color: "#fff", fontWeight: "700", fontSize: 13 },
  rechercheWrapper: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 12, padding: 12, marginHorizontal: 16, borderWidth: 1, borderColor: "#dbe2ea" },
  champRecherche: { flex: 1, fontSize: 13 },
  onglets: { paddingHorizontal: 16, paddingVertical: 8, gap: 4 },
  onglet: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, marginRight: 4, borderWidth: 1, borderColor: "transparent" },
  ongletActif: { backgroundColor: "#eaf0fa", borderColor: "rgba(31,74,124,0.15)" },
  texteOnglet: { fontSize: 12, color: "#64748b", fontWeight: "500" },
  texteOngletActif: { color: "#1F4A7C", fontWeight: "600" },
  ligneMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, marginBottom: 8 },
  badgeResultats: { fontSize: 12, color: "#64748b" },
  selectTri: { minWidth: 160 },
  liste: { paddingHorizontal: 16, paddingBottom: 24 },
  vide: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
  carte: { backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 10 },
  badgeType: { alignSelf: "flex-start", fontSize: 10, fontWeight: "700", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 6 },
  badgePrive: { backgroundColor: "#dbeafe", color: "#2563eb" },
  badgePublic: { backgroundColor: "#dcfce7", color: "#16a34a" },
  date: { fontSize: 15, fontWeight: "700", color: "#1e293b" },
  attribution: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  metaLigne: { flexDirection: "row", gap: 14, marginTop: 6 },
  meta: { fontSize: 12, color: "#64748b" },
  actions: { flexDirection: "row", gap: 16, marginTop: 10 },
  action: {},
  iconeAction: { fontSize: 16 },
  fondModal: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)", justifyContent: "center", padding: 24 },
  boiteModal: { backgroundColor: "#fff", borderRadius: 16, padding: 20 },
  titreModal: { fontSize: 16, fontWeight: "700", marginBottom: 10, color: "#1e293b" },
  champModal: { borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 10, padding: 12, minHeight: 70, textAlignVertical: "top", marginBottom: 14 },
  champModalSimple: { borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 14 },
  rangeeModal: { flexDirection: "row", gap: 10 },
  fondFeuille: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)", justifyContent: "flex-end" },
  feuilleBas: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 24, paddingTop: 8 },
  poigneeFeuille: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#cbd5e1", alignSelf: "center", marginVertical: 8 },
  enteteFeuille: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  titreFeuille: { fontSize: 15, fontWeight: "700", color: "#1e293b" },
  fermerFeuille: { fontSize: 16, color: "#94a3b8", padding: 4 },
  itemFeuille: { paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#f8fafc" },
  texteItemFeuille: { fontSize: 14, color: "#334155", fontWeight: "500" },
  texteItemDanger: { color: "#dc2626" },
  ligneInfo: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#f1f5f9", borderStyle: "dashed", paddingBottom: 8, marginBottom: 8 },
  libelleInfo: { fontSize: 12, color: "#64748b", fontWeight: "500" },
  valeurInfo: { fontSize: 12, color: "#0f172a", fontWeight: "700" },
});
