import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  getParametres, sauvegarderParametres, listerMedias, urlImageActive, urlMedia,
  uploaderEtActiverImage, activerImageDuPool, retirerImage, telechargerApercuPdf, ImageSlot, Media,
} from "../api/parametres";
import { jetonAuthorizationHeader } from "../api/client";
import { entrainerModele } from "../api/ml";
import { supprimerTouteLaBibliotheque, rechercherChants } from "../api/chants";
import { synchroniserBibliotheque, dernieresSyncLe } from "../storage/sync";
import { lireOutbox } from "../storage/chantsOutbox";
import PdfViewer from "../components/PdfViewer";
import Bouton from "../components/Bouton";

const SLOTS: { cle: ImageSlot; label: string }[] = [
  { cle: "logo_gauche", label: "Logo gauche" },
  { cle: "logo_droit", label: "Logo droit" },
  { cle: "banniere_bas", label: "Bannière décorative en bas de page" },
];

export default function ReglagesScreen() {
  const insets = useSafeAreaInsets();
  const [chorale, setChorale] = useState("");
  const [paroisse, setParoisse] = useState("");
  const [contact, setContact] = useState("");
  const [annonce, setAnnonce] = useState("");
  const [priereDefaut, setPriereDefaut] = useState("");
  const [chargement, setChargement] = useState(true);
  const [rafraichissement, setRafraichissement] = useState(false);
  const [entetesAuth, setEntetesAuth] = useState<Record<string, string>>({});
  const [pickerSlot, setPickerSlot] = useState<ImageSlot | null>(null);
  const [medias, setMedias] = useState<Media[]>([]);
  const [confirmationSuppression, setConfirmationSuppression] = useState("");
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);
  const [onePageMode, setOnePageMode] = useState(false);
  const [apercuVisible, setApercuVisible] = useState(false);
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [pdfChargement, setPdfChargement] = useState(false);
  const [syncBibliotheque, setSyncBibliotheque] = useState(true);
  const [syncEnCours, setSyncEnCours] = useState(false);
  const [derniereSync, setDerniereSync] = useState<string | null>(null);
  const [enAttenteOutbox, setEnAttenteOutbox] = useState(0);
  // Aperçu local instantané pendant l'envoi -- le web voit son image tout de
  // suite (data URI côté navigateur) ; sans ça, mobile n'affichait le
  // nouveau logo/bannière qu'une fois l'upload terminé, ce qui semblait figé
  // sur une connexion lente.
  const [apercusLocaux, setApercusLocaux] = useState<Partial<Record<ImageSlot, string>>>({});
  const [slotsEnEnvoi, setSlotsEnEnvoi] = useState<Set<ImageSlot>>(new Set());
  const timerAuto = useRef<ReturnType<typeof setTimeout> | null>(null);

  const charger = async () => {
    const data = await getParametres();
    setChorale(data.chorale ?? "");
    setParoisse(data.paroisse ?? "");
    setContact(data.contact ?? "");
    setAnnonce(data.annonce ?? "");
    setPriereDefaut(data.priere_defaut ?? "");
    setSyncBibliotheque(data.sync_bibliotheque_partagee !== false);
    setDerniereSync(await dernieresSyncLe());
    setEnAttenteOutbox((await lireOutbox()).length);
  };

  useEffect(() => {
    jetonAuthorizationHeader().then(setEntetesAuth);
    charger().finally(async () => {
      setChargement(false);
      // Sync silencieuse et best-effort à l'ouverture des Réglages si la
      // chorale a consenti -- pas d'Alert ici (contrairement au bouton
      // manuel), un échec réseau reste invisible et sera retenté plus tard.
      const data = await getParametres().catch(() => null);
      if (data?.sync_bibliotheque_partagee !== false) {
        synchroniserBibliotheque()
          .then(async () => {
            setDerniereSync(await dernieresSyncLe());
            setEnAttenteOutbox((await lireOutbox()).length);
          })
          .catch(() => {});
      }
    });
  }, []);

  function planifierAutosave() {
    if (timerAuto.current) clearTimeout(timerAuto.current);
    timerAuto.current = setTimeout(() => {
      sauvegarderParametres({ chorale, paroisse, contact, annonce, priere_defaut: priereDefaut }).catch(() => {});
    }, 1000);
  }

  useEffect(() => {
    if (chargement) return;
    planifierAutosave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chorale, paroisse, contact, annonce, priereDefaut]);

  async function enregistrerInformations() {
    try {
      await sauvegarderParametres({ chorale, paroisse, contact, annonce });
      Alert.alert("Enregistré", "Les informations générales ont été mises à jour.");
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible d'enregistrer");
    }
  }

  async function enregistrerPriere() {
    try {
      await sauvegarderParametres({ priere_defaut: priereDefaut });
      Alert.alert("Enregistré", "Le texte de la prière a été mis à jour.");
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible d'enregistrer");
    }
  }

  async function onRafraichir() {
    setRafraichissement(true);
    await charger();
    setRafraichissement(false);
  }

  async function choisirDepuisAppareil(slot: ImageSlot) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission refusée", "Autorise l'accès aux photos pour changer cette image.");
      return;
    }
    const resultat = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (resultat.canceled || !resultat.assets[0]) return;
    const asset = resultat.assets[0];
    setApercusLocaux((prev) => ({ ...prev, [slot]: asset.uri }));
    setSlotsEnEnvoi((prev) => new Set(prev).add(slot));
    try {
      await uploaderEtActiverImage(slot, asset.uri, asset.fileName ?? "image.jpg", asset.mimeType ?? "image/jpeg");
      setEntetesAuth({ ...entetesAuth }); // force le re-rendu de l'<Image> (nouvelle image active)
    } catch (erreur: any) {
      setApercusLocaux((prev) => { const suivant = { ...prev }; delete suivant[slot]; return suivant; });
      Alert.alert("Erreur", erreur?.message ?? "Impossible d'envoyer l'image");
    } finally {
      setSlotsEnEnvoi((prev) => { const suivant = new Set(prev); suivant.delete(slot); return suivant; });
    }
  }

  async function ouvrirPickerPool(slot: ImageSlot) {
    setPickerSlot(slot);
    try {
      const liste = await listerMedias(slot.startsWith("logo") ? "logo" : "banniere");
      setMedias(liste);
    } catch {
      setMedias([]);
    }
  }

  async function choisirDuPool(mediaId: number) {
    if (!pickerSlot) return;
    try {
      await activerImageDuPool(pickerSlot, mediaId);
      // Comme choisirDepuisAppareil/onRetirer : sans ça, l'<Image> du slot ne
      // se rafraîchissait pas tant que l'écran n'était pas rouvert (l'URI de
      // urlImageActive() ne change pas, RN garde l'ancienne image en cache).
      setApercusLocaux((prev) => { const suivant = { ...prev }; delete suivant[pickerSlot]; return suivant; });
      setEntetesAuth({ ...entetesAuth });
      setPickerSlot(null);
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible d'activer cette image");
    }
  }

  async function onRetirer(slot: ImageSlot) {
    try {
      await retirerImage(slot);
      setEntetesAuth({ ...entetesAuth });
    } catch {
      // pas d'image active -- rien à faire
    }
  }

  async function reentrainer() {
    try {
      const res: any = await entrainerModele();
      Alert.alert("Modèle réentraîné", `Terminé (${res?.echantillons ?? "?"} exemples).`);
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Échec de l'entraînement");
    }
  }

  // Comme le web (app.js::btn-reset-bibliotheque, qui télécharge
  // depliantapp_dataset_export.json avant l'appel DELETE) : une sauvegarde
  // JSON est générée et proposée via la feuille de partage native AVANT la
  // suppression définitive -- les erreurs de manipulation sur écran tactile
  // sont fréquentes, cette sauvegarde est le seul filet de sécurité.
  async function viderLaBibliotheque() {
    if (confirmationSuppression !== "SUPPRIMER") return;
    Alert.alert("Confirmer", "Toute la bibliothèque de chants va être supprimée. Une sauvegarde JSON va d'abord t'être proposée. Continuer ?", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer tout", style: "destructive", onPress: async () => {
          setSuppressionEnCours(true);
          try {
            const backupChants = await rechercherChants({ limit: 100000 });
            const dest = `${FileSystem.cacheDirectory}depliantapp_dataset_export_${Date.now()}.json`;
            await FileSystem.writeAsStringAsync(dest, JSON.stringify(backupChants, null, 2));
            const partageDisponible = await Sharing.isAvailableAsync();
            if (!partageDisponible) {
              Alert.alert("Sauvegarde impossible", "Le partage de fichier n'est pas disponible sur cet appareil -- suppression annulée par sécurité.");
              return;
            }
            await Sharing.shareAsync(dest, { mimeType: "application/json", dialogTitle: "Sauvegarder la bibliothèque avant suppression" });
            await supprimerTouteLaBibliotheque();
            setConfirmationSuppression("");
            Alert.alert("Terminé", "La bibliothèque a été vidée (sauvegarde JSON proposée juste avant).");
          } catch (erreur: any) {
            Alert.alert("Erreur", erreur?.message ?? "Échec de la suppression");
          } finally {
            setSuppressionEnCours(false);
          }
        },
      },
    ]);
  }

  async function changerSyncBibliotheque(valeur: boolean) {
    setSyncBibliotheque(valeur);
    try {
      await sauvegarderParametres({ sync_bibliotheque_partagee: valeur });
      if (valeur) synchroniserMaintenant();
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible d'enregistrer ce réglage");
    }
  }

  async function synchroniserMaintenant() {
    setSyncEnCours(true);
    try {
      const resultat = await synchroniserBibliotheque();
      setDerniereSync(await dernieresSyncLe());
      setEnAttenteOutbox((await lireOutbox()).length);
      Alert.alert(
        "Synchronisation terminée",
        `${resultat.tires} chant(s) à jour dans la bibliothèque locale.` +
          (resultat.pousses > 0 ? `\n${resultat.pousses} chant(s) créé(s) hors-ligne envoyé(s).` : "") +
          (resultat.doublonsEvites > 0 ? `\n${resultat.doublonsEvites} doublon(s) évité(s).` : ""),
      );
    } catch {
      Alert.alert("Hors-ligne", "La synchronisation nécessite une connexion internet. Réessaie plus tard.");
    } finally {
      setSyncEnCours(false);
    }
  }

  async function voirApercuReel() {
    setApercuVisible(true);
    setPdfChargement(true);
    setPdfUri(null);
    try {
      const { uri } = await telechargerApercuPdf({ one_page_mode: onePageMode });
      setPdfUri(uri);
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible de générer l'aperçu");
      setApercuVisible(false);
    } finally {
      setPdfChargement(false);
    }
  }

  if (chargement) return <ActivityIndicator style={{ flex: 1 }} size="large" />;

  return (
    <ScrollView
      style={styles.fond}
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={rafraichissement} onRefresh={onRafraichir} tintColor="#2563eb" />}
    >
      <Text style={styles.section}>⚙️ Informations générales</Text>
      <Text style={styles.label}>Nom de la chorale</Text>
      <TextInput style={styles.champ} placeholder="Ex: Chorale Sainte Cécile" value={chorale} onChangeText={setChorale} />
      <Text style={styles.label}>Première ligne / CTA</Text>
      <TextInput style={styles.champ} placeholder="Ex: Paroisse Saint Jean / CCB Saint Paul" value={paroisse} onChangeText={setParoisse} />
      <Text style={styles.label}>Contact (téléphone, affiché en pied de feuillet)</Text>
      <TextInput style={styles.champ} placeholder="Ex: Tél. +226 xx xx xx xx" value={contact} onChangeText={setContact} />
      <Text style={styles.label}>Annonce (bannière, bas de page gauche)</Text>
      <TextInput style={styles.champ} placeholder="Ex: Bon dimanche à tous !" value={annonce} onChangeText={setAnnonce} />
      <Bouton titre="Enregistrer les informations" onPress={enregistrerInformations} />

      <Text style={styles.section}>🖼️ Images du feuillet</Text>
      <Text style={styles.hint}>logo à gauche, logo à droite, et bannière décorative en bas de page.</Text>
      {SLOTS.map(({ cle, label }) => (
        <View key={cle} style={styles.carteImage}>
          <Text style={styles.labelImage}>{label}</Text>
          <View>
            <Image
              source={apercusLocaux[cle] ? { uri: apercusLocaux[cle] } : { uri: urlImageActive(cle), headers: entetesAuth }}
              style={styles.imagePreview}
              resizeMode="contain"
              onError={() => {}}
            />
            {slotsEnEnvoi.has(cle) && (
              <View style={styles.voileEnvoi}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.texteVoileEnvoi}>Envoi...</Text>
              </View>
            )}
          </View>
          <View style={styles.actionsImage}>
            <Pressable style={styles.actionImage} onPress={() => choisirDepuisAppareil(cle)}>
              <Text style={styles.texteActionImage}>Téléverser</Text>
            </Pressable>
            <Pressable style={styles.actionImage} onPress={() => ouvrirPickerPool(cle)}>
              <Text style={styles.texteActionImage}>Depuis la bibliothèque</Text>
            </Pressable>
            <Pressable style={styles.actionImage} onPress={() => onRetirer(cle)}>
              <Text style={[styles.texteActionImage, { color: "#dc2626" }]}>Retirer</Text>
            </Pressable>
          </View>
        </View>
      ))}

      <Text style={styles.section}>🙏 Prière pour le Burkina Faso (texte par défaut)</Text>
      <Text style={styles.hint}>
        Utilisé quand un feuillet active le widget « Prière » sans texte personnalisé. Un texte spécifique saisi dans le Composer primera sur cette valeur.
      </Text>
      <Text style={styles.label}>Texte de la prière</Text>
      <TextInput
        style={[styles.champ, styles.champMulti]}
        value={priereDefaut}
        onChangeText={setPriereDefaut}
        multiline
        placeholder="Laisser vide pour utiliser le texte par défaut."
      />
      <Text style={styles.compteurCaracteres}>{priereDefaut.length} caractères</Text>
      <Bouton titre="Enregistrer la prière" onPress={enregistrerPriere} />

      <Text style={styles.section}>🧠 Modèle d'auto-catégorisation</Text>
      <Text style={styles.hint}>Le modèle apprend à partir des chants validés. Ré-entraîne-le après des corrections pour améliorer les suggestions de catégories.</Text>
      <Bouton titre="Ré-entraîner le modèle" variante="contour" onPress={reentrainer} />

      <Text style={styles.section}>📄 Aperçu réel du feuillet</Text>
      <View style={styles.rangeeOption}>
        <Pressable style={[styles.toggleFormat, !onePageMode && styles.toggleFormatActif]} onPress={() => setOnePageMode(false)}>
          <Text style={[styles.texteToggleFormat, !onePageMode && styles.texteToggleFormatActif]}>2 pages</Text>
        </Pressable>
        <Pressable style={[styles.toggleFormat, onePageMode && styles.toggleFormatActif]} onPress={() => setOnePageMode(true)}>
          <Text style={[styles.texteToggleFormat, onePageMode && styles.texteToggleFormatActif]}>1 page landscape</Text>
        </Pressable>
      </View>
      <Bouton titre="👁️ Voir l'aperçu" variante="contour" onPress={voirApercuReel} />

      <Text style={styles.section}>🔄 Synchronisation hors-ligne</Text>
      <Text style={styles.hint}>
        L'application fonctionne entièrement hors-ligne. Ce réglage contrôle si la bibliothèque partagée de chants (toutes chorales confondues) est
        téléchargée pour un usage sans connexion, et si les chants ajoutés hors-ligne sont ensuite envoyés vers cette bibliothèque commune -- avec
        détection automatique des doublons pour éviter qu'un même chant soit créé deux fois.
      </Text>
      <Pressable style={styles.ligneToggle} onPress={() => changerSyncBibliotheque(!syncBibliotheque)}>
        <View style={{ flex: 1 }}>
          <Text style={styles.labelToggle}>Accepter la synchronisation des chants de la bibliothèque partagée</Text>
          <Text style={styles.sousLabelToggle}>Synchronisation bidirectionnelle activée par défaut</Text>
        </View>
        <View style={[styles.interrupteur, syncBibliotheque && styles.interrupteurActif]}>
          <View style={[styles.poucePastille, syncBibliotheque && styles.poucePastilleActive]} />
        </View>
      </Pressable>
      {enAttenteOutbox > 0 && (
        <Text style={styles.hint}>{enAttenteOutbox} chant(s) créé(s) hors-ligne en attente d'envoi.</Text>
      )}
      <Text style={styles.hint}>
        {derniereSync ? `Dernière synchronisation : ${new Date(derniereSync).toLocaleString("fr-FR")}` : "Jamais synchronisé."}
      </Text>
      <Bouton
        titre={syncEnCours ? "Synchronisation..." : "🔄 Synchroniser maintenant"}
        variante="contour"
        onPress={synchroniserMaintenant}
        desactive={syncEnCours || !syncBibliotheque}
      />

      <Text style={[styles.section, { color: "#dc2626" }]}>⚠️ Zone dangereuse</Text>
      <Text style={styles.hint}>
        Supprime définitivement TOUS les chants de la bibliothèque -- utile pour repartir d'une base propre avant un nouvel import. Les feuillets déjà générés ne sont pas affectés.
      </Text>
      <TextInput
        style={styles.champ}
        placeholder="Tape SUPPRIMER pour confirmer"
        value={confirmationSuppression}
        onChangeText={setConfirmationSuppression}
        autoCapitalize="characters"
      />
      <Bouton
        titre="Vider la bibliothèque" variante="contour" onPress={viderLaBibliotheque}
        enCours={suppressionEnCours} desactive={confirmationSuppression !== "SUPPRIMER"}
      />

      <Modal visible={!!pickerSlot} animationType="slide" onRequestClose={() => setPickerSlot(null)}>
        <View style={styles.conteneurPicker}>
          <Text style={styles.titrePicker}>Choisir une image</Text>
          <FlatList
            data={medias}
            keyExtractor={(m) => String(m.id)}
            numColumns={3}
            contentContainerStyle={{ padding: 12 }}
            renderItem={({ item }) => (
              <Pressable style={styles.vignette} onPress={() => choisirDuPool(item.id)}>
                <Image source={{ uri: urlMedia(item.id), headers: entetesAuth }} style={styles.vignetteImage} resizeMode="cover" />
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.vide}>Aucune image disponible</Text>}
          />
          <Pressable style={[styles.fermerPicker, { paddingBottom: 16 + insets.bottom }]} onPress={() => setPickerSlot(null)}>
            <Text style={styles.texteFermerPicker}>Fermer</Text>
          </Pressable>
        </View>
      </Modal>

      <Modal visible={apercuVisible} animationType="slide" onRequestClose={() => setApercuVisible(false)}>
        <PdfViewer uri={pdfUri} chargement={pdfChargement} erreur={null} onFermer={() => setApercuVisible(false)} />
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fond: { backgroundColor: "#eef2f9" },
  scroll: { padding: 16, paddingBottom: 40 },
  section: { fontSize: 15, fontWeight: "700", color: "#1e293b", marginTop: 18, marginBottom: 8 },
  hint: { fontSize: 11, color: "#94a3b8", marginBottom: 8 },
  label: { fontSize: 12, color: "#64748b", marginBottom: 4 },
  champ: { borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 10, padding: 12, fontSize: 14, backgroundColor: "#fff", marginBottom: 10 },
  champMulti: { minHeight: 90, textAlignVertical: "top" },
  compteurCaracteres: { fontSize: 11, color: "#94a3b8", textAlign: "right", marginTop: -6, marginBottom: 10 },
  carteImage: { backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 10 },
  labelImage: { fontSize: 13, fontWeight: "600", color: "#334155", marginBottom: 8 },
  imagePreview: { width: "100%", height: 80, backgroundColor: "#f1f5f9", borderRadius: 8 },
  voileEnvoi: {
    ...StyleSheet.absoluteFillObject, borderRadius: 8, backgroundColor: "rgba(15,23,42,0.55)",
    alignItems: "center", justifyContent: "center", gap: 4,
  },
  texteVoileEnvoi: { color: "#fff", fontSize: 11, fontWeight: "600" },
  actionsImage: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 10 },
  actionImage: {},
  texteActionImage: { color: "#2563eb", fontSize: 12, fontWeight: "600" },
  rangeeOption: { flexDirection: "row", gap: 8, marginBottom: 10 },
  toggleFormat: { flex: 1, alignItems: "center", paddingVertical: 8, backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: "#dbe2ea" },
  toggleFormatActif: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  texteToggleFormat: { fontSize: 12, color: "#475569", fontWeight: "600" },
  texteToggleFormatActif: { color: "#fff" },
  conteneurPicker: { flex: 1, backgroundColor: "#fff", paddingTop: 50 },
  titrePicker: { fontSize: 16, fontWeight: "700", textAlign: "center", marginBottom: 8 },
  vignette: { flex: 1 / 3, aspectRatio: 1, margin: 4, backgroundColor: "#f1f5f9", borderRadius: 8, overflow: "hidden" },
  vignetteImage: { width: "100%", height: "100%" },
  vide: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
  fermerPicker: { padding: 16, alignItems: "center", borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  texteFermerPicker: { color: "#dc2626", fontWeight: "600" },
  ligneToggle: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10 },
  labelToggle: { fontSize: 13, fontWeight: "600", color: "#1e293b" },
  sousLabelToggle: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  interrupteur: { width: 46, height: 26, borderRadius: 13, backgroundColor: "#e2e8f0", padding: 3, justifyContent: "center" },
  interrupteurActif: { backgroundColor: "#2563eb" },
  poucePastille: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },
  poucePastilleActive: { alignSelf: "flex-end" },
});
