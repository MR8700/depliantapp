import { useCallback, useEffect, useState } from "react";
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getMeta } from "../api/meta";
import { creerFeuillet, mettreAJourFeuillet, telechargerFeuilletPdf, getFeuillet, DepassementPdf } from "../api/feuillets";
import { getChant } from "../api/chants";
import { ApiError } from "../api/client";
import { Chant, FeuilletCreate, MomentContenu } from "../types";
import SelecteurChant from "../components/SelecteurChant";
import PdfViewer from "../components/PdfViewer";
import Bouton from "../components/Bouton";
import { categorieLabel } from "../utils/labels";

const CLE_CELEBRATION_INFO = "depliantapp.composer_celebration_info";

interface LigneMoment {
  cle: string;
  moment: string;
  special: boolean;
  ordre: number;
  type: "vide" | "chant" | "texte_libre";
  chant_id?: number;
  chant_titre?: string;
  chant_categorie?: string;
  chant_reference?: string | null;
  refrain?: string | null;
  couplets?: string[];
  titre_libre?: string;
  texte_libre?: string;
}

function ligneVersMomentContenu(l: LigneMoment): MomentContenu | null {
  if (l.type === "vide") return null;
  return {
    moment: l.moment,
    type: l.type === "chant" ? "chant" : "texte_libre",
    chant_id: l.type === "chant" ? l.chant_id : undefined,
    titre_libre: l.titre_libre || undefined,
    texte_libre: l.texte_libre || undefined,
    ordre: l.ordre,
  };
}

interface Props {
  route?: { params?: { feuilletId?: number } };
  navigation?: { setParams: (params: { feuilletId?: number }) => void };
}

