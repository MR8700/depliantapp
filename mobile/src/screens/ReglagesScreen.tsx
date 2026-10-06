import { useCallback, useEffect, useRef, useState } from "react";
import { Feuillet } from "../types";
import MeasurementBridge, { MeasurementBridgeHandle } from "../components/MeasurementBridge";
import { genererPdfFeuilletLocal } from "../render/genererPdfLocal";
import { lireFeuilletsLocaux, compterFeuilletsProduits } from "../storage/feuilletsLocal";
import {
  ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import {
  getParametres, sauvegarderParametres, listerMedias, urlImageActive, urlMedia,
  uploaderEtActiverImage, activerImageDuPool, retirerImage, telechargerApercuPdf, ImageSlot, Media,
  getImageActiveLocale, definirImageActiveLocale, retirerImageActiveLocale,
} from "../api/parametres";
import { jetonAuthorizationHeader } from "../api/client";
import { entrainerModele } from "../api/ml";
import { supprimerTouteLaBibliotheque, rechercherChants } from "../api/chants";
import { getLicenceLocale, LicenceLocale } from "../storage/secureStore";
import { pinDefini, effacerPin } from "../licence/pinChorale";
import { useIdentite } from "../context/IdentiteContext";
import PdfViewer from "../components/PdfViewer";
import Bouton from "../components/Bouton";
import { contacterAdminWhatsApp } from "../utils/contactAdmin";

const SLOTS: { cle: ImageSlot; label: string }[] = [
  { cle: "logo_gauche", label: "Logo gauche" },
  { cle: "logo_droit", label: "Logo droit" },
  { cle: "banniere_bas", label: "Bannière décorative en bas de page" },
];

// Miroir de backend/app/routers/parametres.py::preview_settings_pdf --
// utilisé pour l'aperçu réglages d'une chorale 100% locale quand elle n'a
// encore aucun dépliant (voir voirApercuReel ci-dessous).
const MOMENTS_FACTICES = [
  { moment: "Entrée", type: "texte_libre" as const, titre_libre: "Chant d'Entrée", texte_libre: "Refrain :\nPrends Seigneur et reçois,\ntoutes nos vies et nos joies.\n\nCouplet 1 :\nVoici le pain et le vin de nos terres.\nVoici le fruit de notre travail." },
  { moment: "Kyrie", type: "texte_libre" as const, titre_libre: "Kyrie eleison", texte_libre: "Kyrie eleison, Christe eleison, Kyrie eleison." },
  { moment: "Offertoire", type: "texte_libre" as const, titre_libre: "Apporte ton offrande", texte_libre: "Refrain :\nApporte ton offrande, devant l'autel,\ncar le Seigneur t'appelle à partager." },
  { moment: "Communion", type: "texte_libre" as const, titre_libre: "Pain de Vie", texte_libre: "Refrain :\nPain de Vie, Sang de l'Alliance,\nforce et joie de notre marche.\n\nCouplet 1 :\nTu nous donnes ta vie en partage.\nTu nous donnes ton pain pour la route." },
  { moment: "Envoi", type: "texte_libre" as const, titre_libre: "Vierge Marie", texte_libre: "Refrain :\nRegarde l'étoile, invoque Marie,\nsi tu la suis, tu ne crains rien." },
];

function feuilletApercuFactice(onePageMode: boolean): Feuillet {
  return {
    id: 0, date: "2026-07-13", lieu: "Paroisse Saint Esprit",
    lectures: { premiere_lecture: "1 Co 12, 12-31", psaume: "Ps 99", deuxieme_lecture: null, evangile: "Lc 4, 14-21" },
    moments: MOMENTS_FACTICES, priere_active: true,
    priere_texte: "Seigneur, nous te prions pour la paix dans notre pays et dans le monde entier.",
    taille_texte_manuelle: null, one_page_mode: onePageMode, banniere_active: true,
    chorale_id: null, clone_de_id: null, chorale_nom: null, visibilite: "chorale", created_at: null,
  };
}

export default function ReglagesScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { estSuperAdmin } = useIdentite();
  const [licenceInfo, setLicenceInfo] = useState<LicenceLocale | null>(null);
  const [feuilletsProduits, setFeuilletsProduits] = useState(0);
  const [pinActif, setPinActif] = useState(false);
  const [chorale, setChorale] = useState("");
  const [paroisse, setParoisse] = useState("");
  const [ccb, setCcb] = useState("");
  const [contact, setContact] = useState("");
  const [annonce, setAnnonce] = useState("");
  const [banniereSousTitre, setBanniereSousTitre] = useState("");
  const [priereTitre, setPriereTitre] = useState("");
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
  // Compte chorale (licence locale) uniquement -- images copiées en local
  // permanent, jamais uploadées (voir storage/parametresCache.ts).
  const [imagesLocales, setImagesLocales] = useState<Partial<Record<ImageSlot, string>>>({});
  // Aperçu local instantané pendant l'envoi -- le web voit son image tout de
  // suite (data URI côté navigateur) ; sans ça, mobile n'affichait le
  // nouveau logo/bannière qu'une fois l'upload terminé, ce qui semblait figé
  // sur une connexion lente.
  const [apercusLocaux, setApercusLocaux] = useState<Partial<Record<ImageSlot, string>>>({});
  const [slotsEnEnvoi, setSlotsEnEnvoi] = useState<Set<ImageSlot>>(new Set());
  const [reentrainementEnCours, setReentrainementEnCours] = useState(false);
  const bridgeMesure = useRef<MeasurementBridgeHandle>(null);
  const timerAuto = useRef<ReturnType<typeof setTimeout> | null>(null);

  const charger = async () => {
    const data = await getParametres();
    setChorale(data.chorale ?? "");
    setParoisse(data.paroisse ?? "");
    setCcb(data.ccb ?? "");
    setContact(data.contact ?? "");
    setAnnonce(data.annonce ?? "");
    setBanniereSousTitre(data.banniere_sous_titre ?? "");
    setPriereTitre(data.priere_titre ?? "");
    setPriereDefaut(data.priere_defaut ?? "");
    if (await getLicenceLocale()) {
      const entrees = await Promise.all(SLOTS.map(async ({ cle }) => [cle, await getImageActiveLocale(cle)] as const));
      setImagesLocales(Object.fromEntries(entrees.filter(([, uri]) => uri)));
    }
  };

  useEffect(() => {
    if (!estSuperAdmin) {
      getLicenceLocale().then(setLicenceInfo);
      compterFeuilletsProduits().then(setFeuilletsProduits);
    }
  }, [estSuperAdmin]);

  // useFocusEffect (pas un simple useEffect) : le statut du verrou doit se
  // rafraîchir au RETOUR depuis l'écran DefinirPin (navigation.goBack()),
  // pas seulement au premier montage de Réglages.
  useFocusEffect(
    useCallback(() => {
      if (!estSuperAdmin) pinDefini().then(setPinActif);
    }, [estSuperAdmin]),
  );

  function onDesactiverPin() {
    Alert.alert("Désactiver le verrouillage ?", "L'application ne demandera plus de code au démarrage sur cet appareil.", [
      { text: "Annuler", style: "cancel" },
      { text: "Désactiver", style: "destructive", onPress: async () => { await effacerPin(); setPinActif(false); } },
    ]);
  }

  async function contacterAdminWhatsapp() {
    await contacterAdminWhatsApp("Bonjour, je souhaite gérer mon abonnement DepliantApp.");
  }

  function gererMonAbonnement() {
    Alert.alert("Gérer mon abonnement", "Comment veux-tu contacter l'administrateur ?", [
      { text: "Annuler", style: "cancel" },
      { text: "💬 WhatsApp", onPress: contacterAdminWhatsapp },
      { text: "✉️ Messagerie interne", onPress: () => navigation.navigate("Messages") },
    ]);
  }

  useEffect(() => {
    jetonAuthorizationHeader().then(setEntetesAuth);
    charger().finally(() => setChargement(false));
  }, []);

  function planifierAutosave() {
    if (timerAuto.current) clearTimeout(timerAuto.current);
    timerAuto.current = setTimeout(() => {
      sauvegarderParametres({ chorale, paroisse, ccb, contact, annonce, banniere_sous_titre: banniereSousTitre, priere_titre: priereTitre, priere_defaut: priereDefaut }).catch(() => {});
    }, 1000);
  }

  useEffect(() => {
    if (chargement) return;
    planifierAutosave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chorale, paroisse, ccb, contact, annonce, banniereSousTitre, priereTitre, priereDefaut]);

  async function enregistrerInformations() {
    try {
      await sauvegarderParametres({ chorale, paroisse, ccb, contact, annonce, banniere_sous_titre: banniereSousTitre });
      Alert.alert("Enregistré", "Les informations générales ont été mises à jour.");
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible d'enregistrer");
    }
  }

  async function enregistrerPriere() {
    try {
      await sauvegarderParametres({ priere_titre: priereTitre, priere_defaut: priereDefaut });
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
      if (licenceInfo) {
        const dest = await definirImageActiveLocale(slot, asset.uri);
        setImagesLocales((prev) => ({ ...prev, [slot]: dest }));
      } else {
        await uploaderEtActiverImage(slot, asset.uri, asset.fileName ?? "image.jpg", asset.mimeType ?? "image/jpeg");
        setEntetesAuth({ ...entetesAuth }); // force le re-rendu de l'<Image> (nouvelle image active)
      }
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
      if (licenceInfo) {
        await retirerImageActiveLocale(slot);
        setImagesLocales((prev) => { const suivant = { ...prev }; delete suivant[slot]; return suivant; });
      } else {
        await retirerImage(slot);
        setEntetesAuth({ ...entetesAuth });
      }
    } catch {
      // pas d'image active -- rien à faire
    }
  }

  async function reentrainer() {
    setReentrainementEnCours(true);
    try {
      const res: any = await entrainerModele();
      Alert.alert("Modèle réentraîné", `Terminé (${res?.echantillons ?? "?"} exemples).`);
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Échec de l'entraînement");
    } finally {
      setReentrainementEnCours(false);
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

  // Compte chorale (licence locale) : rendu ENTIÈREMENT local, via le même
  // moteur que les vrais dépliants (render/genererPdfLocal.ts) -- sur le
  // dernier dépliant local de la chorale, ou un dépliant factice si elle
  // n'en a encore aucun (même contenu que backend/app/routers/parametres.py
  // ::preview_settings_pdf, voir feuilletApercuFactice ci-dessus). Compte
  // super-admin : comportement réseau inchangé.
  async function voirApercuReel() {
    setApercuVisible(true);
    setPdfChargement(true);
    setPdfUri(null);
    try {
      if (licenceInfo) {
        const locaux = await lireFeuilletsLocaux();
        const dernier = [...locaux].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
        const feuilletApercu: Feuillet = dernier ? { ...dernier, one_page_mode: onePageMode } : feuilletApercuFactice(onePageMode);
        const { uri } = await genererPdfFeuilletLocal(feuilletApercu, bridgeMesure.current!);
        setPdfUri(uri);
        return;
      }
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
      <Text style={styles.label}>Paroisse (titre de l'en-tête)</Text>
      <TextInput style={styles.champ} placeholder="Ex: Paroisse Saint Albert Le Grand de la Rotonde" value={paroisse} onChangeText={setParoisse} />
      <Text style={styles.label}>CCB / sous-titre paroissial</Text>
      <TextInput style={styles.champ} placeholder="Ex: CCB Saint Thomas d'Aquin" value={ccb} onChangeText={setCcb} />
      <Text style={styles.label}>Contact (téléphone, affiché en pied de feuillet)</Text>
      <TextInput style={styles.champ} placeholder="Ex: Tél. +226 xx xx xx xx" value={contact} onChangeText={setContact} />
      <Text style={styles.label}>Annonce (bannière, bas de page gauche)</Text>
      <TextInput style={styles.champ} placeholder="Ex: Bon dimanche à tous !" value={annonce} onChangeText={setAnnonce} />
      <Text style={styles.label}>Sous-titre de bannière (date / temps liturgique)</Text>
      <TextInput style={[styles.champ, styles.champMulti]} placeholder={'Ex: Dimanche 22 Mars 2026\n« Carême »'} value={banniereSousTitre} onChangeText={setBanniereSousTitre} multiline />
      <Bouton titre="Enregistrer les informations" onPress={enregistrerInformations} />

      <Text style={styles.section}>🖼️ Images du feuillet</Text>
      <Text style={styles.hint}>logo à gauche, logo à droite, et bannière décorative en bas de page.</Text>
      {SLOTS.map(({ cle, label }) => (
        <View key={cle} style={styles.carteImage}>
          <Text style={styles.labelImage}>{label}</Text>
          <View>
            <Image
              source={
                apercusLocaux[cle]
                  ? { uri: apercusLocaux[cle] }
                  : licenceInfo
                    ? (imagesLocales[cle] ? { uri: imagesLocales[cle] } : undefined)
                    : { uri: urlImageActive(cle), headers: entetesAuth }
              }
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
            {!licenceInfo && (
              <Pressable style={styles.actionImage} onPress={() => ouvrirPickerPool(cle)}>
                <Text style={styles.texteActionImage}>Depuis la bibliothèque</Text>
              </Pressable>
            )}
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
      <Text style={styles.label}>Titre de la prière</Text>
      <TextInput style={styles.champ} value={priereTitre} onChangeText={setPriereTitre} placeholder="Ex: PRIERE POUR LE BURKINA FASO" />
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

      {estSuperAdmin && (
        <>
          <Text style={styles.section}>🧠 Modèle d'auto-catégorisation</Text>
          <Text style={styles.hint}>Le modèle apprend à partir des chants validés, de toutes les chorales -- un réentraînement affecte donc les suggestions pour tout le monde à la fois, réservé à l'administrateur. Ré-entraîne-le après des corrections pour améliorer les suggestions de catégories.</Text>
          <Bouton titre="Ré-entraîner le modèle" variante="contour" onPress={reentrainer} enCours={reentrainementEnCours} />
        </>
      )}

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

      {!estSuperAdmin && (
        <>
          <Text style={styles.section}>💳 Licence</Text>
          {!licenceInfo ? (
            <Text style={styles.hint}>Aucune licence locale valide.</Text>
          ) : (() => {
            const { payload } = licenceInfo;
            const joursAvantExpiration = payload.expireLe
              ? Math.ceil((new Date(payload.expireLe).getTime() - Date.now()) / (24 * 3600 * 1000))
              : null;
            const expiree = joursAvantExpiration != null && joursAvantExpiration < 0;
            const expireBientot = joursAvantExpiration != null && joursAvantExpiration >= 0 && joursAvantExpiration <= 14;
            const quotaAtteint = payload.quotaFeuillets != null && feuilletsProduits >= payload.quotaFeuillets;
            return (
              <>
                <View style={styles.carteAbonnement}>
                  <View style={styles.ligneAbonnement}>
                    <Text style={styles.labelAbonnement}>Chorale</Text>
                    <Text style={styles.valeurAbonnement}>{payload.choraleNom}</Text>
                  </View>
                  <View style={styles.ligneAbonnement}>
                    <Text style={styles.labelAbonnement}>Appareils autorisés</Text>
                    <Text style={styles.valeurAbonnement}>{payload.devMax}</Text>
                  </View>
                  <View style={styles.ligneAbonnement}>
                    <Text style={styles.labelAbonnement}>Feuillets produits</Text>
                    <Text style={[styles.valeurAbonnement, quotaAtteint && { color: "#dc2626" }]}>
                      {feuilletsProduits}{payload.quotaFeuillets != null ? ` / ${payload.quotaFeuillets}` : " (illimité)"}
                    </Text>
                  </View>
                  <View style={styles.ligneAbonnement}>
                    <Text style={styles.labelAbonnement}>Expiration</Text>
                    <Text style={[styles.valeurAbonnement, (expiree || expireBientot) && { color: expiree ? "#dc2626" : "#d97706" }]}>
                      {payload.expireLe ?? "Aucune"}
                    </Text>
                  </View>
                </View>
                {expiree && (
                  <Text style={styles.avertissementAbonnement}>
                    ⛔ Votre licence a expiré -- contactez l'administrateur pour la renouveler.
                  </Text>
                )}
                {quotaAtteint && (
                  <Text style={styles.avertissementAbonnement}>
                    ⛔ Quota de feuillets atteint -- contactez l'administrateur pour l'augmenter.
                  </Text>
                )}
                {!expiree && expireBientot && (
                  <Text style={styles.avertissementAbonnementAttention}>
                    ⏳ Votre licence expire dans {joursAvantExpiration} jour{joursAvantExpiration !== 1 ? "s" : ""} -- pensez à la renouveler pour ne
                    pas perdre l'accès.
                  </Text>
                )}
              </>
            );
          })()}
          <Bouton titre="📱 Gérer les appareils" variante="contour" onPress={() => navigation.navigate("GestionAppareils")} />
          <Bouton titre="💬 Contacter l'administrateur" onPress={gererMonAbonnement} />

          <Text style={styles.section}>🔒 Sécurité</Text>
          <Text style={styles.hint}>
            Un code de verrouillage local protège l'accès à l'application sur cet appareil -- il n'est jamais transmis ni connu
            de l'administrateur. En cas d'oubli, il se réinitialise avec le code de licence de la chorale.
          </Text>
          {pinActif ? (
            <>
              <Bouton titre="Modifier le code" variante="contour" onPress={() => navigation.navigate("DefinirPin")} />
              <Bouton titre="Désactiver le verrouillage" variante="contour" onPress={onDesactiverPin} />
            </>
          ) : (
            <Bouton titre="Activer un code de verrouillage" variante="contour" onPress={() => navigation.navigate("DefinirPin")} />
          )}
        </>
      )}

      {estSuperAdmin && (
        <>
          {/* Supprime la bibliothèque PARTAGÉE entière (toutes chorales
              confondues) -- le backend (DELETE /chants/all) l'exige déjà
              côté serveur, cachée ici en plus pour qu'une chorale ne tombe
              jamais sur ce bouton qui échouerait de toute façon avec une
              erreur confuse. */}
          <Text style={[styles.section, { color: "#dc2626" }]}>⚠️ Zone dangereuse</Text>
          <Text style={styles.hint}>
            Supprime définitivement TOUS les chants de la bibliothèque, de toutes les chorales -- utile pour repartir d'une base propre avant un nouvel import. Les feuillets déjà générés ne sont pas affectés.
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
        </>
      )}

      <MeasurementBridge ref={bridgeMesure} />

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
  carteAbonnement: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10 },
  ligneAbonnement: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  labelAbonnement: { fontSize: 12, color: "#64748b" },
  valeurAbonnement: { fontSize: 13, fontWeight: "700", color: "#1e293b" },
  avertissementAbonnement: { fontSize: 12, color: "#dc2626", fontWeight: "600", backgroundColor: "#fee2e2", borderRadius: 10, padding: 10, marginBottom: 10 },
  avertissementAbonnementAttention: { fontSize: 12, color: "#b45309", fontWeight: "600", backgroundColor: "#fef3c7", borderRadius: 10, padding: 10, marginBottom: 10 },
  ligneToggle: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10 },
  labelToggle: { fontSize: 13, fontWeight: "600", color: "#1e293b" },
  sousLabelToggle: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  interrupteur: { width: 46, height: 26, borderRadius: 13, backgroundColor: "#e2e8f0", padding: 3, justifyContent: "center" },
  interrupteurActif: { backgroundColor: "#2563eb" },
  poucePastille: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },
  poucePastilleActive: { alignSelf: "flex-end" },
});
