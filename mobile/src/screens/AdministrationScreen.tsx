import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import {
  listerChoralesDetail, creerChorale, reinitialiserMotDePasse, planifierSuppression, annulerSuppression, ChoraleDetail,
} from "../api/chorales";
import {
  listerDemandes, validerDemande, annulerDemande, DemandeSuppression,
  listerMasques, restaurerMasque, MasqueChorale,
  listerCategoriesModeration, validerCategorie, rejeterCategorie, CategoriePersonnalisee,
} from "../api/moderation";
import { getParametresGlobaux, sauvegarderParametres } from "../api/parametres";
import {
  listerLicences, creerLicence, listerActivationsLicence, revoquerLicence, reactiverLicence,
  regenererCode, revoquerActivationAppareil, Licence, ActivationAppareil,
} from "../api/licences";
import Bouton from "../components/Bouton";

type OngletAdmin = "chorales" | "apropos";

export default function AdministrationScreen() {
  const [onglet, setOnglet] = useState<OngletAdmin>("chorales");
  const [gotConfig, setGotConfig] = useState<Record<string, any>>({});
  const [gotChargement, setGotChargement] = useState(true);
  const [chorales, setChorales] = useState<ChoraleDetail[]>([]);
  const [demandes, setDemandes] = useState<DemandeSuppression[]>([]);
  const [masques, setMasques] = useState<MasqueChorale[]>([]);
  const [categoriesEnAttente, setCategoriesEnAttente] = useState<CategoriePersonnalisee[]>([]);
  const [licences, setLicences] = useState<Licence[]>([]);
  const [chargement, setChargement] = useState(true);
  const [rafraichissement, setRafraichissement] = useState(false);
  const [nomChorale, setNomChorale] = useState("");
  const [usernameChorale, setUsernameChorale] = useState("");
  const [planificationId, setPlanificationId] = useState<number | null>(null);
  const [raisonPlanification, setRaisonPlanification] = useState("");
  const [appareilsModal, setAppareilsModal] = useState<Licence | null>(null);
  const [appareils, setAppareils] = useState<ActivationAppareil[]>([]);

  const charger = useCallback(async () => {
    const [c, d, m, cat, lic] = await Promise.all([
      listerChoralesDetail().catch(() => []),
      listerDemandes().catch(() => []),
      listerMasques().catch(() => []),
      listerCategoriesModeration().catch(() => []),
      listerLicences().catch(() => []),
    ]);
    setChorales(c); setDemandes(d); setMasques(m); setCategoriesEnAttente(cat); setLicences(lic);
  }, []);

  function licencePourChorale(choraleId: number): Licence | undefined {
    return licences.find((l) => l.chorale_id === choraleId);
  }

  async function genererLicencePour(choraleId: number) {
    try {
      const licence = await creerLicence(choraleId);
      await charger();
      Alert.alert("Licence créée", `Code à transmettre à la chorale :\n\n${licence.code}\n\nCe code s'active une seule fois dans l'app mobile (Activation), puis reste partagé par tous les appareils de la chorale jusqu'à ${licence.max_appareils}.`);
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible de créer la licence");
    }
  }

  async function regenererCodeLicence(licence: Licence) {
    try {
      const res = await regenererCode(licence.id);
      await charger();
      Alert.alert("Code régénéré", `Nouveau code à transmettre :\n\n${res.code}\n\nL'ancien code ne fonctionne plus, mais les appareils déjà activés restent connectés.`);
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible de régénérer le code");
    }
  }

  async function toggleStatutLicence(licence: Licence) {
    try {
      if (licence.statut === "active") await revoquerLicence(licence.id);
      else await reactiverLicence(licence.id);
      await charger();
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Échec de l'opération");
    }
  }

  async function ouvrirAppareils(licence: Licence) {
    setAppareilsModal(licence);
    try { setAppareils(await listerActivationsLicence(licence.id)); } catch { setAppareils([]); }
  }

  async function revoquerAppareil(licence: Licence, appareilId: string) {
    try {
      await revoquerActivationAppareil(licence.id, appareilId);
      setAppareils(await listerActivationsLicence(licence.id));
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible de révoquer cet appareil");
    }
  }

  useEffect(() => {
    getParametresGlobaux().then(setGotConfig).catch(() => {}).finally(() => setGotChargement(false));
  }, []);

  function majChampGot(cle: string, valeur: string) {
    setGotConfig((prev) => ({ ...prev, [cle]: valeur }));
  }

  async function enregistrerGot() {
    try {
      await sauvegarderParametres(gotConfig);
      Alert.alert("Enregistré", "Le contenu « À propos » a été mis à jour.");
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible d'enregistrer");
    }
  }

  useEffect(() => { charger().finally(() => setChargement(false)); }, [charger]);

  async function onRafraichir() {
    setRafraichissement(true);
    await charger();
    setRafraichissement(false);
  }

  async function onCreerChorale() {
    if (!nomChorale.trim() || !usernameChorale.trim()) return;
    try {
      const res = await creerChorale(nomChorale.trim(), usernameChorale.trim());
      Alert.alert("Chorale créée", `Mot de passe initial : ${res.mot_de_passe_initial}`);
      setNomChorale(""); setUsernameChorale("");
      charger();
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible de créer la chorale");
    }
  }

  async function onReset(id: number) {
    try {
      const res = await reinitialiserMotDePasse(id);
      Alert.alert("Mot de passe réinitialisé", res.mot_de_passe_initial);
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Échec de la réinitialisation");
    }
  }

  function onPlanifier(id: number) {
    setRaisonPlanification("");
    setPlanificationId(id);
  }

  async function confirmerPlanification() {
    if (!planificationId || !raisonPlanification.trim()) return;
    try {
      await planifierSuppression(planificationId, raisonPlanification.trim(), 15);
      setPlanificationId(null);
      charger();
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Échec de la planification");
    }
  }

  async function onAnnulerSuppression(id: number) {
    try { await annulerSuppression(id, "Annulée depuis l'application mobile"); charger(); }
    catch (erreur: any) { Alert.alert("Erreur", erreur?.message ?? "Échec"); }
  }

  async function onValiderDemande(id: number) {
    try { await validerDemande(id); charger(); } catch (erreur: any) { Alert.alert("Erreur", erreur?.message ?? "Échec"); }
  }
  async function onAnnulerDemande(id: number) {
    try { await annulerDemande(id); charger(); } catch (erreur: any) { Alert.alert("Erreur", erreur?.message ?? "Échec"); }
  }
  async function onRestaurerMasque(id: number) {
    try { await restaurerMasque(id); charger(); } catch (erreur: any) { Alert.alert("Erreur", erreur?.message ?? "Échec"); }
  }
  async function onValiderCategorie(id: number) {
    try { await validerCategorie(id); charger(); } catch (erreur: any) { Alert.alert("Erreur", erreur?.message ?? "Échec"); }
  }
  async function onRejeterCategorie(id: number) {
    try { await rejeterCategorie(id, "Rejetée depuis l'application mobile"); charger(); }
    catch (erreur: any) { Alert.alert("Erreur", erreur?.message ?? "Échec"); }
  }

  if (chargement) return <ActivityIndicator style={{ flex: 1 }} size="large" />;

  return (
    <ScrollView
      style={styles.conteneur}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={rafraichissement} onRefresh={onRafraichir} tintColor="#2563eb" />}
    >
      <Text style={styles.filDAriane}>Administration</Text>
      <Text style={styles.titrePage}>Administration</Text>
      <View style={styles.tabs}>
        <Pressable style={[styles.tab, onglet === "chorales" && styles.tabActif]} onPress={() => setOnglet("chorales")}>
          <Text style={[styles.texteTab, onglet === "chorales" && styles.texteTabActif]}>👥 Chorales</Text>
        </Pressable>
        <Pressable style={[styles.tab, onglet === "apropos" && styles.tabActif]} onPress={() => setOnglet("apropos")}>
          <Text style={[styles.texteTab, onglet === "apropos" && styles.texteTabActif]}>⚙️ À propos (GOT)</Text>
        </Pressable>
      </View>

      {onglet === "apropos" ? (
        gotChargement ? <ActivityIndicator /> : (
          <>
            {Object.entries(gotConfig).filter(([cle]) => !["chorale", "paroisse", "contact", "annonce", "priere_defaut", "logo_gauche_media_id", "logo_droit_media_id", "banniere_bas_media_id"].includes(cle)).map(([cle, valeur]) => (
              <View key={cle}>
                <Text style={styles.label}>{cle}</Text>
                <TextInput
                  style={[styles.champ, styles.champMulti]}
                  value={String(valeur ?? "")}
                  onChangeText={(v) => majChampGot(cle, v)}
                  multiline
                />
              </View>
            ))}
            <Bouton titre="Enregistrer" onPress={enregistrerGot} />
          </>
        )
      ) : (
      <>
      <Text style={styles.section}>👥 Créer une chorale</Text>
      <Text style={styles.label}>Nom de la chorale</Text>
      <TextInput style={styles.champ} placeholder="Ex : Chorale Sainte Cécile" value={nomChorale} onChangeText={setNomChorale} />
      <Text style={styles.label}>Identifiant de connexion</Text>
      <TextInput style={styles.champ} placeholder="Ex : chorale-sainte-cecile" value={usernameChorale} onChangeText={setUsernameChorale} autoCapitalize="none" />
      <Bouton titre="+ Créer la chorale" onPress={onCreerChorale} desactive={!nomChorale.trim() || !usernameChorale.trim()} />

      <Text style={styles.section}>Chorales enregistrées ({chorales.length})</Text>
      {chorales.map((c) => {
        const licence = licencePourChorale(c.id);
        return (
        <View key={c.id} style={styles.carte}>
          <Text style={styles.titreCarte}>{c.nom}</Text>
          <Text style={styles.sousTitreCarte}>@{c.username}</Text>
          {c.suppression_date_butoir && (
            <Text style={styles.avertissement}>Suppression planifiée : {c.suppression_date_butoir}</Text>
          )}
          <View style={styles.actionsCarte}>
            <Pressable onPress={() => onReset(c.id)}><Text style={styles.lien}>Réinitialiser mdp</Text></Pressable>
            {c.suppression_date_butoir ? (
              <Pressable onPress={() => onAnnulerSuppression(c.id)}><Text style={styles.lien}>Annuler suppression</Text></Pressable>
            ) : (
              <Pressable onPress={() => onPlanifier(c.id)}><Text style={[styles.lien, { color: "#dc2626" }]}>Planifier suppression</Text></Pressable>
            )}
          </View>

          <View style={styles.licenceBloc}>
            {licence ? (
              <>
                <Text style={styles.labelLicence}>
                  🔑 Licence : <Text style={styles.codeLicence}>{licence.code}</Text>
                </Text>
                <Text style={styles.sousTitreCarte}>
                  {licence.statut === "active" ? "Active" : "Révoquée"} • max {licence.max_appareils} appareil(s)
                  {licence.expire_le ? ` • expire le ${licence.expire_le}` : ""}
                </Text>
                <View style={styles.actionsCarte}>
                  <Pressable onPress={() => ouvrirAppareils(licence)}><Text style={styles.lien}>Voir les appareils</Text></Pressable>
                  <Pressable onPress={() => regenererCodeLicence(licence)}><Text style={styles.lien}>Régénérer le code</Text></Pressable>
                  <Pressable onPress={() => toggleStatutLicence(licence)}>
                    <Text style={[styles.lien, licence.statut === "active" && { color: "#dc2626" }]}>
                      {licence.statut === "active" ? "Révoquer" : "Réactiver"}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <Pressable onPress={() => genererLicencePour(c.id)}>
                <Text style={[styles.lien, { fontWeight: "700" }]}>🔑 Générer une licence</Text>
              </Pressable>
            )}
          </View>
        </View>
        );
      })}

      <Text style={styles.section}>⌛ Demandes de suppression en attente ({demandes.length})</Text>
      <Text style={styles.hint}>
        Une chorale ne supprime jamais directement un chant ou un dépliant. Valider supprime réellement la ressource pour tout le monde ; annuler la conserve mais elle reste invisible pour la chorale demandeuse.
      </Text>
      {demandes.map((d) => (
        <View key={d.id} style={styles.carte}>
          <Text style={styles.titreCarte}>{d.type_cible} #{d.cible_id}</Text>
          <Text style={styles.sousTitreCarte}>{d.apercu?.titre ?? d.apercu?.date ?? "Aperçu indisponible"}</Text>
          <Text style={styles.raison}>{d.raison}</Text>
          <View style={styles.actionsCarte}>
            <Pressable onPress={() => onValiderDemande(d.id)}><Text style={[styles.lien, { color: "#dc2626" }]}>Valider (supprimer)</Text></Pressable>
            <Pressable onPress={() => onAnnulerDemande(d.id)}><Text style={styles.lien}>Annuler</Text></Pressable>
          </View>
        </View>
      ))}
      {demandes.length === 0 && <Text style={styles.vide}>Aucune demande en attente.</Text>}

      <Text style={styles.section}>🏷️ Validation des catégories personnalisées ({categoriesEnAttente.length})</Text>
      <Text style={styles.hint}>Validez pour rendre la catégorie utilisable par tout le monde. Rejetez avec un motif pour envoyer une notification au créateur.</Text>
      {categoriesEnAttente.map((c) => (
        <View key={c.id} style={styles.carte}>
          <Text style={styles.titreCarte}>{c.nom}</Text>
          <Text style={styles.sousTitreCarte}>Proposée par {c.chorale_nom ?? "?"}</Text>
          <View style={styles.actionsCarte}>
            <Pressable onPress={() => onValiderCategorie(c.id)}><Text style={styles.lien}>Valider</Text></Pressable>
            <Pressable onPress={() => onRejeterCategorie(c.id)}><Text style={[styles.lien, { color: "#dc2626" }]}>Rejeter</Text></Pressable>
          </View>
        </View>
      ))}

      <Text style={styles.section}>Ressources masquées ({masques.length})</Text>
      {masques.map((m) => (
        <View key={m.id} style={styles.carte}>
          <Text style={styles.titreCarte}>{m.type_cible} #{m.cible_id}</Text>
          <Pressable onPress={() => onRestaurerMasque(m.id)}><Text style={styles.lien}>Restaurer pour cette chorale</Text></Pressable>
        </View>
      ))}
      </>
      )}

      <Modal visible={!!planificationId} animationType="fade" transparent onRequestClose={() => setPlanificationId(null)}>
        <View style={styles.fondModal}>
          <View style={styles.boiteModal}>
            <Text style={styles.titreCarte}>Planifier la suppression (15 jours)</Text>
            <TextInput
              style={[styles.champ, { minHeight: 70, textAlignVertical: "top", marginTop: 10 }]}
              placeholder="Raison..."
              value={raisonPlanification}
              onChangeText={setRaisonPlanification}
              multiline
            />
            <View style={styles.actionsCarte}>
              <Pressable onPress={() => setPlanificationId(null)}><Text style={styles.lien}>Annuler</Text></Pressable>
              <Pressable onPress={confirmerPlanification}><Text style={[styles.lien, { color: "#dc2626" }]}>Confirmer</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!appareilsModal} animationType="fade" transparent onRequestClose={() => setAppareilsModal(null)}>
        <View style={styles.fondModal}>
          <View style={styles.boiteModal}>
            <Text style={styles.titreCarte}>Appareils activés -- {appareilsModal?.code}</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {appareils.length === 0 && <Text style={styles.vide}>Aucun appareil actif.</Text>}
              {appareils.map((a) => (
                <View key={a.id} style={[styles.carte, { marginTop: 10 }]}>
                  <Text style={styles.titreCarte}>{a.appareil_nom ?? "Appareil inconnu"}</Text>
                  <Text style={styles.sousTitreCarte}>Activé le {a.active_le} • dernier contact {a.dernier_contact_le}</Text>
                  {a.revoque_le ? (
                    <Text style={styles.avertissement}>Révoqué le {a.revoque_le}</Text>
                  ) : (
                    <Pressable onPress={() => appareilsModal && revoquerAppareil(appareilsModal, a.appareil_id)}>
                      <Text style={[styles.lien, { color: "#dc2626", marginTop: 6 }]}>Révoquer cet appareil</Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </ScrollView>
            <View style={{ marginTop: 14 }}>
              <Bouton titre="Fermer" onPress={() => setAppareilsModal(null)} />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  conteneur: { flex: 1, backgroundColor: "#eef2f9" },
  filDAriane: { fontSize: 12, color: "#64748b" },
  titrePage: { fontSize: 19, fontWeight: "800", color: "#1F4A7C", marginTop: 2, marginBottom: 12 },
  tabs: { flexDirection: "row", gap: 8, marginBottom: 16 },
  tab: { backgroundColor: "#fff", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  tabActif: { backgroundColor: "#2563eb" },
  texteTab: { fontSize: 12, color: "#334155", fontWeight: "600" },
  texteTabActif: { color: "#fff" },
  hint: { fontSize: 11, color: "#64748b", marginBottom: 8 },
  label: { fontSize: 12, color: "#64748b", marginBottom: 4, marginTop: 4 },
  champMulti: { minHeight: 60, textAlignVertical: "top" },
  section: { fontSize: 15, fontWeight: "700", color: "#1e293b", marginTop: 18, marginBottom: 8 },
  champ: { borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 10, padding: 12, backgroundColor: "#fff", marginBottom: 8 },
  carte: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8 },
  titreCarte: { fontSize: 14, fontWeight: "700", color: "#1e293b" },
  sousTitreCarte: { fontSize: 12, color: "#64748b", marginTop: 2 },
  avertissement: { fontSize: 12, color: "#d97706", marginTop: 4 },
  raison: { fontSize: 12, color: "#334155", marginTop: 4, fontStyle: "italic" },
  actionsCarte: { flexDirection: "row", gap: 16, marginTop: 8 },
  lien: { color: "#2563eb", fontSize: 12, fontWeight: "600" },
  vide: { textAlign: "center", color: "#94a3b8", marginTop: 8 },
  fondModal: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)", justifyContent: "center", padding: 24 },
  boiteModal: { backgroundColor: "#fff", borderRadius: 16, padding: 20, maxHeight: "80%" },
  licenceBloc: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  labelLicence: { fontSize: 13, color: "#334155", fontWeight: "600" },
  codeLicence: { fontFamily: "monospace", color: "#1F4A7C", fontWeight: "800" },
});
