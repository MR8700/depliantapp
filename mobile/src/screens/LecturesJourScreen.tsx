import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import { chargerLecturesJour, chargerChantsDuJour, JourAelf, LectureAelf, ChantAvecCorrespondance } from "../api/aelf";
import { estSynchronise as bibliothequeBibliqueSynchronisee } from "../storage/lecturesCache";
import { getMeta } from "../api/meta";
import { Chant, Meta } from "../types";
import SongDetailModal from "../components/SongDetailModal";
import { useIdentite } from "../context/IdentiteContext";

const LABELS_TYPE: Record<string, string> = {
  lecture_1: "1ère Lecture",
  lecture_2: "2ème Lecture",
  psaume: "Psaume",
  evangile: "Évangile",
};

function dateVersIso(d: Date): string {
  const annee = d.getFullYear();
  const mois = String(d.getMonth() + 1).padStart(2, "0");
  const jour = String(d.getDate()).padStart(2, "0");
  return `${annee}-${mois}-${jour}`;
}

function isoVersDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function ajouterJours(iso: string, delta: number): string {
  const d = isoVersDate(iso);
  d.setDate(d.getDate() + delta);
  return dateVersIso(d);
}

function formaterDateAffichage(iso: string): string {
  return isoVersDate(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// Le contenu AELF est du HTML simple (<p>, <br/>, <strong>) -- Text de RN ne
// rend pas de HTML, on le convertit donc en texte brut avec des sauts de
// paragraphe/ligne préservés plutôt que d'afficher les balises telles quelles.
function htmlVersTexte(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&eacute;/g, "é").replace(/&egrave;/g, "è").replace(/&agrave;/g, "à")
    .replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default function LecturesJourScreen() {
  const insets = useSafeAreaInsets();
  const { estSuperAdmin } = useIdentite();
  const [dateChoisie, setDateChoisie] = useState(dateVersIso(new Date()));
  const [pickerVisible, setPickerVisible] = useState(false);
  const [jourAelf, setJourAelf] = useState<JourAelf | null>(null);
  const [chargementLectures, setChargementLectures] = useState(true);
  const [erreurLectures, setErreurLectures] = useState<string | null>(null);
  const [ongletActif, setOngletActif] = useState<string>("evangile");
  const [chantsJour, setChantsJour] = useState<ChantAvecCorrespondance[]>([]);
  const [chargementChants, setChargementChants] = useState(true);
  const [recherche, setRecherche] = useState("");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [chantSelectionne, setChantSelectionne] = useState<Chant | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [bibliothequeSynchronisee, setBibliothequeSynchronisee] = useState(true);

  useEffect(() => {
    getMeta().then(setMeta).catch(() => {});
    bibliothequeBibliqueSynchronisee().then(setBibliothequeSynchronisee);
  }, []);

  const charger = useCallback(async (jour: string) => {
    setChargementLectures(true);
    setErreurLectures(null);
    setHorsLigne(false);
    try {
      const donnees = await chargerLecturesJour(jour);
      setJourAelf(donnees);
      const messe = donnees.messes[0];
      if (messe?.lectures?.length) {
        const dispo = messe.lectures.map((l) => l.type);
        setOngletActif(dispo.includes("evangile") ? "evangile" : dispo[0]);
      }
    } catch (erreur: any) {
      setJourAelf(null);
      setErreurLectures(erreur?.message ?? "Impossible de charger les lectures de ce jour.");
    } finally {
      setChargementLectures(false);
    }

    setChargementChants(true);
    try {
      const resultat = await chargerChantsDuJour(jour);
      setChantsJour(resultat.chants);
    } catch {
      setChantsJour([]);
      setHorsLigne(true);
    } finally {
      setChargementChants(false);
    }
  }, []);

  useEffect(() => { charger(dateChoisie); }, [dateChoisie, charger]);

  const messe = jourAelf?.messes?.[0];
  const lectures: LectureAelf[] = messe?.lectures ?? [];
  const lectureActive = lectures.find((l) => l.type === ongletActif) ?? lectures[0];

  const chantsFiltres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    const base = q
      ? chantsJour.filter((c) => c.titre.toLowerCase().includes(q) || (c.refrain ?? "").toLowerCase().includes(q))
      : chantsJour;
    return base.slice(0, 60);
  }, [chantsJour, recherche]);

  const chantsCorrespondants = chantsFiltres.filter((c) => c.correspondance > 0);
  const autresChants = chantsFiltres.filter((c) => c.correspondance === 0);

  return (
    <View style={styles.conteneur}>
      <View style={styles.entete}>
        <View style={styles.ligneNav}>
          <Pressable style={styles.boutonNav} onPress={() => setDateChoisie((d) => ajouterJours(d, -1))}>
            <Text style={styles.texteNav}>‹</Text>
          </Pressable>
          <Pressable style={styles.blocDate} onPress={() => setPickerVisible(true)}>
            <Text style={styles.libelleAujourdhui}>
              {dateChoisie === dateVersIso(new Date()) ? "AUJOURD'HUI" : "MESSE"}
            </Text>
            <Text style={styles.dateAffichee}>{formaterDateAffichage(dateChoisie)}</Text>
          </Pressable>
          <Pressable style={styles.boutonNav} onPress={() => setDateChoisie((d) => ajouterJours(d, 1))}>
            <Text style={styles.texteNav}>›</Text>
          </Pressable>
        </View>
        {dateChoisie !== dateVersIso(new Date()) && (
          <Pressable onPress={() => setDateChoisie(dateVersIso(new Date()))}>
            <Text style={styles.lienAujourdhui}>Revenir à aujourd'hui</Text>
          </Pressable>
        )}
      </View>

      {!bibliothequeSynchronisee && (
        <View style={styles.banniereAvertissement}>
          <Text style={styles.texteBanniereAvertissement}>
            📖 Bibliothèque biblique non synchronisée -- les lectures ne seront pas consultables hors-ligne. Réglages → Synchroniser la bibliothèque biblique.
          </Text>
        </View>
      )}

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        {chargementLectures ? (
          <ActivityIndicator style={{ marginTop: 40 }} size="large" />
        ) : erreurLectures ? (
          <Text style={styles.texteErreur}>{erreurLectures}</Text>
        ) : jourAelf ? (
          <>
            {!!jourAelf.informations?.jour_liturgique_nom && (
              <View style={styles.banniereJour}>
                <Text style={styles.texteJourLiturgique}>{jourAelf.informations.jour_liturgique_nom}</Text>
                {!!jourAelf.informations.degre && <Text style={styles.sousTexteJourLiturgique}>{jourAelf.informations.degre}</Text>}
              </View>
            )}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.onglets}>
              {lectures.map((l) => (
                <Pressable
                  key={l.type}
                  style={[styles.onglet, ongletActif === l.type && styles.ongletActif]}
                  onPress={() => setOngletActif(l.type)}
                >
                  <Text style={[styles.texteOnglet, ongletActif === l.type && styles.texteOngletActif]}>
                    {LABELS_TYPE[l.type] ?? l.type}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {lectureActive && (
              <View style={styles.contenuLecture}>
                {!!lectureActive.intro_lue && <Text style={styles.introLue}>{lectureActive.intro_lue}</Text>}
                {!!lectureActive.titre && <Text style={styles.titreLecture}>« {lectureActive.titre.replace(/^«\s*|\s*»$/g, "")} »</Text>}
                {!!lectureActive.refrain_psalmique && (
                  <View style={styles.blocRefrainPsaume}>
                    <Text style={styles.texteRefrainPsaume}>{htmlVersTexte(lectureActive.refrain_psalmique)}</Text>
                  </View>
                )}
                <Text style={styles.texteLecture}>{htmlVersTexte(lectureActive.contenu)}</Text>
                {!!lectureActive.verset_evangile && (
                  <View style={styles.blocRefrainPsaume}>
                    <Text style={styles.texteRefrainPsaume}>{htmlVersTexte(lectureActive.verset_evangile)}</Text>
                  </View>
                )}
                {!!lectureActive.ref && <Text style={styles.refLecture}>{lectureActive.ref}</Text>}
              </View>
            )}
          </>
        ) : null}

        <View style={styles.separateur} />

        <View style={styles.enteteChants}>
          <Text style={styles.titreSection}>🎵 Chants pour ce jour</Text>
          <View style={styles.rechercheWrapper}>
            <Text>🔍</Text>
            <TextInput
              style={styles.champRecherche}
              placeholder="Rechercher un chant..."
              value={recherche}
              onChangeText={setRecherche}
            />
          </View>
        </View>

        {chargementChants ? (
          <ActivityIndicator style={{ marginTop: 16 }} />
        ) : (
          <>
            {horsLigne && !bibliothequeSynchronisee && (
              <Text style={styles.texteVide}>
                Hors-ligne et bibliothèque biblique non synchronisée -- aucun rapprochement possible pour l'instant.
              </Text>
            )}
            {chantsCorrespondants.length > 0 && (
              <>
                <Text style={styles.sousTitreListe}>📖 Correspondent aux lectures du jour</Text>
                {chantsCorrespondants.map((c) => (
                  <Pressable key={c.id} style={styles.carteChant} onPress={() => setChantSelectionne(c)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.titreChant} numberOfLines={1}>{c.titre}</Text>
                      <Text style={styles.sousTitreChant}>{c.categorie}</Text>
                    </View>
                    <View style={styles.badgeCorrespondance}>
                      <Text style={styles.texteBadgeCorrespondance}>
                        {c.correspondance >= 1 ? "✓ Référence" : `${Math.round(c.correspondance * 100)}%`}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </>
            )}
            {autresChants.length > 0 && (
              <>
                <Text style={styles.sousTitreListe}>Autres chants de la bibliothèque</Text>
                {autresChants.map((c) => (
                  <Pressable key={c.id} style={styles.carteChant} onPress={() => setChantSelectionne(c)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.titreChant} numberOfLines={1}>{c.titre}</Text>
                      <Text style={styles.sousTitreChant}>{c.categorie}</Text>
                    </View>
                  </Pressable>
                ))}
              </>
            )}
            {chantsFiltres.length === 0 && !chargementChants && (
              <Text style={styles.texteVide}>Aucun chant ne correspond à cette recherche.</Text>
            )}
          </>
        )}
      </ScrollView>

      {pickerVisible && (
        <View style={Platform.OS === "ios" ? styles.conteneurPickerIos : undefined}>
          <DateTimePicker
            value={isoVersDate(dateChoisie)}
            mode="date"
            display={Platform.OS === "ios" ? "inline" : "default"}
            onChange={(event, selectionne) => {
              if (Platform.OS !== "ios") setPickerVisible(false);
              if (event.type === "set" && selectionne) setDateChoisie(dateVersIso(selectionne));
            }}
          />
          {Platform.OS === "ios" && (
            <Pressable style={styles.boutonValiderDate} onPress={() => setPickerVisible(false)}>
              <Text style={styles.texteBoutonValiderDate}>OK</Text>
            </Pressable>
          )}
        </View>
      )}

      <SongDetailModal
        visible={!!chantSelectionne}
        chant={chantSelectionne}
        meta={meta}
        estSuperAdmin={estSuperAdmin}
        onClose={() => setChantSelectionne(null)}
        onChange={(maj) => {
          setChantsJour((prev) => prev.map((c) => (c.id === maj.id ? { ...maj, correspondance: c.correspondance } : c)));
          setChantSelectionne(maj);
        }}
        onDelete={(id) => {
          setChantsJour((prev) => prev.filter((c) => c.id !== id));
          setChantSelectionne(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  conteneur: { flex: 1, backgroundColor: "#eef2f9" },
  entete: { backgroundColor: "#1F4A7C", paddingTop: 12, paddingBottom: 14, paddingHorizontal: 12 },
  ligneNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  boutonNav: { paddingHorizontal: 14, paddingVertical: 6 },
  texteNav: { color: "#fff", fontSize: 26, fontWeight: "300" },
  blocDate: { flex: 1, alignItems: "center" },
  libelleAujourdhui: { color: "rgba(255,255,255,0.75)", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  dateAffichee: { color: "#fff", fontSize: 17, fontWeight: "800", textTransform: "capitalize", marginTop: 2, textAlign: "center" },
  lienAujourdhui: { color: "#cfe0f7", fontSize: 12, textAlign: "center", marginTop: 6, fontWeight: "600" },
  banniereAvertissement: { backgroundColor: "#fef3c7", padding: 10 },
  texteBanniereAvertissement: { color: "#92400e", fontSize: 11, textAlign: "center" },
  texteErreur: { color: "#dc2626", textAlign: "center", marginTop: 40, paddingHorizontal: 20 },
  banniereJour: { backgroundColor: "#fff", padding: 16, marginTop: 1 },
  texteJourLiturgique: { fontSize: 17, fontWeight: "800", color: "#1e293b" },
  sousTexteJourLiturgique: { fontSize: 13, color: "#64748b", marginTop: 2 },
  onglets: { backgroundColor: "#fff", paddingHorizontal: 12, paddingBottom: 4, gap: 4 },
  onglet: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: "transparent" },
  ongletActif: { borderBottomColor: "#1F4A7C" },
  texteOnglet: { fontSize: 13, color: "#94a3b8", fontWeight: "600" },
  texteOngletActif: { color: "#1F4A7C" },
  contenuLecture: { backgroundColor: "#fff", padding: 16, paddingBottom: 24 },
  introLue: { fontSize: 12, color: "#64748b", fontStyle: "italic", marginBottom: 8 },
  titreLecture: { fontSize: 17, fontWeight: "800", color: "#1e293b", marginBottom: 12, lineHeight: 24 },
  blocRefrainPsaume: { backgroundColor: "#f1f5f9", borderRadius: 10, padding: 12, marginBottom: 12 },
  texteRefrainPsaume: { fontSize: 14, fontWeight: "700", color: "#1e293b", lineHeight: 21 },
  texteLecture: { fontSize: 15, color: "#334155", lineHeight: 24 },
  refLecture: { fontSize: 12, color: "#94a3b8", marginTop: 14, textAlign: "right", fontStyle: "italic" },
  separateur: { height: 8, backgroundColor: "#eef2f9" },
  enteteChants: { padding: 16, paddingBottom: 8, backgroundColor: "#fff" },
  titreSection: { fontSize: 15, fontWeight: "800", color: "#1e293b", marginBottom: 10 },
  rechercheWrapper: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#f8fafc", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#dbe2ea" },
  champRecherche: { flex: 1, fontSize: 13 },
  sousTitreListe: { fontSize: 12, fontWeight: "700", color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4, marginHorizontal: 16, marginTop: 14, marginBottom: 6 },
  carteChant: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", marginHorizontal: 16, marginBottom: 8, borderRadius: 12, padding: 14 },
  titreChant: { fontSize: 14, fontWeight: "700", color: "#1e293b" },
  sousTitreChant: { fontSize: 12, color: "#64748b", marginTop: 2 },
  badgeCorrespondance: { backgroundColor: "#dcfce7", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  texteBadgeCorrespondance: { fontSize: 11, fontWeight: "700", color: "#16a34a" },
  texteVide: { textAlign: "center", color: "#94a3b8", marginTop: 20, paddingHorizontal: 24 },
  conteneurPickerIos: { backgroundColor: "#fff", paddingBottom: 8 },
  boutonValiderDate: { alignSelf: "flex-end", marginRight: 16, marginBottom: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#2563eb", borderRadius: 8 },
  texteBoutonValiderDate: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
