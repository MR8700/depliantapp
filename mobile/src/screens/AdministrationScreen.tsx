import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  listerChoralesDetail, creerChorale, reinitialiserMotDePasse, planifierSuppression, annulerSuppression, ChoraleDetail,
} from "../api/chorales";
import {
  listerDemandes, validerDemande, annulerDemande, DemandeSuppression,
  listerMasques, restaurerMasque, MasqueChorale,
  listerCategoriesModeration, validerCategorie, rejeterCategorie, CategoriePersonnalisee,
  listerChantsPrives, publierChantPrive,
  listerFeuilletsAValider, validerPublicationFeuillet,
  listerMediasEnAttente, validerMedia, rejeterMedia,
} from "../api/moderation";
import { getParametresGlobaux, sauvegarderParametres } from "../api/parametres";
import { Chant, Feuillet, ChantMedia } from "../types";
import {
  listerLicences, creerLicence, configurerLicence, listerActivationsLicence, revoquerLicence, reactiverLicence,
  regenererCode, revoquerActivationAppareil, Licence, ActivationAppareil,
} from "../api/licences";
import Bouton from "../components/Bouton";

function dateIsoVersDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function dateVersIso(d: Date): string {
  const annee = d.getFullYear();
  const mois = String(d.getMonth() + 1).padStart(2, "0");
  const jour = String(d.getDate()).padStart(2, "0");
  return `${annee}-${mois}-${jour}`;
}

type OngletAdmin = "chorales" | "apropos";

// Petit lien d'action avec indicateur de chargement intégré -- remplace le
// texte par un spinner pendant l'appel réseau et désactive le bouton, pour
// qu'un double-tap n'envoie jamais deux fois la même action (ex : publier un
// même chant deux fois, régénérer un code licence en double...).
function LienAction({
  cle, actionsEnCours, texte, danger, onPress,
}: { cle: string; actionsEnCours: Set<string>; texte: string; danger?: boolean; onPress: () => void }) {
  const chargement = actionsEnCours.has(cle);
  return (
    <Pressable onPress={onPress} disabled={chargement} style={{ opacity: chargement ? 0.5 : 1 }}>
      {chargement
        ? <ActivityIndicator size="small" color={danger ? "#dc2626" : "#2563eb"} />
        : <Text style={[styles.lien, danger && { color: "#dc2626" }]}>{texte}</Text>}
    </Pressable>
  );
}

