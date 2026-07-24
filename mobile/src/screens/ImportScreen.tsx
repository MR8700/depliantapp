import { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { uploaderCarnet, finaliserImport, ChantExtrait } from "../api/import";
import { getMeta } from "../api/meta";
import { niveauConfiance, LABEL_CONFIANCE, COULEUR_CONFIANCE } from "../utils/confiance";
import SelectModal from "../components/SelectModal";
import Bouton from "../components/Bouton";

interface LigneImport extends ChantExtrait {
  inclus: boolean;
}

const LANGUES_IMPORT = [
  { value: "fr", label: "Français" },
  { value: "dioula", label: "Dioula" },
  { value: "latin", label: "Latin" },
  { value: "moore", label: "Mooré" },
  { value: "autre", label: "Autre" },
];

const CARTES_EXPLICATION = [
  { icone: "🔍", titre: "Analyse du document", texte: "Le moteur scanne la mise en page et la structure textuelle du fichier importé." },
  { icone: "🏷️", titre: "Détection des titres", texte: "Identification intelligente des titres et des débuts de chants." },
  { icone: "🎵", titre: "Refrains & Couplets", texte: "Séparation automatique des refrains, couplets, ponts et strophes." },
  { icone: "📈", titre: "Confidence Score", texte: "Un score évalue l'intégrité de l'extraction (Importé, À vérifier, Échec)." },
];

export default function ImportScreen() {
  const insets = useSafeAreaInsets();
  const [fichier, setFichier] = useState<{ uri: string; nom: string; mimeType: string; taille?: number } | null>(null);
  const [categorieDefaut, setCategorieDefaut] = useState("Autre");
  const [occasions, setOccasions] = useState("");
  const [auteur, setAuteur] = useState("");
  const [langue, setLangue] = useState("fr");
  const [enCours, setEnCours] = useState(false);
  const [lignes, setLignes] = useState<LigneImport[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [indexEnEdition, setIndexEnEdition] = useState<number | null>(null);
  const [brouillonEdition, setBrouillonEdition] = useState<{ titre: string; categorie: string; langue: string; refrain: string; couplets: string } | null>(null);

  useEffect(() => {
    getMeta().then((m) => setCategories(m.categories)).catch(() => {});
  }, []);

  async function choisirFichier() {
    const resultat = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    });
    if (resultat.canceled || !resultat.assets[0]) return;
    const a = resultat.assets[0];
    setFichier({ uri: a.uri, nom: a.name, mimeType: a.mimeType ?? "application/octet-stream", taille: a.size ?? undefined });
  }

  async function analyser() {
    if (!fichier) return;
    setEnCours(true);
    try {
      const reponse = await uploaderCarnet({ ...fichier, categorieDefaut, occasions, langue, auteur });
      setLignes(reponse.chants.map((c) => ({ ...c, inclus: true })));
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Échec de l'analyse du fichier");
    } finally {
      setEnCours(false);
    }
  }

  function majLigne(index: number, patch: Partial<LigneImport>) {
    setLignes((prev) => prev ? prev.map((l, i) => (i === index ? { ...l, ...patch } : l)) : prev);
  }

  function toutSelectionner(inclus: boolean) {
    setLignes((prev) => prev ? prev.map((l) => ({ ...l, inclus })) : prev);
  }

  function retirerLigne(index: number) {
    Alert.alert("Retirer ce chant ?", "Il ne sera pas importé.", [
      { text: "Annuler", style: "cancel" },
      { text: "Retirer", style: "destructive", onPress: () => setLignes((prev) => prev ? prev.filter((_, i) => i !== index) : prev) },
    ]);
  }

  function ouvrirEdition(index: number) {
    const l = lignes![index];
    setIndexEnEdition(index);
    setBrouillonEdition({ titre: l.titre, categorie: l.categorie, langue: l.langue, refrain: l.refrain, couplets: l.couplets.join("\n\n") });
  }

  function enregistrerEdition() {
    if (indexEnEdition === null || !brouillonEdition) return;
    majLigne(indexEnEdition, {
      titre: brouillonEdition.titre,
      categorie: brouillonEdition.categorie,
      langue: brouillonEdition.langue,
      refrain: brouillonEdition.refrain,
      couplets: brouillonEdition.couplets.split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean),
    });
    setIndexEnEdition(null);
    setBrouillonEdition(null);
  }

  async function validerImport() {
    if (!lignes) return;
    setEnCours(true);
    try {
      const payload = lignes.filter((l) => l.inclus).map((l) => ({
        action: (l.doublons.length > 0 ? "replace" : "save") as "replace" | "save",
        replace_id: l.doublons[0]?.id,
        titre: l.titre, refrain: l.refrain, couplets: l.couplets, code_reference: l.code_reference ?? undefined,
        categorie: l.categorie, occasions: l.occasions, confiance: l.confiance, langue: l.langue,
        auteur: l.auteur ?? undefined, compositeur: l.compositeur ?? undefined,
      }));
      const resultat = await finaliserImport(payload);
      Alert.alert("Import terminé", `${resultat.saved} ajoutés, ${resultat.replaced} remplacés, ${resultat.ignored} ignorés.`);
      setLignes(null);
      setFichier(null);
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Échec de la finalisation");
    } finally {
      setEnCours(false);
    }
  }

  if (lignes) {
    const stats = {
      importe: lignes.filter((l) => niveauConfiance(l.confiance) === "importe").length,
      a_verifier: lignes.filter((l) => niveauConfiance(l.confiance) === "a_verifier").length,
      echec: lignes.filter((l) => niveauConfiance(l.confiance) === "echec").length,
    };
    const tousCoches = lignes.length > 0 && lignes.every((l) => l.inclus);

    return (
      <View style={styles.conteneur}>
        <FlatList
          data={lignes}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{ padding: 16, paddingBottom: 90 }}
          ListHeaderComponent={
            <>
              <Text style={styles.titreListe}>{lignes.length} chant(s) détecté(s)</Text>
              <View style={styles.cartesStats}>
                <View style={styles.carteStatImport}><Text style={styles.nombreStatImport}>{lignes.length}</Text><Text style={styles.labelStatImport}>Total</Text></View>
                <View style={styles.carteStatImport}><Text style={[styles.nombreStatImport, { color: COULEUR_CONFIANCE.importe }]}>{stats.importe}</Text><Text style={styles.labelStatImport}>Importés</Text></View>
                <View style={styles.carteStatImport}><Text style={[styles.nombreStatImport, { color: COULEUR_CONFIANCE.a_verifier }]}>{stats.a_verifier}</Text><Text style={styles.labelStatImport}>À vérifier</Text></View>
                <View style={styles.carteStatImport}><Text style={[styles.nombreStatImport, { color: COULEUR_CONFIANCE.echec }]}>{stats.echec}</Text><Text style={styles.labelStatImport}>Échecs</Text></View>
              </View>
              <Pressable style={styles.ligneToutSelectionner} onPress={() => toutSelectionner(!tousCoches)}>
                <Text>{tousCoches ? "☑" : "☐"}</Text>
                <Text style={styles.texteToutSelectionner}>{tousCoches ? "Tout désélectionner" : "Tout sélectionner"}</Text>
              </Pressable>
            </>
          }
          renderItem={({ item, index }) => {
            const niveau = niveauConfiance(item.confiance);
            return (
              <View style={styles.carteLigne}>
                <View style={styles.enteteLigne}>
                  <Pressable onPress={() => majLigne(index, { inclus: !item.inclus })} hitSlop={10}>
                    <Text>{item.inclus ? "☑" : "☐"}</Text>
                  </Pressable>
                  <TextInput
                    style={styles.champTitre}
                    value={item.titre}
                    onChangeText={(v) => majLigne(index, { titre: v })}
                  />
                  <Pressable onPress={() => ouvrirEdition(index)} hitSlop={8}><Text style={styles.iconeActionLigne}>✏️</Text></Pressable>
                  <Pressable onPress={() => retirerLigne(index)} hitSlop={8}><Text style={styles.iconeActionLigne}>🗑️</Text></Pressable>
                </View>
                <Text style={styles.sousInfoLigne}>{item.categorie} · {item.langue.toUpperCase()}</Text>
                <View style={styles.barreConfiance}>
                  <View style={[styles.barreRemplie, { width: `${Math.round(item.confiance * 100)}%`, backgroundColor: COULEUR_CONFIANCE[niveau] }]} />
                </View>
                <Text style={[styles.labelConfiance, { color: COULEUR_CONFIANCE[niveau] }]}>
                  {LABEL_CONFIANCE[niveau]} ({Math.round(item.confiance * 100)}%)
                </Text>
                {item.doublons.length > 0 && (
                  <Text style={styles.doublon}>⚠ Doublon possible : {item.doublons[0].titre}</Text>
                )}
              </View>
            );
          }}
        />
        <View style={styles.barreBas}>
          <View style={{ flex: 1 }}><Bouton titre="Annuler" variante="contour" onPress={() => setLignes(null)} /></View>
          <View style={{ flex: 1 }}><Bouton titre="Valider l'import" onPress={validerImport} enCours={enCours} /></View>
        </View>

        <Modal visible={indexEnEdition !== null} animationType="slide" onRequestClose={() => setIndexEnEdition(null)}>
          <View style={styles.conteneurEdition}>
            <Text style={styles.titreEdition}>Modifier le chant détecté</Text>
            {brouillonEdition && (
              <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
                <Text style={styles.label}>Titre</Text>
                <TextInput style={styles.champ} value={brouillonEdition.titre} onChangeText={(v) => setBrouillonEdition({ ...brouillonEdition, titre: v })} />
                <Text style={styles.label}>Catégorie</Text>
                <SelectModal
                  label="Catégorie" value={brouillonEdition.categorie}
                  options={categories.map((c) => ({ value: c, label: c }))}
                  onChange={(v) => setBrouillonEdition({ ...brouillonEdition, categorie: v })}
                />
                <Text style={styles.label}>Langue</Text>
                <SelectModal label="Langue" value={brouillonEdition.langue} options={LANGUES_IMPORT} onChange={(v) => setBrouillonEdition({ ...brouillonEdition, langue: v })} />
                <Text style={styles.label}>Refrain</Text>
                <TextInput
                  style={[styles.champ, styles.champMulti]} value={brouillonEdition.refrain} multiline
                  onChangeText={(v) => setBrouillonEdition({ ...brouillonEdition, refrain: v })}
                />
                <Text style={styles.label}>Couplets (séparés par une ligne vide)</Text>
                <TextInput
                  style={[styles.champ, styles.champMulti]} value={brouillonEdition.couplets} multiline
                  onChangeText={(v) => setBrouillonEdition({ ...brouillonEdition, couplets: v })}
                />
              </ScrollView>
            )}
            <View style={[styles.rangeeBoutonsEdition, { paddingBottom: 16 + insets.bottom }]}>
              <View style={{ flex: 1 }}><Bouton titre="Annuler" variante="contour" onPress={() => setIndexEnEdition(null)} /></View>
              <View style={{ flex: 1 }}><Bouton titre="Enregistrer" onPress={enregistrerEdition} /></View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <ScrollView style={styles.conteneur} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.filDAriane}>Bibliothèque {">"} Importer</Text>
      <Text style={styles.titrePage}>Importer un carnet de chants</Text>
      <Text style={styles.sousTitrePage}>
        Importez un document contenant plusieurs chants. Le système analysera automatiquement son contenu pour créer les chants dans votre bibliothèque.
      </Text>
      <View style={styles.carteFormat}>
        <Text style={styles.iconeFormat}>📄</Text>
        <View>
          <Text style={styles.titreFormat}>Formats acceptés</Text>
          <Text style={styles.texteFormat}>DOC, DOCX, PDF (max 50 Mo)</Text>
        </View>
      </View>

      <Pressable style={styles.zoneFichier} onPress={choisirFichier}>
        <Text style={styles.iconeZoneFichier}>📤</Text>
        <Text style={styles.titreZoneFichier}>Glissez-déposez votre document ici</Text>
        <Text style={styles.ouTexte}>ou</Text>
        <View style={styles.boutonChoisir}><Text style={styles.texteBoutonChoisir}>Choisir un fichier</Text></View>
        {fichier && (
          <View style={styles.fichierSelectionne}>
            <Text style={styles.iconeFichier}>📄</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.nomFichier} numberOfLines={1}>{fichier.nom}</Text>
              {fichier.taille !== undefined && <Text style={styles.tailleFichier}>{(fichier.taille / 1024 / 1024).toFixed(1)} Mo</Text>}
            </View>
            <Pressable onPress={() => setFichier(null)}><Text style={styles.retirerFichier}>✕</Text></Pressable>
          </View>
        )}
      </Pressable>

      <Text style={styles.section}>⚙️ Paramètres d'importation</Text>
      <Text style={styles.sousTitreSection}>Ces informations aideront à classer correctement les chants importés.</Text>
      <Text style={styles.label}>Catégorie liturgique par défaut</Text>
      <TextInput style={styles.champ} value={categorieDefaut} onChangeText={setCategorieDefaut} />
      <Text style={styles.label}>Langue principale</Text>
      <SelectModal label="Langue principale" value={langue} options={LANGUES_IMPORT} onChange={setLangue} />
      <Text style={styles.label}>Occasions (ex: Noël, Mariage, Pâques...)</Text>
      <TextInput style={styles.champ} placeholder="Funérailles, Confirmation…" value={occasions} onChangeText={setOccasions} />
      <Text style={styles.label}>Auteur / Compositeur par défaut</Text>
      <TextInput style={styles.champ} placeholder="Ex: Chants de l'Emmanuel" value={auteur} onChangeText={setAuteur} />

      {enCours ? (
        <ActivityIndicator style={{ marginTop: 24 }} size="large" color="#2563eb" />
      ) : (
        <Bouton titre="📥 Importer et analyser" onPress={analyser} desactive={!fichier} />
      )}

      <Text style={styles.titreComment}>Comment fonctionne l'import ?</Text>
      {CARTES_EXPLICATION.map((c) => (
        <View key={c.titre} style={styles.carteExplication}>
          <Text style={styles.iconeExplication}>{c.icone}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.titreExplication}>{c.titre}</Text>
            <Text style={styles.texteExplication}>{c.texte}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  conteneur: { flex: 1, backgroundColor: "#eef2f9" },
  filDAriane: { fontSize: 12, color: "#64748b" },
  titrePage: { fontSize: 20, fontWeight: "800", color: "#1F4A7C", marginTop: 2 },
  sousTitrePage: { fontSize: 12, color: "#64748b", marginTop: 4, marginBottom: 14 },
  carteFormat: { flexDirection: "row", gap: 12, backgroundColor: "#fff", borderRadius: 12, padding: 14, alignItems: "center", marginBottom: 16, borderWidth: 1, borderColor: "#e2e8f0" },
  iconeFormat: { fontSize: 22, backgroundColor: "#eaf0fa", width: 40, height: 40, textAlign: "center", textAlignVertical: "center", borderRadius: 8 },
  titreFormat: { fontWeight: "700", fontSize: 12, color: "#0f172a" },
  texteFormat: { fontSize: 11, color: "#64748b" },
  zoneFichier: { borderWidth: 2, borderColor: "#cbd5e1", borderStyle: "dashed", borderRadius: 16, padding: 24, alignItems: "center", backgroundColor: "#fff", marginBottom: 20 },
  iconeZoneFichier: { fontSize: 40, marginBottom: 8 },
  titreZoneFichier: { fontSize: 15, color: "#1e293b", fontWeight: "600" },
  ouTexte: { fontSize: 12, color: "#64748b", marginVertical: 6 },
  boutonChoisir: { backgroundColor: "#2563eb", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  texteBoutonChoisir: { color: "#fff", fontWeight: "600", fontSize: 13 },
  fichierSelectionne: { flexDirection: "row", gap: 10, alignItems: "center", marginTop: 16, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 8, padding: 12, width: "100%" },
  iconeFichier: { fontSize: 20 },
  nomFichier: { fontWeight: "600", fontSize: 12, color: "#0f172a" },
  tailleFichier: { fontSize: 11, color: "#64748b" },
  retirerFichier: { color: "#ef4444", fontSize: 16 },
  section: { fontSize: 14, fontWeight: "700", color: "#1e293b", marginTop: 4, marginBottom: 2 },
  sousTitreSection: { fontSize: 11, color: "#64748b", marginBottom: 10 },
  label: { fontSize: 12, color: "#64748b", marginBottom: 4, marginTop: 6 },
  champ: { borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 8, padding: 10, backgroundColor: "#fff", marginBottom: 4 },
  titreComment: { fontSize: 15, color: "#475569", fontWeight: "700", marginTop: 28, marginBottom: 12 },
  carteExplication: { flexDirection: "row", gap: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, padding: 14, marginBottom: 10 },
  iconeExplication: { fontSize: 20, backgroundColor: "#f1f5f9", width: 40, height: 40, textAlign: "center", textAlignVertical: "center", borderRadius: 8 },
  titreExplication: { fontSize: 12, fontWeight: "700", color: "#1F4A7C", marginBottom: 2 },
  texteExplication: { fontSize: 11, color: "#64748b", lineHeight: 16 },
  titreListe: { fontSize: 14, color: "#64748b", marginBottom: 8 },
  cartesStats: { flexDirection: "row", gap: 8, marginBottom: 12 },
  carteStatImport: { flex: 1, backgroundColor: "#fff", borderRadius: 10, padding: 8, alignItems: "center" },
  nombreStatImport: { fontSize: 16, fontWeight: "800", color: "#1e293b" },
  labelStatImport: { fontSize: 9, color: "#64748b", marginTop: 2, textAlign: "center" },
  ligneToutSelectionner: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  texteToutSelectionner: { fontSize: 12, fontWeight: "600", color: "#334155" },
  carteLigne: { backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 8 },
  enteteLigne: { flexDirection: "row", alignItems: "center", gap: 10 },
  champTitre: { flex: 1, fontSize: 14, fontWeight: "600", color: "#1e293b", padding: 4 },
  iconeActionLigne: { fontSize: 16 },
  sousInfoLigne: { fontSize: 11, color: "#94a3b8", marginTop: 4, marginLeft: 26 },
  barreConfiance: { height: 6, backgroundColor: "#e2e8f0", borderRadius: 3, marginTop: 8, overflow: "hidden" },
  barreRemplie: { height: "100%" },
  labelConfiance: { fontSize: 11, marginTop: 4, fontWeight: "600" },
  doublon: { fontSize: 11, color: "#d97706", marginTop: 4 },
  barreBas: { flexDirection: "row", gap: 10, padding: 16, position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#eef2f9" },
  conteneurEdition: { flex: 1, backgroundColor: "#eef2f9", padding: 16, paddingTop: 50 },
  titreEdition: { fontSize: 17, fontWeight: "800", color: "#1F4A7C", marginBottom: 14 },
  rangeeBoutonsEdition: { flexDirection: "row", gap: 10, paddingTop: 10 },
  champMulti: { minHeight: 80, textAlignVertical: "top" },
});
