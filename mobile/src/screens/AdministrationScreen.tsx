import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Clipboard from "expo-clipboard";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import QRCode from "react-native-qrcode-svg";
import { cleAdminExiste, genererCleAdmin, exporterSauvegardeCle, restaurerCleAdmin, signerLicence, reSignerLicence } from "../licence/adminSignature";
import { verifierLicenceBlob } from "../licence/verification";
import { getCleAdminSauvegardee, setCleAdminSauvegardee } from "../storage/secureStore";
import {
  listerChoralesDetail, creerChorale, reinitialiserMotDePasse, planifierSuppression, annulerSuppression, ChoraleDetail,
} from "../api/chorales";
import {
  listerDemandes, validerDemande, annulerDemande, remettreEnAttente, DemandeSuppression,
  listerMasques, restaurerMasque, MasqueChorale,
  listerCategoriesModeration, validerCategorie, rejeterCategorie, CategoriePersonnalisee,
  listerChantsPrives, publierChantPrive,
  listerFeuilletsAValider, validerPublicationFeuillet,
  listerMediasEnAttente, validerMedia, rejeterMedia,
  listerPartitionsAValider, validerPartition, rejeterPartition, telechargerApercuPartitionModeration,
} from "../api/moderation";
import { getParametresGlobaux, sauvegarderParametres } from "../api/parametres";
import { Chant, Feuillet, ChantMedia } from "../types";
import { Partition } from "../api/chants";
import {
  listerLicences, creerLicence, configurerLicence, listerActivationsLicence, revoquerLicence, reactiverLicence,
  regenererCode, revoquerActivationAppareil, Licence, ActivationAppareil,
} from "../api/licences";
import Bouton from "../components/Bouton";
import SelectModal from "../components/SelectModal";

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

// Mêmes intitulés/valeurs que le web (index.html ~2237-2241 et ~2285-2288) --
// des modèles de motif prêts à l'emploi, avec une saisie libre en repli.
const RAISONS_PLANIFICATION = [
  { value: "Inactivité prolongée : Absence d'activité ou de création de dépliants liturgiques sur la plateforme depuis plus de 6 mois.", label: "💤 Inactivité prolongée (> 6 mois)" },
  { value: "Non-respect des conditions d'utilisation : Utilisation inappropriée de l'espace de stockage ou diffusion de contenus non conformes.", label: "🚫 Non-respect des conditions d'utilisation" },
  { value: "Fermeture de la chorale : Signalement de la dissolution ou de l'arrêt des activités de la chorale.", label: "🏛️ Fermeture de la chorale" },
  { value: "Doublon ou compte de test : Compte créé par erreur ou utilisé temporairement pour des tests de mise en route.", label: "📋 Doublon ou compte de test" },
  { value: "autre", label: "Saisie personnalisée..." },
];

const RAISONS_ANNULATION = [
  { value: "Confirmation d'activité : Suite à vos explications, nous confirmons le maintien de votre compte actif sur la plateforme.", label: "✓ Confirmation d'activité (Révision approuvée)" },
  { value: "Assistance technique apportée : Les problèmes techniques ou d'accès ayant été résolus, le compte est rétabli.", label: "🛠️ Assistance technique apportée" },
  { value: "Malentendu clarifié : Le malentendu a été résolu, la planification de la suppression est annulée.", label: "🤝 Malentendu clarifié" },
  { value: "autre", label: "Saisie personnalisée..." },
];