export default function AdministrationScreen() {
  const [onglet, setOnglet] = useState<OngletAdmin>("chorales");
  const [gotConfig, setGotConfig] = useState<Record<string, any>>({});
  const [gotChargement, setGotChargement] = useState(true);
  const [chorales, setChorales] = useState<ChoraleDetail[]>([]);
  const [demandes, setDemandes] = useState<DemandeSuppression[]>([]);
  const [masques, setMasques] = useState<MasqueChorale[]>([]);
  const [categoriesEnAttente, setCategoriesEnAttente] = useState<CategoriePersonnalisee[]>([]);
  const [chantsPrives, setChantsPrives] = useState<Chant[]>([]);
  const [feuilletsAValider, setFeuilletsAValider] = useState<Feuillet[]>([]);
  const [mediasAValider, setMediasAValider] = useState<ChantMedia[]>([]);
  const [licences, setLicences] = useState<Licence[]>([]);
  const [actionsEnCours, setActionsEnCours] = useState<Set<string>>(new Set());
  const [chargement, setChargement] = useState(true);
  const [rafraichissement, setRafraichissement] = useState(false);
  const [nomChorale, setNomChorale] = useState("");
  const [usernameChorale, setUsernameChorale] = useState("");
  const [planificationId, setPlanificationId] = useState<number | null>(null);
  const [raisonPlanification, setRaisonPlanification] = useState("");
  const [appareilsModal, setAppareilsModal] = useState<Licence | null>(null);
  const [appareils, setAppareils] = useState<ActivationAppareil[]>([]);
  const [configCible, setConfigCible] = useState<{ choraleId: number; licence: Licence | null } | null>(null);
  const [configMaxAppareils, setConfigMaxAppareils] = useState("1");
  const [configQuota, setConfigQuota] = useState("");
  const [configExpireLe, setConfigExpireLe] = useState<string | null>(null);
  const [configPickerVisible, setConfigPickerVisible] = useState(false);
  const [configEnCours, setConfigEnCours] = useState(false);

  const charger = useCallback(async () => {
    const [c, d, m, cat, lic, cp, fv, mv] = await Promise.all([
      listerChoralesDetail().catch(() => []),
      listerDemandes().catch(() => []),
      listerMasques().catch(() => []),
      listerCategoriesModeration().catch(() => []),
      listerLicences().catch(() => []),
      listerChantsPrives().catch(() => []),
      listerFeuilletsAValider().catch(() => []),
      listerMediasEnAttente().catch(() => []),
    ]);
    setChorales(c); setDemandes(d); setMasques(m); setCategoriesEnAttente(cat); setLicences(lic);
    setChantsPrives(cp); setFeuilletsAValider(fv); setMediasAValider(mv);
  }, []);

  // Enveloppe générique pour toute action déclenchée par un LienAction :
  // marque `cle` comme en cours (affiche le spinner, désactive le lien) le
  // temps de l'appel, quel qu'en soit le résultat.
  async function executerAction(cle: string, action: () => Promise<void>) {
    setActionsEnCours((prev) => { const s = new Set(prev); s.add(cle); return s; });
    try {
      await action();
    } finally {
      setActionsEnCours((prev) => { const s = new Set(prev); s.delete(cle); return s; });
    }
  }

  async function onPublierChant(id: number) {
    await executerAction(`publier-chant-${id}`, async () => {
      try {
        await publierChantPrive(id);
        setChantsPrives((prev) => prev.filter((c) => c.id !== id));
      } catch (erreur: any) {
        Alert.alert("Erreur", erreur?.message ?? "Impossible de publier ce chant");
      }
    });
  }

  async function onValiderFeuillet(id: number) {
    await executerAction(`valider-feuillet-${id}`, async () => {
      try {
        await validerPublicationFeuillet(id);
        setFeuilletsAValider((prev) => prev.filter((f) => f.id !== id));
      } catch (erreur: any) {
        Alert.alert("Erreur", erreur?.message ?? "Impossible de valider ce dépliant");
      }
    });
  }

  async function onValiderMedia(id: number) {
    await executerAction(`valider-media-${id}`, async () => {
      try {
        await validerMedia(id);
        setMediasAValider((prev) => prev.filter((m) => m.id !== id));
      } catch (erreur: any) {
        Alert.alert("Erreur", erreur?.message ?? "Impossible de valider ce média");
      }
    });
  }

  async function onRejeterMedia(id: number) {
    await executerAction(`rejeter-media-${id}`, async () => {
      try {
        await rejeterMedia(id);
        setMediasAValider((prev) => prev.filter((m) => m.id !== id));
      } catch (erreur: any) {
        Alert.alert("Erreur", erreur?.message ?? "Impossible de rejeter ce média");
      }
    });
  }

  function licencePourChorale(choraleId: number): Licence | undefined {
    return licences.find((l) => l.chorale_id === choraleId);
  }

  function ouvrirConfigLicence(choraleId: number, licence: Licence | null) {
    setConfigCible({ choraleId, licence });
    setConfigMaxAppareils(String(licence?.max_appareils ?? 1));
    setConfigQuota(licence?.quota_feuillets != null ? String(licence.quota_feuillets) : "");
    setConfigExpireLe(licence?.expire_le ?? null);
  }

  async function validerConfigLicence() {
    if (!configCible) return;
    const maxAppareils = Math.max(1, Number(configMaxAppareils) || 1);
    const quota = configQuota.trim() ? Math.max(0, Number(configQuota)) : null;
    setConfigEnCours(true);
    try {
      if (configCible.licence) {
        await configurerLicence(configCible.licence.id, maxAppareils, configExpireLe, quota);
      } else {
        const licence = await creerLicence(configCible.choraleId, maxAppareils, configExpireLe, quota);
        Alert.alert("Licence créée", `Code à transmettre à la chorale :\n\n${licence.code}\n\nCe code s'active une seule fois dans l'app mobile (Activation), sur ${licence.max_appareils} appareil(s) au maximum.`);
      }
      setConfigCible(null);
      await charger();
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible d'enregistrer la configuration");
    } finally {
      setConfigEnCours(false);
    }
  }

  async function regenererCodeLicence(licence: Licence) {
    await executerAction(`regen-licence-${licence.id}`, async () => {
      try {
        const res = await regenererCode(licence.id);
        await charger();
        Alert.alert("Code régénéré", `Nouveau code à transmettre :\n\n${res.code}\n\nL'ancien code ne fonctionne plus, mais les appareils déjà activés restent connectés.`);
      } catch (erreur: any) {
        Alert.alert("Erreur", erreur?.message ?? "Impossible de régénérer le code");
      }
    });
  }

  async function toggleStatutLicence(licence: Licence) {
    await executerAction(`toggle-licence-${licence.id}`, async () => {
      try {
        if (licence.statut === "active") await revoquerLicence(licence.id);
        else await reactiverLicence(licence.id);
        await charger();
      } catch (erreur: any) {
        Alert.alert("Erreur", erreur?.message ?? "Échec de l'opération");
      }
    });
  }

  async function ouvrirAppareils(licence: Licence) {
    setAppareilsModal(licence);
    try { setAppareils(await listerActivationsLicence(licence.id)); } catch { setAppareils([]); }
  }

  async function revoquerAppareil(licence: Licence, appareilId: string) {
    await executerAction(`revoquer-appareil-${appareilId}`, async () => {
      try {
        await revoquerActivationAppareil(licence.id, appareilId);
        setAppareils(await listerActivationsLicence(licence.id));
      } catch (erreur: any) {
        Alert.alert("Erreur", erreur?.message ?? "Impossible de révoquer cet appareil");
      }
    });
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

  // Même réglage global que le contenu "À propos" (chorale_id=0, voir
  // routers/parametres.py) -- mais togglé indépendamment du formulaire GOT
  // pour ne pas dépendre d'un "Enregistrer" qu'on pourrait oublier de cliquer
  // sur un réglage de sécurité.
  async function togglePublicationAuto() {
    const nouvelleValeur = !gotConfig.chants_publication_auto;
    setGotConfig((prev) => ({ ...prev, chants_publication_auto: nouvelleValeur }));
    try {
      await sauvegarderParametres({ chants_publication_auto: nouvelleValeur });
    } catch (erreur: any) {
      setGotConfig((prev) => ({ ...prev, chants_publication_auto: !nouvelleValeur }));
      Alert.alert("Erreur", erreur?.message ?? "Impossible d'enregistrer ce réglage");
    }
  }

  useEffect(() => { charger().finally(() => setChargement(false)); }, [charger]);

  async function onRafraichir() {
    setRafraichissement(true);
    await charger();
    setRafraichissement(false);
  }

  const [creationChoraleEnCours, setCreationChoraleEnCours] = useState(false);

  async function onCreerChorale() {
    if (!nomChorale.trim() || !usernameChorale.trim()) return;
    setCreationChoraleEnCours(true);
    try {
      const res = await creerChorale(nomChorale.trim(), usernameChorale.trim());
      Alert.alert("Chorale créée", `Mot de passe initial : ${res.mot_de_passe_initial}`);
      setNomChorale(""); setUsernameChorale("");
      await charger();
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible de créer la chorale");
    } finally {
      setCreationChoraleEnCours(false);
    }
  }

  async function onReset(id: number) {
    await executerAction(`reset-${id}`, async () => {
      try {
        const res = await reinitialiserMotDePasse(id);
        Alert.alert("Mot de passe réinitialisé", res.mot_de_passe_initial);
      } catch (erreur: any) {
        Alert.alert("Erreur", erreur?.message ?? "Échec de la réinitialisation");
      }
    });
  }

  function onPlanifier(id: number) {
    setRaisonPlanification("");
    setPlanificationId(id);
  }

  const [planificationEnCours, setPlanificationEnCours] = useState(false);

  async function confirmerPlanification() {
    if (!planificationId || !raisonPlanification.trim()) return;
    setPlanificationEnCours(true);
    try {
      await planifierSuppression(planificationId, raisonPlanification.trim(), 15);
      setPlanificationId(null);
      await charger();
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Échec de la planification");
    } finally {
      setPlanificationEnCours(false);
    }
  }

  async function onAnnulerSuppression(id: number) {
    await executerAction(`annuler-suppr-${id}`, async () => {
      try { await annulerSuppression(id, "Annulée depuis l'application mobile"); await charger(); }
      catch (erreur: any) { Alert.alert("Erreur", erreur?.message ?? "Échec"); }
    });
  }

  async function onValiderDemande(id: number) {
    await executerAction(`valider-demande-${id}`, async () => {
      try { await validerDemande(id); await charger(); } catch (erreur: any) { Alert.alert("Erreur", erreur?.message ?? "Échec"); }
    });
  }
  async function onAnnulerDemande(id: number) {
    await executerAction(`annuler-demande-${id}`, async () => {
      try { await annulerDemande(id); await charger(); } catch (erreur: any) { Alert.alert("Erreur", erreur?.message ?? "Échec"); }
    });
  }
  async function onRestaurerMasque(id: number) {
    await executerAction(`restaurer-masque-${id}`, async () => {
      try { await restaurerMasque(id); await charger(); } catch (erreur: any) { Alert.alert("Erreur", erreur?.message ?? "Échec"); }
    });
  }
  async function onValiderCategorie(id: number) {
    await executerAction(`valider-categorie-${id}`, async () => {
      try { await validerCategorie(id); await charger(); } catch (erreur: any) { Alert.alert("Erreur", erreur?.message ?? "Échec"); }
    });
  }
  async function onRejeterCategorie(id: number) {
    await executerAction(`rejeter-categorie-${id}`, async () => {
      try { await rejeterCategorie(id, "Rejetée depuis l'application mobile"); await charger(); }
      catch (erreur: any) { Alert.alert("Erreur", erreur?.message ?? "Échec"); }
    });
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
            {Object.entries(gotConfig).filter(([cle]) => !["chorale", "paroisse", "contact", "annonce", "priere_defaut", "logo_gauche_media_id", "logo_droit_media_id", "banniere_bas_media_id", "chants_publication_auto"].includes(cle)).map(([cle, valeur]) => (
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
      <Text style={styles.section}>🎵 Publication des chants ajoutés par les chorales</Text>
      <Text style={styles.hint}>
        Par défaut, un chant ajouté par une chorale reste visible seulement d'elle jusqu'à ce que vous le publiiez
        ci-dessous -- évite qu'un contenu erroné ou inapproprié ne devienne immédiatement visible de toute la communauté.
      </Text>
      <Pressable style={styles.carte} onPress={togglePublicationAuto}>
        <View style={styles.actionsCarte}>
          <Text style={styles.titreCarte}>
            {gotConfig.chants_publication_auto ? "🔓 Publication automatique activée" : "🔒 Publication manuelle (recommandé)"}
          </Text>
        </View>
        <Text style={styles.sousTitreCarte}>
          {gotConfig.chants_publication_auto
            ? "Les chants ajoutés par les chorales sont immédiatement publics. Toucher pour repasser en validation manuelle."
            : "Chaque chant ajouté par une chorale attend votre publication ci-dessous. Toucher pour activer la publication automatique."}
        </Text>
      </Pressable>

      {chantsPrives.length > 0 && (
        <>
          <Text style={styles.section}>⏳ Chants en attente de publication ({chantsPrives.length})</Text>
          {chantsPrives.map((c) => (
            <View key={c.id} style={styles.carte}>
              <Text style={styles.titreCarte}>{c.titre}</Text>
              <Text style={styles.sousTitreCarte}>{c.categorie} · Ajouté par {c.chorale_proprietaire_nom ?? "?"}</Text>
              <View style={styles.actionsCarte}>
                <LienAction cle={`publier-chant-${c.id}`} actionsEnCours={actionsEnCours} texte="✅ Publier" onPress={() => onPublierChant(c.id)} />
              </View>
            </View>
          ))}
        </>
      )}

      {feuilletsAValider.length > 0 && (
        <>
          <Text style={styles.section}>📋 Dépliants en attente de publication ({feuilletsAValider.length})</Text>
          <Text style={styles.hint}>
            Une chorale a marqué ces dépliants comme publics. Ils restent invisibles pour les autres chorales tant que
            vous ne les validez pas ici.
          </Text>
          {feuilletsAValider.map((f) => (
            <View key={f.id} style={styles.carte}>
              <Text style={styles.titreCarte}>{f.date}</Text>
              <Text style={styles.sousTitreCarte}>{f.lieu ?? "—"} · Composé par {f.chorale_nom ?? "?"}</Text>
              <View style={styles.actionsCarte}>
                <LienAction cle={`valider-feuillet-${f.id}`} actionsEnCours={actionsEnCours} texte="✅ Valider" onPress={() => onValiderFeuillet(f.id)} />
              </View>
            </View>
          ))}
        </>
      )}

      {mediasAValider.length > 0 && (
        <>
          <Text style={styles.section}>🎵 Médias audio/vidéo en attente ({mediasAValider.length})</Text>
          <Text style={styles.hint}>
            Une chorale a ajouté ces fichiers à un chant. Ils restent invisibles pour les autres chorales tant que vous
            ne les validez pas -- le chant lui-même reste, lui, pleinement visible/complet entre-temps.
          </Text>
          {mediasAValider.map((m) => (
            <View key={m.id} style={styles.carte}>
              <Text style={styles.titreCarte}>{m.type === "audio" ? "🎵" : "🎥"} {m.filename}</Text>
              <Text style={styles.sousTitreCarte}>Pour « {m.chant_titre ?? "?"} » · Ajouté par {m.chorale_nom ?? "?"}</Text>
              <View style={styles.actionsCarte}>
                <LienAction cle={`valider-media-${m.id}`} actionsEnCours={actionsEnCours} texte="✅ Valider" onPress={() => onValiderMedia(m.id)} />
                <LienAction cle={`rejeter-media-${m.id}`} actionsEnCours={actionsEnCours} texte="Rejeter" danger onPress={() => onRejeterMedia(m.id)} />
              </View>
            </View>
          ))}
        </>
      )}

      <Text style={styles.section}>👥 Créer une chorale</Text>
      <Text style={styles.label}>Nom de la chorale</Text>
      <TextInput style={styles.champ} placeholder="Ex : Chorale Sainte Cécile" value={nomChorale} onChangeText={setNomChorale} />
      <Text style={styles.label}>Identifiant de connexion</Text>
      <TextInput style={styles.champ} placeholder="Ex : chorale-sainte-cecile" value={usernameChorale} onChangeText={setUsernameChorale} autoCapitalize="none" />
      <Bouton titre="+ Créer la chorale" onPress={onCreerChorale} enCours={creationChoraleEnCours} desactive={!nomChorale.trim() || !usernameChorale.trim()} />

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
            <LienAction cle={`reset-${c.id}`} actionsEnCours={actionsEnCours} texte="Réinitialiser mdp" onPress={() => onReset(c.id)} />
            {c.suppression_date_butoir ? (
              <LienAction cle={`annuler-suppr-${c.id}`} actionsEnCours={actionsEnCours} texte="Annuler suppression" onPress={() => onAnnulerSuppression(c.id)} />
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
                  {" • "}{licence.feuillets_produits} feuillet{licence.feuillets_produits !== 1 ? "s" : ""} produit{licence.feuillets_produits !== 1 ? "s" : ""}
                  {licence.quota_feuillets != null ? ` / ${licence.quota_feuillets}` : " (illimité)"}
                  {licence.expire_le ? ` • expire le ${licence.expire_le}` : ""}
                </Text>
                <View style={styles.actionsCarte}>
                  <Pressable onPress={() => ouvrirConfigLicence(c.id, licence)}><Text style={styles.lien}>Configurer</Text></Pressable>
                  <Pressable onPress={() => ouvrirAppareils(licence)}><Text style={styles.lien}>Voir les appareils</Text></Pressable>
                  <LienAction cle={`regen-licence-${licence.id}`} actionsEnCours={actionsEnCours} texte="Régénérer le code" onPress={() => regenererCodeLicence(licence)} />
                  <LienAction
                    cle={`toggle-licence-${licence.id}`} actionsEnCours={actionsEnCours}
                    texte={licence.statut === "active" ? "Révoquer" : "Réactiver"}
                    danger={licence.statut === "active"}
                    onPress={() => toggleStatutLicence(licence)}
                  />
                </View>
              </>
            ) : (
              <Pressable onPress={() => ouvrirConfigLicence(c.id, null)}>
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
            <LienAction cle={`valider-demande-${d.id}`} actionsEnCours={actionsEnCours} texte="Valider (supprimer)" danger onPress={() => onValiderDemande(d.id)} />
            <LienAction cle={`annuler-demande-${d.id}`} actionsEnCours={actionsEnCours} texte="Annuler" onPress={() => onAnnulerDemande(d.id)} />
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
            <LienAction cle={`valider-categorie-${c.id}`} actionsEnCours={actionsEnCours} texte="Valider" onPress={() => onValiderCategorie(c.id)} />
            <LienAction cle={`rejeter-categorie-${c.id}`} actionsEnCours={actionsEnCours} texte="Rejeter" danger onPress={() => onRejeterCategorie(c.id)} />
          </View>
        </View>
      ))}

      <Text style={styles.section}>Ressources masquées ({masques.length})</Text>
      {masques.map((m) => (
        <View key={m.id} style={styles.carte}>
          <Text style={styles.titreCarte}>{m.type_cible} #{m.cible_id}</Text>
          <LienAction cle={`restaurer-masque-${m.id}`} actionsEnCours={actionsEnCours} texte="Restaurer pour cette chorale" onPress={() => onRestaurerMasque(m.id)} />
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
              <Pressable onPress={() => setPlanificationId(null)} disabled={planificationEnCours}><Text style={styles.lien}>Annuler</Text></Pressable>
              <Pressable onPress={confirmerPlanification} disabled={planificationEnCours} style={{ opacity: planificationEnCours ? 0.5 : 1 }}>
                {planificationEnCours
                  ? <ActivityIndicator size="small" color="#dc2626" />
                  : <Text style={[styles.lien, { color: "#dc2626" }]}>Confirmer</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!configCible} animationType="fade" transparent onRequestClose={() => setConfigCible(null)}>
        <View style={styles.fondModal}>
          <View style={styles.boiteModal}>
            <Text style={styles.titreCarte}>{configCible?.licence ? "Configurer la licence" : "Générer une licence"}</Text>
            <Text style={styles.label}>Appareils autorisés</Text>
            <TextInput
              style={styles.champ}
              keyboardType="number-pad"
              value={configMaxAppareils}
              onChangeText={setConfigMaxAppareils}
              placeholder="1"
            />
            <Text style={styles.label}>Quota de feuillets (vide = illimité)</Text>
            <TextInput
              style={styles.champ}
              keyboardType="number-pad"
              value={configQuota}
              onChangeText={setConfigQuota}
              placeholder="Ex : 50"
            />
            <Text style={styles.label}>Date d'expiration (vide = jamais)</Text>
            <Pressable style={styles.champ} onPress={() => setConfigPickerVisible(true)}>
              <Text>{configExpireLe ?? "Aucune expiration"}</Text>
            </Pressable>
            {!!configExpireLe && (
              <Pressable onPress={() => setConfigExpireLe(null)}><Text style={[styles.lien, { color: "#dc2626", marginBottom: 8 }]}>Retirer l'expiration</Text></Pressable>
            )}
            {configPickerVisible && (
              <DateTimePicker
                value={configExpireLe ? dateIsoVersDate(configExpireLe) : new Date()}
                mode="date"
                display={Platform.OS === "ios" ? "inline" : "default"}
                onChange={(event, selectionne) => {
                  if (Platform.OS !== "ios") setConfigPickerVisible(false);
                  if (event.type === "set" && selectionne) setConfigExpireLe(dateVersIso(selectionne));
                }}
              />
            )}
            <View style={styles.actionsCarte}>
              <Pressable onPress={() => setConfigCible(null)}><Text style={styles.lien}>Annuler</Text></Pressable>
              <Pressable onPress={validerConfigLicence}>
                <Text style={[styles.lien, { fontWeight: "700" }]}>{configEnCours ? "Enregistrement..." : "Enregistrer"}</Text>
              </Pressable>
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
                    <View style={{ marginTop: 6 }}>
                      <LienAction
                        cle={`revoquer-appareil-${a.appareil_id}`} actionsEnCours={actionsEnCours}
                        texte="Révoquer cet appareil" danger
                        onPress={() => appareilsModal && revoquerAppareil(appareilsModal, a.appareil_id)}
                      />
                    </View>
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
