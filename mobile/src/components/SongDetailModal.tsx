import { useEffect, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import * as Clipboard from "expo-clipboard";
import { Chant, ChantCreate, ChantMedia, Meta } from "../types";
import {
  creerChant, modifierChant, supprimerChant,
  listerMediasChant, ajouterMediaChant, supprimerMediaChant, telechargerMediaChant,
  getPartitionActive, getPartitionSoumiseParMaChorale, uploaderPartition, telechargerPartition, Partition,
} from "../api/chants";
import { demanderSuppression } from "../api/moderation";
import { ApiError } from "../api/client";
import { ajouterAOutbox, versChant } from "../storage/chantsOutbox";
import { useIdentite } from "../context/IdentiteContext";
import { categorieLabel, NOMS_LANGUES, etatChant, LABEL_ETAT, COULEUR_ETAT } from "../utils/labels";
import Bouton from "./Bouton";
import ChantMediaPlayer from "./ChantMediaPlayer";

interface Props {
  visible: boolean;
  chant: Chant | null;
  meta: Meta | null;
  estSuperAdmin: boolean;
  ouvrirEnEdition?: boolean;
  onClose: () => void;
  onChange: (chant: Chant) => void;
  onCreated?: (chant: Chant) => void;
  onDelete: (chantId: number) => void;
}

const VIDE = { titre: "", categorie: "Autre", refrain: "", couplets: "", remarques: "" };

const LABEL_STATUT_PARTITION: Record<Partition["statut"], string> = {
  a_verifier: "En attente de validation",
  validee: "Validée",
  revoquee: "Révoquée",
};

// Porté de backend/app/slugify.py::slugify -- juste pour nommer le fichier
// exporté, pas besoin de l'unicité par suffixe (unique_slug), un seul
// fichier local temporaire à la fois.
function slugifyLocal(titre: string): string {
  const normalise = titre.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const minuscule = normalise.toLowerCase();
  const tirets = minuscule.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return tirets || "chant";
}

function texteExportChant(chant: Chant): string {
  return `Titre: ${chant.titre}\nCatégorie: ${categorieLabel(chant.categorie)}\nRéf: ${chant.code_reference || ""}\n`
    + `Langue: ${chant.langue || ""}\nOccasions: ${(chant.occasions || []).join(", ")}\n\n`
    + `Refrain:\n${chant.refrain || ""}\n\nCouplets:\n${(chant.couplets || []).join("\n\n")}`;
}

function htmlImpressionChant(chant: Chant): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<html><head><meta charset="utf-8"><style>
    body { font-family: sans-serif; padding: 24px; line-height: 1.6; }
    h1 { border-bottom: 2px solid #1a3c6e; padding-bottom: 10px; color: #1a3c6e; }
    .meta { font-size: 0.9rem; color: #666; margin-bottom: 20px; }
    .refrain { font-weight: bold; background: #f0f4fa; padding: 12px; border-left: 4px solid #1a3c6e; margin-bottom: 20px; white-space: pre-wrap; border-radius: 4px; }
    .couplet { margin-bottom: 15px; white-space: pre-wrap; }
    .couplet-num { font-weight: bold; color: #1a3c6e; margin-right: 5px; }
  </style></head><body>
    <h1>${esc(chant.titre)}</h1>
    <div class="meta">
      <strong>Catégorie :</strong> ${esc(categorieLabel(chant.categorie))} |
      <strong>Référence :</strong> ${esc(chant.code_reference || "N/A")} |
      <strong>Langue :</strong> ${esc(NOMS_LANGUES[chant.langue] || chant.langue || "Français")}
    </div>
    ${chant.refrain ? `<div class="refrain"><strong>Refrain :</strong><br>${esc(chant.refrain)}</div>` : ""}
    ${(chant.couplets || []).map((c, i) => `<div class="couplet"><span class="couplet-num">${i + 1}.</span>${esc(c)}</div>`).join("")}
  </body></html>`;
}

export default function SongDetailModal({
  visible, chant, meta, estSuperAdmin, ouvrirEnEdition, onClose, onChange, onCreated, onDelete,
}: Props) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { identite } = useIdentite();
  const modeCreation = visible && !chant;
  const [modeEdition, setModeEdition] = useState(false);
  const [modeDemandeSuppression, setModeDemandeSuppression] = useState(false);
  const [raisonSuppression, setRaisonSuppression] = useState("");
  const [enCours, setEnCours] = useState(false);

  const [titre, setTitre] = useState("");
  const [categorie, setCategorie] = useState("");
  const [refrain, setRefrain] = useState("");
  const [couplets, setCouplets] = useState("");
  const [remarques, setRemarques] = useState("");
  const [codeReference, setCodeReference] = useState("");
  const [occasions, setOccasions] = useState("");
  const [motsCles, setMotsCles] = useState("");
  const [referencesBibliques, setReferencesBibliques] = useState("");
  const [tonalite, setTonalite] = useState("");
  const [dureeEstimee, setDureeEstimee] = useState("");
  // Un seul champ combiné, comme le web (edit-dyn-auteur) -- écrit la même
  // valeur dans auteur ET compositeur, voir le repli chant.auteur ||
  // chant.compositeur utilisé partout ailleurs pour l'affichage.
  const [auteurCompositeur, setAuteurCompositeur] = useState("");

  const [medias, setMedias] = useState<ChantMedia[]>([]);
  const [envoiMediaEnCours, setEnvoiMediaEnCours] = useState<"audio" | "video" | null>(null);
  const [lecteur, setLecteur] = useState<{ type: "audio" | "video"; uri: string | null; chargement: boolean; erreur: string | null } | null>(null);

  const [partitionActive, setPartitionActive] = useState<Partition | null>(null);
  const [partitionMienne, setPartitionMienne] = useState<Partition | null>(null);
  const [envoiPartitionEnCours, setEnvoiPartitionEnCours] = useState(false);
  const [actionEnCours, setActionEnCours] = useState<string | null>(null);

  useEffect(() => {
    if (chant && visible) {
      listerMediasChant(chant.id).then(setMedias).catch(() => setMedias([]));
      getPartitionActive(chant.id).then(setPartitionActive).catch(() => setPartitionActive(null));
      if (!estSuperAdmin) {
        getPartitionSoumiseParMaChorale(chant.id).then(setPartitionMienne).catch(() => setPartitionMienne(null));
      } else {
        setPartitionMienne(null);
      }
    } else {
      setMedias([]);
      setPartitionActive(null);
      setPartitionMienne(null);
    }
  }, [chant, visible, estSuperAdmin]);

  async function ajouterMedia(type: "audio" | "video") {
    const resultat = await DocumentPicker.getDocumentAsync({ type: type === "audio" ? "audio/*" : "video/*" });
    if (resultat.canceled || !resultat.assets?.[0] || !chant) return;
    const asset = resultat.assets[0];
    setEnvoiMediaEnCours(type);
    try {
      const media = await ajouterMediaChant(chant.id, type, asset.uri, asset.name, asset.mimeType ?? `${type}/*`);
      setMedias((prev) => [...prev, media]);
      if (media.statut === "a_verifier") {
        Alert.alert("Envoyé", "Ce fichier sera visible des autres chorales une fois validé par l'administrateur.");
      }
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible d'envoyer ce fichier");
    } finally {
      setEnvoiMediaEnCours(null);
    }
  }

  async function lireMedia(media: ChantMedia) {
    if (!chant) return;
    setLecteur({ type: media.type, uri: null, chargement: true, erreur: null });
    try {
      const uri = await telechargerMediaChant(chant.id, media);
      setLecteur({ type: media.type, uri, chargement: false, erreur: null });
    } catch {
      setLecteur({ type: media.type, uri: null, chargement: false, erreur: "Impossible de télécharger ce fichier." });
    }
  }

  // Comme le web (_cdMediaPeutSupprimer) : seul l'auteur du média (sa
  // chorale) ou un super-admin peut le retirer -- le bouton n'est même pas
  // affiché pour les autres, plutôt que de compter sur le seul rejet serveur.
  function peutSupprimerMedia(media: ChantMedia): boolean {
    if (estSuperAdmin) return true;
    return media.chorale_id != null && media.chorale_id === identite?.compte_id;
  }

  function confirmerSuppressionMedia(media: ChantMedia) {
    if (!chant) return;
    Alert.alert("Supprimer ce média ?", undefined, [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer", style: "destructive", onPress: async () => {
          try {
            await supprimerMediaChant(chant.id, media.id);
            setMedias((prev) => prev.filter((m) => m.id !== media.id));
          } catch (erreur: any) {
            Alert.alert("Erreur", erreur?.message ?? "Suppression non autorisée");
          }
        },
      },
    ]);
  }

  async function ajouterPartition() {
    if (!chant) return;
    const resultat = await DocumentPicker.getDocumentAsync({ type: "application/pdf" });
    if (resultat.canceled || !resultat.assets?.[0]) return;
    const asset = resultat.assets[0];
    setEnvoiPartitionEnCours(true);
    try {
      const partition = await uploaderPartition(chant.id, asset.uri, asset.name, asset.mimeType ?? "application/pdf");
      if (partition.statut === "validee") setPartitionActive(partition);
      else setPartitionMienne(partition);
      Alert.alert("Partition envoyée", estSuperAdmin ? "Partition publiée." : "Elle sera visible de tous après validation par un administrateur.");
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible d'envoyer cette partition");
    } finally {
      setEnvoiPartitionEnCours(false);
    }
  }

  async function ouvrirPartition() {
    if (!chant) return;
    setActionEnCours("partition");
    try {
      const uri = await telechargerPartition(chant.id);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
    } catch {
      Alert.alert("Erreur", "Impossible d'ouvrir cette partition.");
    } finally {
      setActionEnCours(null);
    }
  }

  useEffect(() => {
    if (chant) {
      setTitre(chant.titre);
      setCategorie(chant.categorie);
      setRefrain(chant.refrain ?? "");
      setCouplets(chant.couplets.join("\n\n"));
      setRemarques(chant.remarques ?? "");
      setAuteurCompositeur(chant.auteur ?? chant.compositeur ?? "");
      setCodeReference(chant.code_reference ?? "");
      setOccasions((chant.occasions ?? []).join(", "));
      setMotsCles((chant.mots_cles ?? []).join(", "));
      setReferencesBibliques((chant.references_bibliques ?? []).join(", "));
      setTonalite(chant.tonalite ?? "");
      setDureeEstimee(chant.duree_estimee ?? "");
      setModeEdition(!!ouvrirEnEdition);
    } else if (modeCreation) {
      setTitre(VIDE.titre); setCategorie(VIDE.categorie); setRefrain(VIDE.refrain);
      setCouplets(VIDE.couplets); setRemarques(VIDE.remarques); setAuteurCompositeur("");
      setCodeReference(""); setOccasions(""); setMotsCles(""); setReferencesBibliques(""); setTonalite(""); setDureeEstimee("");
      setModeEdition(true);
    }
    setModeDemandeSuppression(false);
    setRaisonSuppression("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chant, visible]);

  if (!visible) return null;

  function listeVirgule(valeur: string): string[] {
    return valeur.split(",").map((v) => v.trim()).filter(Boolean);
  }

  async function enregistrer() {
    setEnCours(true);
    try {
      const couvertsListe = couplets.split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);
      const auteurValeur = auteurCompositeur.trim() || null;
      const champsCommuns = {
        code_reference: codeReference.trim() || null,
        occasions: listeVirgule(occasions),
        mots_cles: listeVirgule(motsCles),
        references_bibliques: listeVirgule(referencesBibliques),
        tonalite: tonalite.trim() || null,
        duree_estimee: dureeEstimee.trim() || null,
      };
      if (modeCreation) {
        const payload: ChantCreate = {
          titre: titre.trim(), categorie, refrain: refrain.trim() || null, couplets: couvertsListe,
          langue: "fr", actif: true, favori: false,
          chant_principal: false, remarques: remarques.trim() || null,
          auteur: auteurValeur, compositeur: auteurValeur, slug: null,
          ...champsCommuns,
        };
        try {
          const cree = await creerChant(payload);
          onCreated?.(cree);
          // Un chant ajouté par une chorale reste privé (visible seulement
          // d'elle) tant qu'un administrateur ne l'a pas publié -- sauf si
          // l'admin a activé la publication automatique (voir Administration).
          if (!estSuperAdmin && cree.visibilite === "chorale") {
            Alert.alert(
              "Chant enregistré",
              "Il n'est visible que par votre chorale pour l'instant, en attente de publication par l'administrateur.",
            );
          }
        } catch (erreurReseau) {
          // Pas d'ApiError = échec réseau (pas d'erreur serveur) -- on met en
          // file d'attente locale, la synchronisation (voir storage/sync.ts)
          // l'enverra à la bibliothèque partagée dès le retour du réseau.
          if (erreurReseau instanceof ApiError) throw erreurReseau;
          // idLocal vient de l'entrée outbox elle-même (pas recalculé ici) --
          // sinon un id "placeholder" différent de celui réellement stocké
          // dans l'outbox rendrait ce chant introuvable par getChant/
          // modifierChant/supprimerChant tant qu'il reste en attente.
          const entree = await ajouterAOutbox(payload);
          onCreated?.(versChant(entree));
          Alert.alert("Enregistré hors-ligne", "Ce chant sera envoyé à la bibliothèque partagée dès que la connexion sera rétablie.");
        }
      } else if (chant) {
        const misAJour = await modifierChant(chant.id, {
          titre: titre.trim(), categorie, refrain: refrain.trim() || null, couplets: couvertsListe,
          remarques: remarques.trim() || null, auteur: auteurValeur, compositeur: auteurValeur,
          ...champsCommuns,
        });
        onChange(misAJour);
        setModeEdition(false);
      }
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible d'enregistrer");
    } finally {
      setEnCours(false);
    }
  }

  async function confirmerSuppressionSuper() {
    if (!chant) return;
    Alert.alert("Supprimer ce chant ?", "Cette action est irréversible.", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer", style: "destructive", onPress: async () => {
          setEnCours(true);
          try {
            await supprimerChant(chant.id);
            onDelete(chant.id);
          } catch (erreur: any) {
            Alert.alert("Erreur", erreur?.message ?? "Impossible de supprimer");
          } finally {
            setEnCours(false);
          }
        },
      },
    ]);
  }

  async function basculerArchive() {
    if (!chant) return;
    setActionEnCours("archive");
    try {
      const misAJour = await modifierChant(chant.id, { actif: chant.actif === false });
      onChange(misAJour);
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible de mettre à jour l'état");
    } finally {
      setActionEnCours(null);
    }
  }

  async function envoyerDemandeSuppression() {
    if (!chant || !raisonSuppression.trim()) return;
    setEnCours(true);
    try {
      const resultat = await demanderSuppression("chant", chant.id, raisonSuppression.trim());
      setModeDemandeSuppression(false);
      Alert.alert(
        "enAttente" in resultat ? "Mise en attente" : "Demande envoyée",
        "enAttente" in resultat
          ? "Pas de connexion -- la demande sera envoyée dès le retour du réseau."
          : "Le super-admin va examiner ta demande.",
      );
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible d'envoyer la demande");
    } finally {
      setEnCours(false);
    }
  }

  async function exporterTxt() {
    if (!chant) return;
    setActionEnCours("exporter");
    try {
      const dest = `${FileSystem.cacheDirectory}${slugifyLocal(chant.titre)}.txt`;
      await FileSystem.writeAsStringAsync(dest, texteExportChant(chant));
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(dest, { mimeType: "text/plain" });
    } catch {
      Alert.alert("Erreur", "Impossible d'exporter ce chant.");
    } finally {
      setActionEnCours(null);
    }
  }

  async function imprimer() {
    if (!chant) return;
    setActionEnCours("imprimer");
    try {
      await Print.printAsync({ html: htmlImpressionChant(chant) });
    } catch {
      // L'utilisateur peut simplement avoir annulé la boîte de dialogue --
      // pas la peine d'afficher une alerte d'erreur dans ce cas.
    } finally {
      setActionEnCours(null);
    }
  }

  async function copierParoles() {
    if (!chant) return;
    const texte = [chant.refrain, ...chant.couplets].filter(Boolean).join("\n\n");
    await Clipboard.setStringAsync(texte);
    Alert.alert("Copié", "Les paroles ont été copiées dans le presse-papiers.");
  }

  function composerAvecCeChant() {
    if (!chant) return;
    onClose();
    navigation.navigate("Composer");
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={styles.fond}>
        <View style={styles.feuille}>
          <ScrollView
            contentContainerStyle={[styles.contenu, { paddingBottom: 24 + insets.bottom }]}
            keyboardShouldPersistTaps="handled"
          >
            {modeEdition ? (
              <>
                <Text style={styles.titrePrincipal}>{modeCreation ? "Ajouter un chant" : "Modifier le chant"}</Text>
                <Text style={styles.label}>Titre</Text>
                <TextInput style={styles.champ} value={titre} onChangeText={setTitre} />
                <Text style={styles.label}>Catégorie</Text>
                <TextInput style={styles.champ} value={categorie} onChangeText={setCategorie} />
                <Text style={styles.label}>Référence</Text>
                <TextInput style={styles.champ} value={codeReference} onChangeText={setCodeReference} placeholder="Ex: AL 123" />
                <Text style={styles.label}>Tonalité</Text>
                <TextInput style={styles.champ} value={tonalite} onChangeText={setTonalite} placeholder="Ex: Ré majeur" />
                <Text style={styles.label}>Durée estimée</Text>
                <TextInput style={styles.champ} value={dureeEstimee} onChangeText={setDureeEstimee} placeholder="Ex: 3 min" />
                <Text style={styles.label}>Occasions (séparées par une virgule)</Text>
                <TextInput style={styles.champ} value={occasions} onChangeText={setOccasions} placeholder="Ex: Messe, Mariage" />
                <Text style={styles.label}>Mots-clés (séparés par une virgule)</Text>
                <TextInput style={styles.champ} value={motsCles} onChangeText={setMotsCles} />
                <Text style={styles.label}>Références bibliques (séparées par une virgule)</Text>
                <TextInput
                  style={styles.champ} value={referencesBibliques} onChangeText={setReferencesBibliques}
                  placeholder="Ex: Mt 17, 1-9"
                />
                <Text style={styles.aideChamp}>
                  Sert à faire ressortir ce chant quand ses paroles collent aux lectures d'un jour donné (voir 📖 Lectures du jour).
                </Text>
                <Text style={styles.label}>Auteur / Compositeur</Text>
                <TextInput style={styles.champ} value={auteurCompositeur} onChangeText={setAuteurCompositeur} />
                <Text style={styles.label}>Refrain</Text>
                <TextInput style={[styles.champ, styles.champMulti]} value={refrain} onChangeText={setRefrain} multiline />
                <Text style={styles.label}>Couplets (séparés par une ligne vide)</Text>
                <TextInput style={[styles.champ, styles.champMulti]} value={couplets} onChangeText={setCouplets} multiline />
                <Text style={styles.label}>Remarques</Text>
                <TextInput style={[styles.champ, styles.champMulti]} value={remarques} onChangeText={setRemarques} multiline />
                <View style={styles.rangeeBoutons}>
                  <View style={styles.boutonMoitie}><Bouton titre="Annuler" variante="contour" onPress={modeCreation ? onClose : () => setModeEdition(false)} /></View>
                  <View style={styles.boutonMoitie}><Bouton titre="Enregistrer" onPress={enregistrer} enCours={enCours} desactive={!titre.trim()} /></View>
                </View>
              </>
            ) : modeDemandeSuppression ? (
              <>
                <Text style={styles.titrePrincipal}>Demander la suppression</Text>
                <Text style={styles.label}>Pourquoi ce chant devrait-il être supprimé ?</Text>
                <TextInput
                  style={[styles.champ, styles.champMulti]}
                  value={raisonSuppression}
                  onChangeText={setRaisonSuppression}
                  multiline
                  placeholder="Raison..."
                />
                <View style={styles.rangeeBoutons}>
                  <View style={styles.boutonMoitie}><Bouton titre="Annuler" variante="contour" onPress={() => setModeDemandeSuppression(false)} /></View>
                  <View style={styles.boutonMoitie}>
                    <Bouton titre="Envoyer" onPress={envoyerDemandeSuppression} enCours={enCours} desactive={!raisonSuppression.trim()} />
                  </View>
                </View>
              </>
            ) : chant ? (
              <>
                <Text style={styles.titrePrincipal}>{chant.titre}</Text>
                <Text style={styles.sousInfo}>
                  {chant.categorie} · {(NOMS_LANGUES[chant.langue] || chant.langue).toUpperCase()}
                  {chant.tonalite ? ` · ${chant.tonalite}` : ""}
                  {chant.duree_estimee ? ` · ${chant.duree_estimee}` : ""}
                  {chant.actif === false ? " · Archivé" : ""}
                </Text>
                {chant.visibilite === "chorale" && (
                  <Text style={styles.notePriveChant}>
                    🔒 {chant.chorale_proprietaire_nom ? `Ajouté par ${chant.chorale_proprietaire_nom}` : "Chant privé"} — pas encore publié pour toute la communauté.
                  </Text>
                )}
                {(chant.auteur || chant.compositeur) && (
                  <Text style={styles.auteurTexte}>Auteur : {chant.auteur || chant.compositeur}</Text>
                )}
                {(!!chant.code_reference || (chant.occasions?.length ?? 0) > 0 || (chant.mots_cles?.length ?? 0) > 0 || (chant.references_bibliques?.length ?? 0) > 0) && (
                  <View style={styles.blocMeta}>
                    {!!chant.code_reference && <Text style={styles.ligneMeta}>Référence : {chant.code_reference}</Text>}
                    {(chant.occasions?.length ?? 0) > 0 && <Text style={styles.ligneMeta}>Occasions : {chant.occasions.join(", ")}</Text>}
                    {(chant.mots_cles?.length ?? 0) > 0 && <Text style={styles.ligneMeta}>Mots-clés : {chant.mots_cles.join(", ")}</Text>}
                    {(chant.references_bibliques?.length ?? 0) > 0 && <Text style={styles.ligneMeta}>📖 Références bibliques : {chant.references_bibliques.join(", ")}</Text>}
                  </View>
                )}
                {chant.refrain ? (
                  <>
                    <Text style={styles.label}>Refrain</Text>
                    <Text style={styles.texte}>{chant.refrain}</Text>
                  </>
                ) : null}
                {chant.couplets.map((c, i) => (
                  <View key={i}>
                    <Text style={styles.label}>Couplet {i + 1}</Text>
                    <Text style={styles.texte}>{c}</Text>
                  </View>
                ))}
                {chant.remarques ? (
                  <>
                    <Text style={styles.label}>Remarques</Text>
                    <Text style={styles.texte}>{chant.remarques}</Text>
                  </>
                ) : null}

                {/* Réservé au super-admin -- score de confiance, état de
                    validation, origine (import/manuel), proposé par : des
                    informations de modération, pas des paroles à chanter,
                    sans intérêt (voire confuses) pour une chorale. */}
                {estSuperAdmin && (
                  <View style={styles.blocTechnique}>
                    <Text style={styles.titreTechnique}>🛡️ Informations techniques (admin)</Text>
                    <View style={styles.ligneTechnique}>
                      <Text style={styles.libelleTechnique}>État</Text>
                      <Text style={[styles.valeurTechnique, { color: COULEUR_ETAT[etatChant(chant)] }]}>{LABEL_ETAT[etatChant(chant)]}</Text>
                    </View>
                    <View style={styles.ligneTechnique}>
                      <Text style={styles.libelleTechnique}>Score de confiance</Text>
                      <Text style={styles.valeurTechnique}>{Math.round(chant.confiance * 100)}%</Text>
                    </View>
                    <View style={styles.ligneTechnique}>
                      <Text style={styles.libelleTechnique}>Origine</Text>
                      <Text style={styles.valeurTechnique}>{chant.source_file ? chant.source_file.replace(/_/g, " ").replace(/\.[^/.]+$/, "") : "Ajout manuel"}</Text>
                    </View>
                    {!!chant.propose_par_chorale_nom && (
                      <View style={styles.ligneTechnique}>
                        <Text style={styles.libelleTechnique}>Proposé par</Text>
                        <Text style={styles.valeurTechnique}>{chant.propose_par_chorale_nom}</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Actions rapides -- exporter/imprimer/copier/composer,
                    équivalent des boutons du détail chant web */}
                <View style={styles.rangeeActionsRapides}>
                  <Pressable style={styles.actionRapide} onPress={exporterTxt} disabled={actionEnCours === "exporter"}>
                    <Text style={styles.texteActionRapide}>{actionEnCours === "exporter" ? "…" : "⬇️ Exporter"}</Text>
                  </Pressable>
                  <Pressable style={styles.actionRapide} onPress={imprimer} disabled={actionEnCours === "imprimer"}>
                    <Text style={styles.texteActionRapide}>{actionEnCours === "imprimer" ? "…" : "🖨️ Imprimer"}</Text>
                  </Pressable>
                  <Pressable style={styles.actionRapide} onPress={copierParoles}>
                    <Text style={styles.texteActionRapide}>📋 Copier</Text>
                  </Pressable>
                  <Pressable style={styles.actionRapide} onPress={composerAvecCeChant}>
                    <Text style={styles.texteActionRapide}>✍ Composer</Text>
                  </Pressable>
                </View>

                <Text style={styles.label}>📄 Partition</Text>
                {partitionActive ? (
                  <View style={styles.ligneMedia}>
                    <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }} onPress={ouvrirPartition} disabled={actionEnCours === "partition"}>
                      <Text style={styles.iconeMedia}>📄</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.nomMedia}>Partition publiée</Text>
                        {!!partitionActive.chorale_nom && <Text style={styles.sousNomMedia}>Ajoutée par {partitionActive.chorale_nom}</Text>}
                      </View>
                      <Text style={styles.lienMedia}>{actionEnCours === "partition" ? "…" : "▶ Ouvrir"}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text style={styles.texteMediaVide}>Aucune partition publiée pour ce chant.</Text>
                )}
                {partitionMienne && partitionMienne.statut !== "validee" && (
                  <Text style={styles.notePartitionAttente}>
                    Ta soumission est {LABEL_STATUT_PARTITION[partitionMienne.statut].toLowerCase()}.
                  </Text>
                )}
                <Pressable style={styles.boutonMediaAjout} onPress={ajouterPartition} disabled={envoiPartitionEnCours}>
                  <Text style={styles.texteBoutonMediaAjout}>{envoiPartitionEnCours ? "Envoi..." : "📄 Soumettre une partition (PDF)"}</Text>
                </Pressable>

                <Text style={styles.label}>🎧 Audio / Vidéo</Text>
                {medias.length === 0 ? (
                  <Text style={styles.texteMediaVide}>Aucun audio/vidéo pour ce chant.</Text>
                ) : (
                  medias.map((m) => (
                    <View key={m.id} style={styles.ligneMedia}>
                      <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }} onPress={() => lireMedia(m)}>
                        <Text style={styles.iconeMedia}>{m.type === "audio" ? "🎵" : "🎥"}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.nomMedia} numberOfLines={1}>{m.filename}</Text>
                          {!!m.chorale_nom && (
                            <Text style={styles.sousNomMedia}>
                              {m.chorale_nom}{m.statut === "a_verifier" ? " · ⏳ en attente de validation" : ""}
                            </Text>
                          )}
                        </View>
                        <Text style={styles.lienMedia}>▶ Lire</Text>
                      </Pressable>
                      {peutSupprimerMedia(m) && (
                        <Pressable onPress={() => confirmerSuppressionMedia(m)} hitSlop={8}>
                          <Text style={styles.supprimerMedia}>🗑️</Text>
                        </Pressable>
                      )}
                    </View>
                  ))
                )}
                <View style={styles.rangeeMediaBoutons}>
                  <Pressable style={styles.boutonMediaAjout} onPress={() => ajouterMedia("audio")} disabled={envoiMediaEnCours !== null}>
                    <Text style={styles.texteBoutonMediaAjout}>{envoiMediaEnCours === "audio" ? "Envoi..." : "🎵 Ajouter un audio"}</Text>
                  </Pressable>
                  <Pressable style={styles.boutonMediaAjout} onPress={() => ajouterMedia("video")} disabled={envoiMediaEnCours !== null}>
                    <Text style={styles.texteBoutonMediaAjout}>{envoiMediaEnCours === "video" ? "Envoi..." : "🎥 Ajouter une vidéo"}</Text>
                  </Pressable>
                </View>

                <View style={styles.rangeeBoutons}>
                  <View style={styles.boutonMoitie}><Bouton titre="Fermer" variante="contour" onPress={onClose} /></View>
                  {estSuperAdmin ? (
                    <View style={styles.boutonMoitie}><Bouton titre="Modifier" onPress={() => setModeEdition(true)} /></View>
                  ) : (
                    <View style={styles.boutonMoitie}>
                      <Bouton titre="Demander suppression" variante="contour" onPress={() => setModeDemandeSuppression(true)} />
                    </View>
                  )}
                </View>
                {estSuperAdmin && (
                  <View style={styles.rangeeBoutons}>
                    <View style={styles.boutonMoitie}>
                      <Bouton
                        titre={chant.actif === false ? "Restaurer" : "Archiver"}
                        variante="contour"
                        onPress={basculerArchive}
                        enCours={actionEnCours === "archive"}
                      />
                    </View>
                    <View style={styles.boutonMoitie}>
                      <Bouton titre="Supprimer définitivement" variante="contour" onPress={confirmerSuppressionSuper} enCours={enCours} />
                    </View>
                  </View>
                )}
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
      {lecteur && (
        <ChantMediaPlayer
          visible={!!lecteur}
          type={lecteur.type}
          uri={lecteur.uri}
          chargement={lecteur.chargement}
          erreur={lecteur.erreur}
          onFermer={() => setLecteur(null)}
        />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  fond: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)", justifyContent: "flex-end" },
  feuille: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "88%" },
  contenu: { padding: 24 },
  titrePrincipal: { fontSize: 22, fontWeight: "700", color: "#1e293b", marginBottom: 4 },
  sousInfo: { fontSize: 13, color: "#64748b", marginBottom: 16 },
  auteurTexte: { fontSize: 13, color: "#64748b", fontStyle: "italic", marginTop: -12, marginBottom: 16 },
  notePriveChant: { fontSize: 12, color: "#7c3aed", fontWeight: "600", marginBottom: 10 },
  blocMeta: { backgroundColor: "#f8fafc", borderRadius: 10, padding: 10, marginBottom: 16, gap: 3 },
  ligneMeta: { fontSize: 12, color: "#475569" },
  blocTechnique: { backgroundColor: "#fef2f2", borderRadius: 10, padding: 12, marginTop: 16, borderWidth: 1, borderColor: "#fecaca" },
  titreTechnique: { fontSize: 11, fontWeight: "700", color: "#991b1b", marginBottom: 6, textTransform: "uppercase" },
  ligneTechnique: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  libelleTechnique: { fontSize: 12, color: "#7f1d1d" },
  valeurTechnique: { fontSize: 12, fontWeight: "700", color: "#1e293b" },
  label: { fontSize: 12, fontWeight: "600", color: "#94a3b8", marginTop: 14, marginBottom: 4, textTransform: "uppercase" },
  aideChamp: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  texte: { fontSize: 15, color: "#334155", lineHeight: 22 },
  champ: { borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 10, padding: 12, fontSize: 15, backgroundColor: "#fafcff" },
  champMulti: { minHeight: 80, textAlignVertical: "top" },
  rangeeBoutons: { flexDirection: "row", gap: 10, marginTop: 20 },
  boutonMoitie: { flex: 1 },
  rangeeActionsRapides: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  actionRapide: { backgroundColor: "#eef2f9", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  texteActionRapide: { fontSize: 12, fontWeight: "600", color: "#2563eb" },
  texteMediaVide: { fontSize: 13, color: "#94a3b8", fontStyle: "italic" },
  notePartitionAttente: { fontSize: 12, color: "#b45309", fontStyle: "italic", marginTop: 4 },
  ligneMedia: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f8fafc", borderRadius: 10, padding: 10, marginBottom: 6 },
  iconeMedia: { fontSize: 16 },
  nomMedia: { fontSize: 13, fontWeight: "600", color: "#1e293b" },
  sousNomMedia: { fontSize: 11, color: "#94a3b8" },
  lienMedia: { fontSize: 12, color: "#2563eb", fontWeight: "700" },
  supprimerMedia: { fontSize: 15, paddingHorizontal: 4 },
  rangeeMediaBoutons: { flexDirection: "row", gap: 8, marginTop: 4 },
  boutonMediaAjout: { flex: 1, backgroundColor: "#eef2f9", borderRadius: 8, paddingVertical: 10, alignItems: "center", marginTop: 4 },
  texteBoutonMediaAjout: { fontSize: 12, fontWeight: "600", color: "#2563eb" },
});