const DELAIS_PLANIFICATION = [
  { value: "7", label: "7 jours" },
  { value: "15", label: "15 jours" },
  { value: "30", label: "30 jours" },
  { value: "custom", label: "Choisir une date sur le calendrier..." },
];

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
  const [raisonPlanificationPreset, setRaisonPlanificationPreset] = useState(RAISONS_PLANIFICATION[0].value);
  const [delaiPlanification, setDelaiPlanification] = useState<"7" | "15" | "30" | "custom">("15");
  const [datePlanificationCustom, setDatePlanificationCustom] = useState<string | null>(null);
  const [datePlanificationPickerVisible, setDatePlanificationPickerVisible] = useState(false);
  const [annulationId, setAnnulationId] = useState<number | null>(null);
  const [raisonAnnulationPreset, setRaisonAnnulationPreset] = useState(RAISONS_ANNULATION[0].value);
  const [raisonAnnulationCustom, setRaisonAnnulationCustom] = useState("");
  const [motDePasseReinitialise, setMotDePasseReinitialise] = useState<string | null>(null);
  const [demandesArchivees, setDemandesArchivees] = useState<DemandeSuppression[]>([]);
  const [partitionsAValider, setPartitionsAValider] = useState<Partition[]>([]);
  const [appareilsModal, setAppareilsModal] = useState<Licence | null>(null);
  const [appareils, setAppareils] = useState<ActivationAppareil[]>([]);
  const [configCible, setConfigCible] = useState<{ choraleId: number; licence: Licence | null } | null>(null);
  const [configMaxAppareils, setConfigMaxAppareils] = useState("1");
  const [configQuota, setConfigQuota] = useState("");
  const [configExpireLe, setConfigExpireLe] = useState<string | null>(null);
  const [configPickerVisible, setConfigPickerVisible] = useState(false);
  const [configEnCours, setConfigEnCours] = useState(false);
  const [licenceEmise, setLicenceEmise] = useState<string | null>(null);
  const [banniereSauvegardeCle, setBanniereSauvegardeCle] = useState(false);
  const [restaurerVisible, setRestaurerVisible] = useState(false);
  const [cleARestaurer, setCleARestaurer] = useState("");
  const [restaurationEnCours, setRestaurationEnCours] = useState(false);

  // Clé Ed25519 de signature des licences : générée une seule fois sur CET
  // appareil admin, jamais transmise au serveur (voir licence/adminSignature.ts).
  // Bannière de rappel PERSISTÉE (voir storage/secureStore.ts::
  // getCleAdminSauvegardee) -- réaffichée à CHAQUE lancement tant que
  // l'admin n'a pas confirmé une sauvegarde, pas seulement à l'instant de la
  // génération : sans sauvegarde, perdre cet appareil rend impossible toute
  // nouvelle licence/modification (les licences déjà émises restent valides
  // côté chorale, la clé publique embarquée dans l'app ne bouge pas).
  const verifierBanniereCle = useCallback(async () => {
    const existe = await cleAdminExiste();
    if (!existe) {
      await genererCleAdmin();
      setBanniereSauvegardeCle(true);
      return;
    }
    setBanniereSauvegardeCle(!(await getCleAdminSauvegardee()));
  }, []);

  useEffect(() => {
    verifierBanniereCle();
  }, [verifierBanniereCle]);

  async function onSauvegarderCle() {
    try {
      await exporterSauvegardeCle();
      await setCleAdminSauvegardee();
      setBanniereSauvegardeCle(false);
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible d'exporter la sauvegarde");
    }
  }

  async function onRestaurerCle() {
    const valeur = cleARestaurer.trim();
    if (!valeur) return;
    setRestaurationEnCours(true);
    try {
      await restaurerCleAdmin(valeur);
      await setCleAdminSauvegardee();
      setRestaurerVisible(false);
      setCleARestaurer("");
      setBanniereSauvegardeCle(false);
      Alert.alert("Clé restaurée", "Cet appareil peut à nouveau signer/modifier des licences avec cette clé.");
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Format de clé invalide");
    } finally {
      setRestaurationEnCours(false);
    }
  }

  async function onCopierLicence() {
    if (!licenceEmise) return;
    await Clipboard.setStringAsync(licenceEmise);
    Alert.alert("Copié", "Le code de licence a été copié dans le presse-papiers.");
  }

  async function onImprimerLicence() {
    if (!licenceEmise) return;
    await Print.printAsync({
      html: `<html><body style="font-family: monospace; padding: 40px; word-break: break-all; font-size: 14px;">
        <h2>DepliantApp -- Code de licence</h2>
        <p>${licenceEmise}</p>
      </body></html>`,
    });
  }

  const charger = useCallback(async () => {
    const [c, d, m, cat, lic, cp, fv, mv, da, pv] = await Promise.all([
      listerChoralesDetail().catch(() => []),
      listerDemandes().catch(() => []),
      listerMasques().catch(() => []),
      listerCategoriesModeration().catch(() => []),
      listerLicences().catch(() => []),
      listerChantsPrives().catch(() => []),
      listerFeuilletsAValider().catch(() => []),
      listerMediasEnAttente().catch(() => []),
      listerDemandes("annulee").catch(() => []),
      listerPartitionsAValider().catch(() => []),
    ]);
    setChorales(c); setDemandes(d); setMasques(m); setCategoriesEnAttente(cat); setLicences(lic);
    setChantsPrives(cp); setFeuilletsAValider(fv); setMediasAValider(mv);
    setDemandesArchivees(da); setPartitionsAValider(pv);
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

  // Signe TOUJOURS localement d'abord (aucun réseau requis -- l'admin peut
  // créer/modifier une licence même hors-ligne, voir licence/adminSignature.ts).
  // L'enregistrement de bookkeeping côté serveur (POST/PUT /licences) est
  // ensuite tenté en best-effort : la licence est déjà valide et prête à
  // être transmise à la chorale que cet appel réussisse ou non -- un échec
  // ne fait qu'empêcher son affichage/suivi dans cet écran tant que
  // l'action n'est pas relancée une fois en ligne.
  async function validerConfigLicence() {
    if (!configCible) return;
    const devMax = Math.max(1, Number(configMaxAppareils) || 1);
    const quota = configQuota.trim() ? Math.max(0, Number(configQuota)) : null;
    setConfigEnCours(true);
    try {
      let blob: string;
      if (configCible.licence) {
        const ancien = verifierLicenceBlob(configCible.licence.code);
        if (!ancien) throw new Error("Impossible de relire la licence existante (signature invalide)");
        blob = (await reSignerLicence(ancien, { devMax, quotaFeuillets: quota, expireLe: configExpireLe })).blob;
      } else {
        const chorale = chorales.find((c) => c.id === configCible.choraleId);
        blob = (await signerLicence({
          choraleId: configCible.choraleId, choraleNom: chorale?.nom ?? "", devMax, quotaFeuillets: quota, expireLe: configExpireLe,
        })).blob;
      }
      const creation = !configCible.licence;
      setConfigCible(null);
      setLicenceEmise(blob);
      try {
        if (creation) await creerLicence(blob);
        else await configurerLicence(configCible.licence!.id, blob);
        await charger();
      } catch {
        Alert.alert(
          "Enregistré localement seulement",
          "La licence est valide et prête à être transmise, mais son suivi côté serveur a échoué (pas de connexion). Relance l'action une fois en ligne pour qu'elle apparaisse dans cette liste.",
        );
      }
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible de générer la licence");
    } finally {
      setConfigEnCours(false);
    }
  }

  async function regenererCodeLicence(licence: Licence) {
    await executerAction(`regen-licence-${licence.id}`, async () => {
      try {
        const ancien = verifierLicenceBlob(licence.code);
        if (!ancien) throw new Error("Signature de licence existante invalide");
        const { blob } = await reSignerLicence(ancien, { devMax: ancien.devMax, quotaFeuillets: ancien.quotaFeuillets, expireLe: ancien.expireLe });
        setLicenceEmise(blob);
        try {
          await regenererCode(licence.id, blob);
          await charger();
        } catch {
          Alert.alert("Enregistré localement seulement", "Le nouveau code est valide, mais son suivi côté serveur a échoué. Relance une fois en ligne.");
        }
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
        setMotDePasseReinitialise(res.mot_de_passe_initial);
      } catch (erreur: any) {
        Alert.alert("Erreur", erreur?.message ?? "Échec de la réinitialisation");
      }
    });
  }

  async function onCopierMotDePasse() {
    if (!motDePasseReinitialise) return;
    await Clipboard.setStringAsync(motDePasseReinitialise);
    Alert.alert("Copié", "Le mot de passe a été copié dans le presse-papiers.");
  }

  function onPlanifier(id: number) {
    setRaisonPlanification("");
    setRaisonPlanificationPreset(RAISONS_PLANIFICATION[0].value);
    setDelaiPlanification("15");
    setDatePlanificationCustom(null);
    setPlanificationId(id);
  }

  const [planificationEnCours, setPlanificationEnCours] = useState(false);

  async function confirmerPlanification() {
    if (!planificationId) return;
    const raison = raisonPlanificationPreset === "autre" ? raisonPlanification.trim() : raisonPlanificationPreset;
    if (!raison) return;
    if (delaiPlanification === "custom" && !datePlanificationCustom) return;
    setPlanificationEnCours(true);
    try {
      if (delaiPlanification === "custom") {
        await planifierSuppression(planificationId, raison, undefined, datePlanificationCustom!);
      } else {
        await planifierSuppression(planificationId, raison, Number(delaiPlanification));
      }
      setPlanificationId(null);
      await charger();
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Échec de la planification");
    } finally {
      setPlanificationEnCours(false);
    }
  }

  function onAnnulerSuppression(id: number) {
    setRaisonAnnulationPreset(RAISONS_ANNULATION[0].value);
    setRaisonAnnulationCustom("");
    setAnnulationId(id);
  }

  const [annulationEnCours, setAnnulationEnCours] = useState(false);

  async function confirmerAnnulation() {
    if (!annulationId) return;
    const raison = raisonAnnulationPreset === "autre" ? raisonAnnulationCustom.trim() : raisonAnnulationPreset;
    if (!raison) return;
    setAnnulationEnCours(true);
    try {
      await annulerSuppression(annulationId, raison);
      setAnnulationId(null);
      await charger();
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Échec de l'annulation");
    } finally {
      setAnnulationEnCours(false);
    }
  }

  async function onRestaurerDemandeArchivee(id: number) {
    await executerAction(`restaurer-demande-${id}`, async () => {
      try { await remettreEnAttente(id); await charger(); } catch (erreur: any) { Alert.alert("Erreur", erreur?.message ?? "Échec"); }
    });
  }

  async function ouvrirApercuPartition(id: number) {
    await executerAction(`apercu-partition-${id}`, async () => {
      try {
        const uri = await telechargerApercuPartitionModeration(id);
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf" });
      } catch (erreur: any) {
        Alert.alert("Erreur", erreur?.message ?? "Impossible d'ouvrir cette partition");
      }
    });
  }

  async function onValiderPartition(id: number) {
    await executerAction(`valider-partition-${id}`, async () => {
      try {
        await validerPartition(id);
        setPartitionsAValider((prev) => prev.filter((p) => p.id !== id));
      } catch (erreur: any) {
        Alert.alert("Erreur", erreur?.message ?? "Impossible de valider cette partition");
      }
    });
  }

  async function onRejeterPartition(id: number) {
    await executerAction(`rejeter-partition-${id}`, async () => {
      try {
        await rejeterPartition(id);
        setPartitionsAValider((prev) => prev.filter((p) => p.id !== id));
      } catch (erreur: any) {
        Alert.alert("Erreur", erreur?.message ?? "Impossible de rejeter cette partition");
      }
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
      {banniereSauvegardeCle && (
        <View style={[styles.carte, styles.carteAvertissement]}>
          <Text style={styles.titreCarte}>🔑 Sauvegarder la clé d'administration</Text>
          <Text style={styles.sousTitreCarte}>
            Cet appareil détient une clé de signature qui n'a pas encore été sauvegardée. Sans sauvegarde, la perte de cet appareil rendrait
            impossible toute nouvelle licence ou modification (les licences déjà émises resteraient valides côté chorale).
          </Text>
          <View style={styles.actionsCarte}>
            <Bouton titre="Sauvegarder maintenant" onPress={onSauvegarderCle} />
            <Pressable onPress={() => setRestaurerVisible(true)}><Text style={styles.lien}>Restaurer une clé existante</Text></Pressable>
          </View>
        </View>
      )}
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

      {partitionsAValider.length > 0 && (
        <>
          <Text style={styles.section}>🎼 Partitions à vérifier ({partitionsAValider.length})</Text>
          <Text style={styles.hint}>
            Une chorale a soumis une copie notée pour ce chant. Une seule partition reste publiée par chant -- la valider
            remplace automatiquement celle éventuellement déjà publiée.
          </Text>
          {partitionsAValider.map((p) => (
            <View key={p.id} style={styles.carte}>
              <Text style={styles.titreCarte}>Chant : {p.chant_titre ?? "?"}</Text>
              <Text style={styles.sousTitreCarte}>
                Proposée par {p.chorale_nom ?? "Système"} · score {p.score_pertinence != null ? `${p.score_pertinence}%` : "analyse impossible"}
              </Text>
              {Object.keys(p.signaux ?? {}).length > 0 && (
                <Text style={styles.sousTitreCarte}>
                  {Object.entries(p.signaux).map(([cle, valeur]) => `${cle} : ${valeur == null ? "n/a" : `${valeur}%`}`).join(" · ")}
                </Text>
              )}
              <View style={styles.actionsCarte}>
                <LienAction cle={`apercu-partition-${p.id}`} actionsEnCours={actionsEnCours} texte="👁 Voir le PDF" onPress={() => ouvrirApercuPartition(p.id)} />
                <LienAction cle={`valider-partition-${p.id}`} actionsEnCours={actionsEnCours} texte="Valider" onPress={() => onValiderPartition(p.id)} />
                <LienAction cle={`rejeter-partition-${p.id}`} actionsEnCours={actionsEnCours} texte="Rejeter" danger onPress={() => onRejeterPartition(p.id)} />
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
          {!!c.must_change_password && (
            <Text style={styles.avertissement}>⚠ Mot de passe pas encore défini</Text>
          )}
          {c.suppression_date_butoir && (
            <Text style={styles.avertissement}>Suppression planifiée : {c.suppression_date_butoir}</Text>
          )}
          {!!c.suppression_demande_revision && (
            <Text style={styles.avertissement}>
              ⌛ Révision demandée{c.suppression_revision_raison ? ` : ${c.suppression_revision_raison}` : ""}
            </Text>
          )}
          <View style={styles.actionsCarte}>
            <LienAction cle={`reset-${c.id}`} actionsEnCours={actionsEnCours} texte="Réinitialiser mdp" onPress={() => onReset(c.id)} />
            {c.suppression_date_butoir ? (
              <Pressable onPress={() => onAnnulerSuppression(c.id)}><Text style={styles.lien}>Annuler suppression</Text></Pressable>
            ) : (
              <Pressable onPress={() => onPlanifier(c.id)}><Text style={[styles.lien, { color: "#dc2626" }]}>Planifier suppression</Text></Pressable>
            )}
          </View>

          <View style={styles.licenceBloc}>
            {licence ? (
              <>
                <Pressable onPress={() => setLicenceEmise(licence.code)}>
                  <Text style={styles.labelLicence}>
                    🔑 Licence : <Text style={styles.codeLicence}>{licence.code.slice(0, 18)}…</Text> <Text style={styles.lien}>Voir / QR</Text>
                  </Text>
                </Pressable>
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

      {demandesArchivees.length > 0 && (
        <>
          <Text style={styles.section}>🗄️ Demandes ignorées / archivées ({demandesArchivees.length})</Text>
          <Text style={styles.hint}>Ces demandes ont été annulées sans supprimer la ressource. Restaurer les remet en attente de décision.</Text>
          {demandesArchivees.map((d) => (
            <View key={d.id} style={styles.carte}>
              <Text style={styles.titreCarte}>{d.type_cible} #{d.cible_id}</Text>
              <Text style={styles.sousTitreCarte}>{d.apercu?.titre ?? d.apercu?.date ?? "Aperçu indisponible"}</Text>
              <View style={styles.actionsCarte}>
                <LienAction
                  cle={`restaurer-demande-${d.id}`} actionsEnCours={actionsEnCours}
                  texte="Restaurer l'état" onPress={() => onRestaurerDemandeArchivee(d.id)}
                />
              </View>
            </View>
          ))}
        </>
      )}

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
          <ScrollView style={styles.boiteModal}>
            <Text style={styles.titreCarte}>⚠️ Planifier la suppression</Text>
            <Text style={styles.label}>Raison de la suppression (modèles rapides)</Text>
            <SelectModal label="Raison" value={raisonPlanificationPreset} options={RAISONS_PLANIFICATION} onChange={setRaisonPlanificationPreset} />
            {raisonPlanificationPreset === "autre" && (
              <TextInput
                style={[styles.champ, { minHeight: 70, textAlignVertical: "top", marginTop: 10 }]}
                placeholder="Raison détaillée..."
                value={raisonPlanification}
                onChangeText={setRaisonPlanification}
                multiline
              />
            )}
            <Text style={[styles.label, { marginTop: 10 }]}>Délai avant suppression définitive</Text>
            <SelectModal
              label="Délai" value={delaiPlanification}
              options={DELAIS_PLANIFICATION}
              onChange={(v) => setDelaiPlanification(v as "7" | "15" | "30" | "custom")}
            />
            {delaiPlanification === "custom" && (
              <>
                <Pressable style={[styles.champ, { marginTop: 10 }]} onPress={() => setDatePlanificationPickerVisible(true)}>
                  <Text>{datePlanificationCustom ?? "Choisir une date"}</Text>
                </Pressable>
                {datePlanificationPickerVisible && (
                  <DateTimePicker
                    value={datePlanificationCustom ? dateIsoVersDate(datePlanificationCustom) : new Date()}
                    mode="date"
                    display={Platform.OS === "ios" ? "inline" : "default"}
                    onChange={(event, selectionne) => {
                      if (Platform.OS !== "ios") setDatePlanificationPickerVisible(false);
                      if (event.type === "set" && selectionne) setDatePlanificationCustom(dateVersIso(selectionne));
                    }}
                  />
                )}
              </>
            )}
            <View style={styles.actionsCarte}>
              <Pressable onPress={() => setPlanificationId(null)} disabled={planificationEnCours}><Text style={styles.lien}>Annuler</Text></Pressable>
              <Pressable onPress={confirmerPlanification} disabled={planificationEnCours} style={{ opacity: planificationEnCours ? 0.5 : 1 }}>
                {planificationEnCours
                  ? <ActivityIndicator size="small" color="#dc2626" />
                  : <Text style={[styles.lien, { color: "#dc2626" }]}>Confirmer</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={!!annulationId} animationType="fade" transparent onRequestClose={() => setAnnulationId(null)}>
        <View style={styles.fondModal}>
          <View style={styles.boiteModal}>
            <Text style={styles.titreCarte}>🔄 Annuler la suppression</Text>
            <Text style={styles.hint}>Un message d'explication sera envoyé automatiquement à la chorale.</Text>
            <Text style={[styles.label, { marginTop: 10 }]}>Motif de l'annulation (modèles rapides)</Text>
            <SelectModal label="Motif" value={raisonAnnulationPreset} options={RAISONS_ANNULATION} onChange={setRaisonAnnulationPreset} />
            {raisonAnnulationPreset === "autre" && (
              <TextInput
                style={[styles.champ, { minHeight: 70, textAlignVertical: "top", marginTop: 10 }]}
                placeholder="Motif détaillé..."
                value={raisonAnnulationCustom}
                onChangeText={setRaisonAnnulationCustom}
                multiline
              />
            )}
            <View style={styles.actionsCarte}>
              <Pressable onPress={() => setAnnulationId(null)} disabled={annulationEnCours}><Text style={styles.lien}>Fermer</Text></Pressable>
              <Pressable onPress={confirmerAnnulation} disabled={annulationEnCours} style={{ opacity: annulationEnCours ? 0.5 : 1 }}>
                {annulationEnCours
                  ? <ActivityIndicator size="small" color="#2563eb" />
                  : <Text style={[styles.lien, { fontWeight: "700" }]}>Confirmer</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!motDePasseReinitialise} animationType="fade" transparent onRequestClose={() => setMotDePasseReinitialise(null)}>
        <View style={styles.fondModal}>
          <View style={styles.boiteModal}>
            <Text style={styles.titreCarte}>Mot de passe réinitialisé</Text>
            <Text style={[styles.hint, { marginTop: 6 }]}>Transmets ce mot de passe temporaire à la chorale -- un changement lui sera demandé à sa prochaine connexion.</Text>
            <Text style={[styles.codeLicence, { marginTop: 10, textAlign: "center" }]}>{motDePasseReinitialise}</Text>
            <View style={styles.actionsCarte}>
              <Pressable onPress={onCopierMotDePasse}><Text style={styles.lien}>📋 Copier</Text></Pressable>
            </View>
            <View style={{ marginTop: 14 }}>
              <Bouton titre="Fermer" onPress={() => setMotDePasseReinitialise(null)} />
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
            <Text style={styles.titreCarte}>Appareils activés -- {appareilsModal?.code.slice(0, 14)}…</Text>
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

      <Modal visible={!!licenceEmise} animationType="fade" transparent onRequestClose={() => setLicenceEmise(null)}>
        <View style={styles.fondModal}>
          <View style={styles.boiteModal}>
            <Text style={styles.titreCarte}>Licence à transmettre</Text>
            <View style={styles.conteneurQrLicence}>
              {licenceEmise && <QRCode value={licenceEmise} size={220} />}
            </View>
            <Text style={styles.hint} numberOfLines={3}>{licenceEmise}</Text>
            <View style={styles.actionsCarte}>
              <Pressable onPress={onCopierLicence}><Text style={styles.lien}>📋 Copier</Text></Pressable>
              <Pressable onPress={onImprimerLicence}><Text style={styles.lien}>🖨️ Imprimer</Text></Pressable>
            </View>
            <View style={{ marginTop: 14 }}>
              <Bouton titre="Fermer" onPress={() => setLicenceEmise(null)} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={restaurerVisible} animationType="fade" transparent onRequestClose={() => setRestaurerVisible(false)}>
        <View style={styles.fondModal}>
          <View style={styles.boiteModal}>
            <Text style={styles.titreCarte}>Restaurer une clé existante</Text>
            <Text style={styles.hint}>
              Colle ci-dessous le contenu du fichier de sauvegarde exporté précédemment. Cela remplacera la clé de cet appareil.
            </Text>
            <TextInput
              style={[styles.champ, { minHeight: 80, textAlignVertical: "top", marginTop: 10 }]}
              placeholder="Clé de sauvegarde (base64)"
              value={cleARestaurer}
              onChangeText={setCleARestaurer}
              multiline
              autoCapitalize="none"
            />
            <View style={styles.actionsCarte}>
              <Pressable onPress={() => setRestaurerVisible(false)} disabled={restaurationEnCours}><Text style={styles.lien}>Annuler</Text></Pressable>
              <Pressable onPress={onRestaurerCle} disabled={restaurationEnCours || !cleARestaurer.trim()}>
                {restaurationEnCours
                  ? <ActivityIndicator size="small" color="#2563eb" />
                  : <Text style={[styles.lien, { fontWeight: "700" }]}>Restaurer</Text>}
              </Pressable>
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
  carteAvertissement: { borderWidth: 1, borderColor: "#f59e0b", backgroundColor: "#fffbeb" },
  conteneurQrLicence: { alignItems: "center", marginVertical: 16 },
});
