import { useEffect, useState } from "react";
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Chant, ChantCreate, Meta } from "../types";
import { creerChant, modifierChant, supprimerChant } from "../api/chants";
import { demanderSuppression } from "../api/moderation";
import { ApiError } from "../api/client";
import { ajouterAOutbox } from "../storage/chantsOutbox";
import Bouton from "./Bouton";

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

export default function SongDetailModal({
  visible, chant, meta, estSuperAdmin, ouvrirEnEdition, onClose, onChange, onCreated, onDelete,
}: Props) {
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

  useEffect(() => {
    if (chant) {
      setTitre(chant.titre);
      setCategorie(chant.categorie);
      setRefrain(chant.refrain ?? "");
      setCouplets(chant.couplets.join("\n\n"));
      setRemarques(chant.remarques ?? "");
      setModeEdition(!!ouvrirEnEdition);
    } else if (modeCreation) {
      setTitre(VIDE.titre); setCategorie(VIDE.categorie); setRefrain(VIDE.refrain);
      setCouplets(VIDE.couplets); setRemarques(VIDE.remarques);
      setModeEdition(true);
    }
    setModeDemandeSuppression(false);
    setRaisonSuppression("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chant, visible]);

  if (!visible) return null;

  async function enregistrer() {
    setEnCours(true);
    try {
      const couvertsListe = couplets.split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);
      if (modeCreation) {
        const payload: ChantCreate = {
          titre: titre.trim(), categorie, refrain: refrain.trim() || null, couplets: couvertsListe,
          code_reference: null, langue: "fr", occasions: [], mots_cles: [], actif: true, favori: false,
          chant_principal: false, duree_estimee: null, tonalite: null, remarques: remarques.trim() || null, slug: null,
        };
        try {
          const cree = await creerChant(payload);
          onCreated?.(cree);
        } catch (erreurReseau) {
          // Pas d'ApiError = échec réseau (pas d'erreur serveur) -- on met en
          // file d'attente locale, la synchronisation (voir storage/sync.ts)
          // l'enverra à la bibliothèque partagée dès le retour du réseau.
          if (erreurReseau instanceof ApiError) throw erreurReseau;
          await ajouterAOutbox(payload);
          const localPlaceholder: Chant = {
            ...payload, id: -Date.now(), source_file: null, confiance: 1,
          };
          onCreated?.(localPlaceholder);
          Alert.alert("Enregistré hors-ligne", "Ce chant sera envoyé à la bibliothèque partagée dès que la connexion sera rétablie.");
        }
      } else if (chant) {
        const misAJour = await modifierChant(chant.id, {
          titre: titre.trim(), categorie, refrain: refrain.trim() || null, couplets: couvertsListe,
          remarques: remarques.trim() || null,
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

  async function envoyerDemandeSuppression() {
    if (!chant || !raisonSuppression.trim()) return;
    setEnCours(true);
    try {
      await demanderSuppression("chant", chant.id, raisonSuppression.trim());
      setModeDemandeSuppression(false);
      Alert.alert("Demande envoyée", "Le super-admin va examiner ta demande.");
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible d'envoyer la demande");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={styles.fond}>
        <View style={styles.feuille}>
          <ScrollView contentContainerStyle={styles.contenu} keyboardShouldPersistTaps="handled">
            {modeEdition ? (
              <>
                <Text style={styles.titrePrincipal}>{modeCreation ? "Ajouter un chant" : "Modifier le chant"}</Text>
                <Text style={styles.label}>Titre</Text>
                <TextInput style={styles.champ} value={titre} onChangeText={setTitre} />
                <Text style={styles.label}>Catégorie</Text>
                <TextInput style={styles.champ} value={categorie} onChangeText={setCategorie} />
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
                <Text style={styles.sousInfo}>{chant.categorie} · {chant.langue.toUpperCase()}{chant.tonalite ? ` · ${chant.tonalite}` : ""}</Text>
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
                  <View style={{ marginTop: 10 }}>
                    <Bouton titre="Supprimer définitivement" variante="contour" onPress={confirmerSuppressionSuper} enCours={enCours} />
                  </View>
                )}
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fond: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)", justifyContent: "flex-end" },
  feuille: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "88%" },
  contenu: { padding: 24 },
  titrePrincipal: { fontSize: 22, fontWeight: "700", color: "#1e293b", marginBottom: 4 },
  sousInfo: { fontSize: 13, color: "#64748b", marginBottom: 16 },
  label: { fontSize: 12, fontWeight: "600", color: "#94a3b8", marginTop: 14, marginBottom: 4, textTransform: "uppercase" },
  texte: { fontSize: 15, color: "#334155", lineHeight: 22 },
  champ: { borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 10, padding: 12, fontSize: 15, backgroundColor: "#fafcff" },
  champMulti: { minHeight: 80, textAlignVertical: "top" },
  rangeeBoutons: { flexDirection: "row", gap: 10, marginTop: 20 },
  boutonMoitie: { flex: 1 },
});