export default function ComposerScreen({ route, navigation }: Props) {
  const feuilletIdAOuvrir = route?.params?.feuilletId;
  const [moments, setMoments] = useState<string[]>([]);
  const [lignes, setLignes] = useState<LigneMoment[]>([]);
  const [date, setDate] = useState("");
  const [lieu, setLieu] = useState("");
  // Champs "Informations de la célébration" -- purement cosmétiques, jamais
  // envoyés au backend (FeuilletBase n'a pas ces colonnes) : reproduit à
  // l'identique le comportement web (persistance localStorage uniquement,
  // voir finding de l'inventaire web sur ces champs).
  const [typeCelebration, setTypeCelebration] = useState("");
  const [president, setPresident] = useState("");
  const [animateur, setAnimateur] = useState("");
  const [choraleInfo, setChoraleInfo] = useState("");

  const [premiereLecture, setPremiereLecture] = useState("");
  const [psaume, setPsaume] = useState("");
  const [deuxiemeLecture, setDeuxiemeLecture] = useState("");
  const [evangile, setEvangile] = useState("");
  const [lectureCiblee, setLectureCiblee] = useState<null | "premiere" | "psaume" | "deuxieme" | "evangile">(null);

  const [priereActive, setPriereActive] = useState(false);
  const [widgetInfoChorale, setWidgetInfoChorale] = useState(false);
  const [onePageMode, setOnePageMode] = useState(false);
  const [banniereActive, setBanniereActive] = useState(true);
  const [widgetRefBibles, setWidgetRefBibles] = useState(false);
  const [priereTexte, setPriereTexte] = useState("");

  const [feuilletId, setFeuilletId] = useState<number | null>(null);
  const [ligneCiblee, setLigneCiblee] = useState<string | null>(null);
  const [enregistrementEnCours, setEnregistrementEnCours] = useState(false);
  const [apercuVisible, setApercuVisible] = useState(false);
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [pdfChargement, setPdfChargement] = useState(false);
  const [pdfErreur, setPdfErreur] = useState<DepassementPdf | null>(null);

  useEffect(() => {
    getMeta().then((meta) => {
      setMoments(meta.moments);
      if (!feuilletIdAOuvrir) {
        setLignes(meta.moments.map((m, i) => ({ cle: m, moment: m, special: false, ordre: i * 10, type: "vide" })));
      }
    }).catch(() => {});
    AsyncStorage.getItem(CLE_CELEBRATION_INFO).then((brut) => {
      if (!brut) return;
      try {
        const d = JSON.parse(brut);
        setTypeCelebration(d.typeCelebration ?? ""); setPresident(d.president ?? "");
        setAnimateur(d.animateur ?? ""); setChoraleInfo(d.choraleInfo ?? "");
      } catch {}
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(CLE_CELEBRATION_INFO, JSON.stringify({ typeCelebration, president, animateur, choraleInfo }));
  }, [typeCelebration, president, animateur, choraleInfo]);

  // Charge un feuillet existant pour édition (voir DepliantsScreen ->
  // navigation.navigate("Composer", { feuilletId })) -- attend que la liste
  // des moments fixes (meta) soit connue pour distinguer moments fixes vs
  // chants spéciaux, comme le fait la version web (modifierDepliant).
  useEffect(() => {
    if (!feuilletIdAOuvrir || moments.length === 0) return;
    (async () => {
      try {
        const f = await getFeuillet(feuilletIdAOuvrir);
        setFeuilletId(f.id);
        setDate(f.date);
        setLieu(f.lieu ?? "");
        setPremiereLecture(f.lectures.premiere_lecture ?? "");
        setPsaume(f.lectures.psaume ?? "");
        setDeuxiemeLecture(f.lectures.deuxieme_lecture ?? "");
        setEvangile(f.lectures.evangile ?? "");
        setPriereActive(f.priere_active);
        setPriereTexte(f.priere_texte ?? "");
        setOnePageMode(f.one_page_mode);
        setBanniereActive(f.banniere_active);

        const restants = new Map(f.moments.map((m) => [m.moment, m] as const));
        const lignesFixes: LigneMoment[] = moments.map((m, i) => {
          const existant = restants.get(m);
          if (existant) restants.delete(m);
          if (!existant) return { cle: m, moment: m, special: false, ordre: i * 10, type: "vide" };
          return {
            cle: m, moment: m, special: false, ordre: existant.ordre ?? i * 10,
            type: existant.type === "chant" ? "chant" : "texte_libre",
            chant_id: existant.chant_id ?? undefined,
            titre_libre: existant.titre_libre ?? undefined,
            texte_libre: existant.texte_libre ?? undefined,
          };
        });
        const lignesSpeciales: LigneMoment[] = Array.from(restants.values()).map((m) => ({
          cle: Crypto.randomUUID(), moment: m.moment, special: true, ordre: m.ordre ?? 999,
          type: m.type === "chant" ? "chant" : "texte_libre",
          chant_id: m.chant_id ?? undefined,
          titre_libre: m.titre_libre ?? undefined,
          texte_libre: m.texte_libre ?? undefined,
        }));
        const toutesLesLignes = [...lignesFixes, ...lignesSpeciales];

        await Promise.all(
          toutesLesLignes.map(async (l) => {
            if (l.type === "chant" && l.chant_id) {
              try {
                const chant = await getChant(l.chant_id);
                l.chant_titre = chant.titre;
                l.chant_categorie = chant.categorie;
                l.chant_reference = chant.code_reference;
                l.refrain = chant.refrain;
                l.couplets = chant.couplets;
              } catch { l.chant_titre = `Chant #${l.chant_id}`; }
            }
          }),
        );
        setLignes(toutesLesLignes);
      } catch {
        Alert.alert("Erreur", "Impossible de charger ce feuillet");
      }
    })();
  }, [feuilletIdAOuvrir, moments]);

  function majLigne(cle: string, patch: Partial<LigneMoment>) {
    setLignes((prev) => prev.map((l) => (l.cle === cle ? { ...l, ...patch } : l)));
  }

  function deplacer(cle: string, direction: -1 | 1) {
    setLignes((prev) => {
      const groupe = prev.filter((l) => l.special === prev.find((x) => x.cle === cle)!.special).sort((a, b) => a.ordre - b.ordre);
      const index = groupe.findIndex((l) => l.cle === cle);
      const cible = index + direction;
      if (cible < 0 || cible >= groupe.length) return prev;
      const ordreA = groupe[index].ordre;
      const ordreB = groupe[cible].ordre;
      return prev.map((l) => {
        if (l.cle === groupe[index].cle) return { ...l, ordre: ordreB };
        if (l.cle === groupe[cible].cle) return { ...l, ordre: ordreA };
        return l;
      });
    });
  }

  // Valide que la position saisie n'est pas déjà occupée par une autre ligne
  // (fixe ou spéciale) -- le web ne fait aucune vérification à ce sujet,
  // mais ça a été explicitement demandé pour éviter deux moments à la même
  // position dans le feuillet final.
  function changerOrdre(cle: string, valeurTexte: string) {
    const valeur = Number(valeurTexte);
    if (valeurTexte === "" || Number.isNaN(valeur)) return;
    const collision = lignes.some((l) => l.cle !== cle && l.ordre === valeur);
    if (collision) {
      Alert.alert("Position déjà utilisée", `La position ${valeur} est déjà occupée par un autre moment. Choisis une autre valeur.`);
      return;
    }
    majLigne(cle, { ordre: valeur });
  }

  function reinitialiserOrdre() {
    setLignes((prev) => {
      const fixes = prev.filter((l) => !l.special).sort((a, b) => a.ordre - b.ordre);
      const speciaux = prev.filter((l) => l.special);
      const map = new Map(fixes.map((l, i) => [l.cle, i * 10]));
      return prev.map((l) => (map.has(l.cle) ? { ...l, ordre: map.get(l.cle)! } : l));
    });
  }

  function trierAutomatiquement() {
    // Identique au web (trierMomentsVisuellement) : ré-applique le tri par
    // ordre courant (pas de recalcul de valeur, juste un re-rendu trié).
    setLignes((prev) => [...prev]);
  }

  function ajouterChantSpecial() {
    const cle = Crypto.randomUUID();
    const ordreMax = Math.max(0, ...lignes.map((l) => l.ordre));
    setLignes((prev) => [...prev, { cle, moment: "Chant spécial", special: true, ordre: ordreMax + 10, type: "vide" }]);
  }

  function supprimerLigne(cle: string) {
    setLignes((prev) => prev.filter((l) => l.cle !== cle));
  }

  function onChantChoisi(chant: Chant) {
    if (lectureCiblee) {
      const texte = chant.code_reference || chant.titre;
      if (lectureCiblee === "premiere") setPremiereLecture(texte);
      else if (lectureCiblee === "psaume") setPsaume(texte);
      else if (lectureCiblee === "deuxieme") setDeuxiemeLecture(texte);
      else if (lectureCiblee === "evangile") setEvangile(texte);
      setLectureCiblee(null);
      return;
    }
    if (!ligneCiblee) return;
    majLigne(ligneCiblee, {
      type: "chant", chant_id: chant.id, chant_titre: chant.titre,
      chant_categorie: chant.categorie, chant_reference: chant.code_reference,
      refrain: chant.refrain, couplets: chant.couplets,
    });
    setLigneCiblee(null);
  }

  function construirePayload(): FeuilletCreate {
    return {
      date,
      lieu: lieu || null,
      lectures: {
        premiere_lecture: premiereLecture || null,
        psaume: psaume || null,
        deuxieme_lecture: deuxiemeLecture || null,
        evangile: evangile || null,
      },
      moments: lignes.map(ligneVersMomentContenu).filter((m): m is MomentContenu => m !== null),
      priere_active: priereActive,
      priere_texte: priereTexte || null,
      taille_texte_manuelle: null,
      one_page_mode: onePageMode,
      banniere_active: banniereActive,
    };
  }

  const enregistrer = useCallback(async (): Promise<number | null> => {
    if (!date.trim()) {
      Alert.alert("Date requise", "Indique la date de la célébration avant d'enregistrer.");
      return null;
    }
    setEnregistrementEnCours(true);
    try {
      const payload = construirePayload();
      if (feuilletId === null) {
        const cree = await creerFeuillet(payload);
        setFeuilletId(cree.id);
        return cree.id;
      }
      const maj = await mettreAJourFeuillet(feuilletId, payload);
      if (maj.id !== feuilletId) setFeuilletId(maj.id);
      return maj.id;
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible d'enregistrer le feuillet");
      return null;
    } finally {
      setEnregistrementEnCours(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, lieu, premiereLecture, psaume, deuxiemeLecture, evangile, lignes, priereActive, priereTexte, onePageMode, banniereActive, feuilletId]);

  async function genererApercu() {
    const id = await enregistrer();
    if (!id) return;
    setApercuVisible(true);
    setPdfChargement(true);
    setPdfErreur(null);
    setPdfUri(null);
    try {
      const { uri } = await telechargerFeuilletPdf(id);
      setPdfUri(uri);
    } catch (erreur) {
      if (erreur instanceof ApiError && erreur.status === 409) {
        setPdfErreur(erreur.detail as DepassementPdf);
      } else {
        Alert.alert("Erreur", "Impossible de générer le PDF");
        setApercuVisible(false);
      }
    } finally {
      setPdfChargement(false);
    }
  }

  function nouveauFeuillet() {
    setFeuilletId(null);
    setDate(""); setLieu("");
    setPremiereLecture(""); setPsaume(""); setDeuxiemeLecture(""); setEvangile("");
    setPriereActive(false); setPriereTexte(""); setOnePageMode(false); setBanniereActive(true);
    setWidgetInfoChorale(false); setWidgetRefBibles(false);
    setLignes(moments.map((m, i) => ({ cle: m, moment: m, special: false, ordre: i * 10, type: "vide" })));
    navigation?.setParams({ feuilletId: undefined });
  }

  const lignesFixesTriees = lignes.filter((l) => !l.special).sort((a, b) => a.ordre - b.ordre);
  const lignesSpecialesTriees = lignes.filter((l) => l.special).sort((a, b) => a.ordre - b.ordre);

  const totalMoments = lignesFixesTriees.length;
  const momentsRemplis = lignesFixesTriees.filter((l) => l.type !== "vide").length;
  const chantsCount = lignes.filter((l) => l.type === "chant").length;

  function ligneUI(ligne: LigneMoment) {
    return (
      <View key={ligne.cle} style={styles.ligneMoment}>
        <View style={styles.ligneEntete}>
          <View style={styles.blocOrdre}>
            <Text style={styles.labelOrdre}>Ordre</Text>
            <TextInput
              key={`${ligne.cle}-${ligne.ordre}`}
              style={styles.champOrdre}
              keyboardType="number-pad"
              defaultValue={String(ligne.ordre)}
              onEndEditing={(e) => changerOrdre(ligne.cle, e.nativeEvent.text)}
            />
          </View>
          {ligne.special ? (
            <TextInput
              style={styles.champNomSpecial}
              placeholder="Nom du chant spécial (ex : Chant additionnel)"
              value={ligne.moment}
              onChangeText={(v) => majLigne(ligne.cle, { moment: v })}
            />
          ) : (
            <Text style={styles.momentTitre}>{ligne.moment}</Text>
          )}
          <View style={styles.fleches}>
            <Pressable onPress={() => deplacer(ligne.cle, -1)} hitSlop={8}><Text style={styles.fleche}>▲</Text></Pressable>
            <Pressable onPress={() => deplacer(ligne.cle, 1)} hitSlop={8}><Text style={styles.fleche}>▼</Text></Pressable>
            {ligne.special && (
              <Pressable onPress={() => supprimerLigne(ligne.cle)} hitSlop={8}><Text style={styles.supprimer}>✕</Text></Pressable>
            )}
          </View>
        </View>

        {/* Mode -- toujours visible, comme les 2 boutons radio "Bibliothèque"/
            "Ajout manuel" du web (col-mode), au lieu d'actions ponctuelles */}
        <View style={styles.rangeeMode}>
          <Pressable
            style={[styles.optionMode, ligne.type === "chant" && styles.optionModeActive]}
            onPress={() => { if (ligne.type !== "chant") majLigne(ligne.cle, { type: "chant" }); }}
          >
            <Text style={[styles.texteOptionMode, ligne.type === "chant" && styles.texteOptionModeActive]}>◉ Bibliothèque</Text>
          </Pressable>
          <Pressable
            style={[styles.optionMode, ligne.type === "texte_libre" && styles.optionModeActive]}
            onPress={() => { if (ligne.type !== "texte_libre") majLigne(ligne.cle, { type: "texte_libre" }); }}
          >
            <Text style={[styles.texteOptionMode, ligne.type === "texte_libre" && styles.texteOptionModeActive]}>◉ Ajout manuel</Text>
          </Pressable>
        </View>

        {ligne.type === "chant" && (
          <View style={styles.contenuLigne}>
            {ligne.chant_titre ? (
              <View style={styles.carteApercuChant}>
                <View style={styles.enteteApercuChant}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pillCategorieApercu}>{categorieLabel(ligne.chant_categorie)}</Text>
                    <Text style={styles.chantChoisi}>{ligne.chant_titre}</Text>
                  </View>
                  <Pressable style={styles.boutonChanger} onPress={() => setLigneCiblee(ligne.cle)}>
                    <Text style={styles.texteBoutonChanger}>Changer</Text>
                  </Pressable>
                </View>
                {!!(ligne.refrain || ligne.couplets?.[0]) && (
                  <Text style={styles.apercuChant} numberOfLines={2}>
                    {(ligne.refrain || ligne.couplets?.[0] || "").slice(0, 140)}
                  </Text>
                )}
                <View style={styles.piedApercuChant}>
                  {!!ligne.chant_reference && <Text style={styles.referenceApercu}>Réf : {ligne.chant_reference}</Text>}
                  <Pressable onPress={() => majLigne(ligne.cle, { type: "vide", chant_id: undefined, chant_titre: undefined, chant_categorie: undefined, chant_reference: undefined, refrain: undefined, couplets: undefined })}>
                    <Text style={styles.lienEffacer}>Retirer</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable style={styles.actionVide} onPress={() => setLigneCiblee(ligne.cle)}>
                <Text style={styles.texteActionVide}>📚 Choisir dans la bibliothèque</Text>
              </Pressable>
            )}
          </View>
        )}
        {ligne.type === "texte_libre" && (
          <View style={styles.contenuLigne}>
            <TextInput
              style={styles.champPetit}
              placeholder="Titre de l'élément (facultatif)"
              value={ligne.titre_libre ?? ""}
              onChangeText={(v) => majLigne(ligne.cle, { titre_libre: v })}
            />
            <TextInput
              style={[styles.champPetit, styles.champMulti]}
              placeholder="Refrain / couplets"
              value={ligne.texte_libre ?? ""}
              onChangeText={(v) => majLigne(ligne.cle, { texte_libre: v })}
              multiline
            />
            <Pressable onPress={() => majLigne(ligne.cle, { type: "vide", titre_libre: undefined, texte_libre: undefined })}>
              <Text style={styles.lienEffacer}>Retirer</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.fond} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {(feuilletId !== null || feuilletIdAOuvrir) && (
          <Pressable style={styles.nouveauFeuillet} onPress={nouveauFeuillet}>
            <Text style={styles.texteNouveauFeuillet}>+ Nouveau feuillet</Text>
          </Pressable>
        )}

        <Text style={styles.section}>ℹ️ Informations de la célébration</Text>
        <TextInput style={styles.champ} placeholder="Date * (AAAA-MM-JJ)" value={date} onChangeText={setDate} />
        <TextInput style={styles.champ} placeholder="Lieu (Paroisse Saint Pierre…)" value={lieu} onChangeText={setLieu} />
        <TextInput style={styles.champ} placeholder="Célébration (Temps ordinaire…)" value={typeCelebration} onChangeText={setTypeCelebration} />
        <TextInput style={styles.champ} placeholder="Président (Père…)" value={president} onChangeText={setPresident} />
        <TextInput style={styles.champ} placeholder="Animateur" value={animateur} onChangeText={setAnimateur} />
        <TextInput style={styles.champ} placeholder="Chorale" value={choraleInfo} onChangeText={setChoraleInfo} />

        <Text style={styles.section}>📖 Lecture du jour</Text>
        <View style={styles.rangeeLecture}>
          <TextInput style={[styles.champ, styles.champLecture]} placeholder="1ère lecture (Ex: Actes 15,1-2.22-29)" value={premiereLecture} onChangeText={setPremiereLecture} />
          <Pressable style={styles.boutonRecherche} onPress={() => setLectureCiblee("premiere")}><Text>📚</Text></Pressable>
        </View>
        <View style={styles.rangeeLecture}>
          <TextInput style={[styles.champ, styles.champLecture]} placeholder="Psaume (Ex: Psaume 66 (67))" value={psaume} onChangeText={setPsaume} />
          <Pressable style={styles.boutonRecherche} onPress={() => setLectureCiblee("psaume")}><Text>📚</Text></Pressable>
        </View>
        <View style={styles.rangeeLecture}>
          <TextInput style={[styles.champ, styles.champLecture]} placeholder="2ème lecture (Ex: Apocalypse 21)" value={deuxiemeLecture} onChangeText={setDeuxiemeLecture} />
          <Pressable style={styles.boutonRecherche} onPress={() => setLectureCiblee("deuxieme")}><Text>📚</Text></Pressable>
        </View>
        <View style={styles.rangeeLecture}>
          <TextInput style={[styles.champ, styles.champLecture]} placeholder="Évangile (Ex: Jean 14,23-29)" value={evangile} onChangeText={setEvangile} />
          <Pressable style={styles.boutonRecherche} onPress={() => setLectureCiblee("evangile")}><Text>📚</Text></Pressable>
        </View>

        <View style={styles.enteteSection}>
          <View style={{ flex: 1 }}>
            <Text style={styles.section}>Chants par moment liturgique</Text>
            <Text style={styles.sousTitreSection}>L'ordre détermine la position d'affichage dans le feuillet PDF.</Text>
          </View>
        </View>
        <View style={styles.rangeeActionsTexte}>
          <Pressable onPress={reinitialiserOrdre}><Text style={styles.actionTexte}>↺ Réinitialiser l'ordre</Text></Pressable>
          <Pressable onPress={trierAutomatiquement}><Text style={styles.actionTexte}>⇅ Trier automatiquement</Text></Pressable>
        </View>
        {lignesFixesTriees.map(ligneUI)}

        <View style={styles.enteteSection}>
          <View style={{ flex: 1 }}>
            <Text style={styles.section}>Chants spéciaux</Text>
            <Text style={styles.sousTitreSection}>Ajoute un chant ou un texte libre à une position précise, en plus des moments liturgiques ci-dessus.</Text>
          </View>
        </View>
        {lignesSpecialesTriees.map(ligneUI)}
        <Pressable style={styles.ajouterSpecial} onPress={ajouterChantSpecial}>
          <Text style={styles.texteAjouterSpecial}>➕ Ajouter un chant spécial</Text>
        </Pressable>

        <Text style={styles.section}>⚙️ Widgets PDF</Text>
        <View style={styles.ligneOption}>
          <Text style={styles.labelOption}>Prière pour le Burkina Faso{"\n"}<Text style={styles.petitTexte}>occupe la dernière colonne G2 de la page 1</Text></Text>
          <Switch value={priereActive} onValueChange={setPriereActive} />
        </View>
        <View style={styles.ligneOption}>
          <Text style={styles.labelOption}>Informations de la chorale</Text>
          <Switch value={widgetInfoChorale} onValueChange={setWidgetInfoChorale} />
        </View>
        <View style={styles.ligneOption}>
          <Text style={styles.labelOption}>Feuillet 1 page{"\n"}<Text style={styles.petitTexte}>A4 paysage unique (Couverture + Chants côte à côte)</Text></Text>
          <Switch value={onePageMode} onValueChange={setOnePageMode} />
        </View>
        <View style={styles.ligneOption}>
          <Text style={styles.labelOption}>Bannière Bon dimanche</Text>
          <Switch value={banniereActive} onValueChange={setBanniereActive} />
        </View>
        <View style={styles.ligneOption}>
          <Text style={styles.labelOption}>Afficher les références bibliques</Text>
          <Switch value={widgetRefBibles} onValueChange={setWidgetRefBibles} />
        </View>
        <TextInput
          style={[styles.champ, styles.champMulti]}
          placeholder="Texte personnalisé de la Prière (facultatif) -- laisser vide pour utiliser le texte par défaut"
          value={priereTexte}
          onChangeText={setPriereTexte}
          multiline
        />
      </ScrollView>

      {/* Barre du bas -- identique au web (composer-bottom-bar) */}
      <View style={styles.barreBas}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.infosBarre}>
          <Text style={styles.infoItem}>{chantsCount} chant{chantsCount !== 1 ? "s" : ""} sélectionné{chantsCount !== 1 ? "s" : ""}</Text>
          <Text style={styles.infoItem}>{momentsRemplis === totalMoments && totalMoments > 0 ? "🟢 Tous les moments remplis" : `🟡 Moments remplis : ${momentsRemplis}/${totalMoments}`}</Text>
        </ScrollView>
        <View style={styles.rangeeBoutonsFinal}>
          <Pressable style={styles.boutonBarre} onPress={() => enregistrer()} disabled={enregistrementEnCours}>
            <Text style={styles.texteBoutonBarre}>💾 Brouillon</Text>
          </Pressable>
          <Pressable style={styles.boutonBarre} onPress={genererApercu} disabled={enregistrementEnCours}>
            <Text style={styles.texteBoutonBarre}>📄 PDF</Text>
          </Pressable>
          <Pressable style={[styles.boutonBarre, styles.boutonBarrePrimaire]} onPress={() => enregistrer()} disabled={enregistrementEnCours}>
            <Text style={styles.texteBoutonBarrePrimaire}>✨ Créer</Text>
          </Pressable>
        </View>
      </View>

      <SelecteurChant
        visible={!!ligneCiblee || !!lectureCiblee}
        onFermer={() => { setLigneCiblee(null); setLectureCiblee(null); }}
        onSelection={onChantChoisi}
      />

      <Modal visible={apercuVisible} animationType="slide" onRequestClose={() => setApercuVisible(false)}>
        <PdfViewer
          uri={pdfUri}
          chargement={pdfChargement}
          erreur={pdfErreur?.message ?? null}
          momentsEnCause={pdfErreur?.moments_en_cause}
          onFermer={() => setApercuVisible(false)}
        />
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fond: { flex: 1, backgroundColor: "#eef2f9" },
  scroll: { padding: 16, paddingBottom: 16 },
  section: { fontSize: 15, fontWeight: "700", color: "#1e293b", marginTop: 18, marginBottom: 8 },
  sousTitreSection: { fontSize: 11, color: "#94a3b8", marginTop: -4, marginBottom: 8 },
  enteteSection: { flexDirection: "row" },
  rangeeActionsTexte: { flexDirection: "row", gap: 16, marginBottom: 8 },
  actionTexte: { fontSize: 12, color: "#2563eb", fontWeight: "600" },
  champ: { borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 10, padding: 12, fontSize: 14, backgroundColor: "#fff", marginBottom: 8 },
  champMulti: { minHeight: 70, textAlignVertical: "top" },
  rangeeLecture: { flexDirection: "row", alignItems: "center", gap: 8 },
  champLecture: { flex: 1 },
  boutonRecherche: { padding: 10, marginBottom: 8 },
  nouveauFeuillet: { alignSelf: "flex-end", marginBottom: 4 },
  texteNouveauFeuillet: { color: "#2563eb", fontWeight: "600", fontSize: 13 },
  ligneMoment: { backgroundColor: "#fff", borderRadius: 12, padding: 12, marginBottom: 8 },
  ligneEntete: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  blocOrdre: { alignItems: "center" },
  labelOrdre: { fontSize: 9, color: "#94a3b8", textTransform: "uppercase" },
  champOrdre: { width: 44, borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 6, textAlign: "center", fontSize: 13, paddingVertical: 4, backgroundColor: "#fafcff" },
  champNomSpecial: { flex: 1, fontSize: 14, fontWeight: "600", color: "#1e293b", borderBottomWidth: 1, borderBottomColor: "#dbe2ea", paddingVertical: 2 },
  momentTitre: { fontSize: 14, fontWeight: "600", color: "#1e293b", flex: 1 },
  fleches: { flexDirection: "row", gap: 14 },
  rangeeMode: { flexDirection: "row", gap: 8, marginTop: 8 },
  optionMode: { flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: 8, backgroundColor: "#eef2f9" },
  optionModeActive: { backgroundColor: "#2563eb" },
  texteOptionMode: { fontSize: 11, color: "#475569", fontWeight: "600" },
  texteOptionModeActive: { color: "#fff" },
  rangeeLiens: { flexDirection: "row", gap: 16, marginTop: 4 },
  lienAction: { color: "#2563eb", fontSize: 12, fontWeight: "600" },
  fleche: { fontSize: 14, color: "#94a3b8" },
  supprimer: { fontSize: 14, color: "#dc2626" },
  contenuLigne: { marginTop: 8, gap: 6 },
  chantChoisi: { fontSize: 14, fontWeight: "700", color: "#1e293b", marginTop: 2 },
  carteApercuChant: { backgroundColor: "#f8fafc", borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0", padding: 10, gap: 6 },
  enteteApercuChant: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  pillCategorieApercu: { alignSelf: "flex-start", fontSize: 9, fontWeight: "700", color: "#2563eb", backgroundColor: "#dbeafe", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1, textTransform: "uppercase" },
  boutonChanger: { backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
  texteBoutonChanger: { fontSize: 11, fontWeight: "600", color: "#475569" },
  apercuChant: { fontSize: 12, color: "#64748b", fontStyle: "italic", lineHeight: 17, borderLeftWidth: 2, borderLeftColor: "#cbd5e1", paddingLeft: 8 },
  piedApercuChant: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 2 },
  referenceApercu: { fontSize: 11, color: "#64748b", fontWeight: "600" },
  champPetit: { borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 8, padding: 10, fontSize: 13, backgroundColor: "#fafcff" },
  lienEffacer: { color: "#dc2626", fontSize: 12 },
  rangeeActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  actionVide: { flex: 1, backgroundColor: "#eef2f9", borderRadius: 8, padding: 10, alignItems: "center" },
  texteActionVide: { fontSize: 12, color: "#2563eb", fontWeight: "600" },
  ajouterSpecial: { alignItems: "center", padding: 12, marginTop: 4 },
  texteAjouterSpecial: { color: "#2563eb", fontWeight: "600" },
  ligneOption: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#fff", borderRadius: 10, padding: 12, marginBottom: 8 },
  labelOption: { fontSize: 14, color: "#334155", flex: 1, marginRight: 8 },
  petitTexte: { fontSize: 11, color: "#94a3b8" },
  barreBas: { backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#e2e8f0", padding: 10 },
  infosBarre: { gap: 14, paddingBottom: 8 },
  infoItem: { fontSize: 11, color: "#64748b" },
  rangeeBoutonsFinal: { flexDirection: "row", gap: 8 },
  boutonBarre: { flex: 1, alignItems: "center", paddingVertical: 10, backgroundColor: "#eef2f9", borderRadius: 10 },
  boutonBarrePrimaire: { backgroundColor: "#2563eb" },
  texteBoutonBarre: { fontSize: 12, color: "#334155", fontWeight: "600" },
  texteBoutonBarrePrimaire: { fontSize: 12, color: "#fff", fontWeight: "700" },
});
