import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useIdentite } from "../context/IdentiteContext";
import { getParametres, sauvegarderParametres } from "../api/parametres";
import { apiFetch } from "../api/client";
import { effacerJetonSession } from "../storage/secureStore";
import Bouton from "../components/Bouton";

interface Props {
  onDeconnecte: () => void;
}

type Onglet = "informations" | "securite" | "compte";

const CLE_PROFIL_LOCAL = "depliantapp.profil_local";

// Reproduit le modal "Mon profil" du web : Informations (mixte -- chorale
// /paroisse/contact vont au backend, le reste est local à l'appareil comme
// sur le web, voir memory) / Sécurité (changement de mot de passe) / Infos
// du compte (lecture seule).
export default function ProfilScreen({ onDeconnecte }: Props) {
  const { identite, rafraichirIdentite } = useIdentite();
  const [onglet, setOnglet] = useState<Onglet>("informations");

  const [choraleNom, setChoraleNom] = useState("");
  const [paroisse, setParoisse] = useState("");
  const [contact, setContact] = useState("");

  const [nomComplet, setNomComplet] = useState("");
  const [ccb, setCcb] = useState("");
  const [telephone, setTelephone] = useState("");
  const [email, setEmail] = useState("");

  const [motDePasseActuel, setMotDePasseActuel] = useState("");
  const [nouveauMotDePasse, setNouveauMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    rafraichirIdentite();
    getParametres().then((d) => {
      setChoraleNom(d.chorale ?? ""); setParoisse(d.paroisse ?? ""); setContact(d.contact ?? "");
    }).catch(() => {});
    AsyncStorage.getItem(`${CLE_PROFIL_LOCAL}.${identite?.username ?? ""}`).then((brut) => {
      if (!brut) return;
      try {
        const d = JSON.parse(brut);
        setNomComplet(d.nomComplet ?? ""); setCcb(d.ccb ?? ""); setTelephone(d.telephone ?? ""); setEmail(d.email ?? "");
      } catch {}
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exigences = {
    longueur: nouveauMotDePasse.length >= 8,
    majuscule: /[A-Z]/.test(nouveauMotDePasse),
    minuscule: /[a-z]/.test(nouveauMotDePasse),
    chiffre: /[0-9]/.test(nouveauMotDePasse),
    special: /[^A-Za-z0-9]/.test(nouveauMotDePasse),
  };
  const scoreForce = Object.values(exigences).filter(Boolean).length;
  const labelForce = scoreForce <= 2 ? "Faible" : scoreForce <= 4 ? "Moyenne" : "Forte";
  const couleurForce = scoreForce <= 2 ? "#ef4444" : scoreForce <= 4 ? "#d97706" : "#16a34a";

  async function enregistrerModifications() {
    try {
      await sauvegarderParametres({ chorale: choraleNom, paroisse, contact });
      await AsyncStorage.setItem(`${CLE_PROFIL_LOCAL}.${identite?.username ?? ""}`, JSON.stringify({ nomComplet, ccb, telephone, email }));
      Alert.alert("Enregistré", "Les modifications ont été enregistrées.");
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible d'enregistrer");
    }
  }

  async function changerMotDePasse() {
    if (nouveauMotDePasse !== confirmation) {
      Alert.alert("Erreur", "La confirmation ne correspond pas au nouveau mot de passe.");
      return;
    }
    try {
      await apiFetch("/auth/change-password", {
        method: "POST",
        body: { mot_de_passe_actuel: motDePasseActuel, nouveau_mot_de_passe: nouveauMotDePasse },
      });
      setMotDePasseActuel(""); setNouveauMotDePasse(""); setConfirmation("");
      Alert.alert("Mot de passe modifié");
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Mot de passe actuel incorrect");
    }
  }

  function deconnexionTousAppareils() {
    Alert.alert("Fonctionnalité non disponible", "La déconnexion à distance des autres appareils n'est pas disponible pour le moment.");
  }

  async function seDeconnecter() {
    await effacerJetonSession();
    onDeconnecte();
  }

  return (
    <ScrollView style={styles.fond} contentContainerStyle={styles.scroll}>
      <Text style={styles.titre}>Mon profil</Text>
      <Text style={styles.sousTitre}>Gérez les informations de votre compte.</Text>

      <View style={styles.tabs}>
        <Pressable style={[styles.tab, onglet === "informations" && styles.tabActif]} onPress={() => setOnglet("informations")}>
          <Text style={[styles.texteTab, onglet === "informations" && styles.texteTabActif]}>👤 Informations</Text>
        </Pressable>
        <Pressable style={[styles.tab, onglet === "securite" && styles.tabActif]} onPress={() => setOnglet("securite")}>
          <Text style={[styles.texteTab, onglet === "securite" && styles.texteTabActif]}>🔒 Sécurité</Text>
        </Pressable>
        <Pressable style={[styles.tab, onglet === "compte" && styles.tabActif]} onPress={() => setOnglet("compte")}>
          <Text style={[styles.texteTab, onglet === "compte" && styles.texteTabActif]}>ℹ️ Infos du compte</Text>
        </Pressable>
      </View>

      {onglet === "informations" && (
        <View>
          <Text style={styles.label}>Nom complet</Text>
          <TextInput style={styles.champ} placeholder="Entrez votre nom..." value={nomComplet} onChangeText={setNomComplet} />
          <Text style={styles.label}>Nom de la chorale</Text>
          <TextInput style={styles.champ} placeholder="Chorale..." value={choraleNom} onChangeText={setChoraleNom} />
          <Text style={styles.label}>Paroisse</Text>
          <TextInput style={styles.champ} placeholder="Paroisse..." value={paroisse} onChangeText={setParoisse} />
          <Text style={styles.label}>CCB / Quartier</Text>
          <TextInput style={styles.champ} placeholder="CCB..." value={ccb} onChangeText={setCcb} />
          <Text style={styles.label}>Téléphone</Text>
          <TextInput style={styles.champ} placeholder="Contact..." value={telephone} onChangeText={setTelephone} />
          <Text style={styles.label}>Contact (pied de feuillet)</Text>
          <TextInput style={styles.champ} value={contact} onChangeText={setContact} />
          <Text style={styles.label}>Adresse e-mail</Text>
          <TextInput style={styles.champ} placeholder="Email..." value={email} onChangeText={setEmail} autoCapitalize="none" />
          <Bouton titre="✓ Enregistrer les modifications" onPress={enregistrerModifications} />
        </View>
      )}

      {onglet === "securite" && (
        <View>
          <Text style={styles.label}>Mot de passe actuel</Text>
          <TextInput style={styles.champ} secureTextEntry value={motDePasseActuel} onChangeText={setMotDePasseActuel} />
          <Text style={styles.label}>Nouveau mot de passe</Text>
          <TextInput style={styles.champ} secureTextEntry value={nouveauMotDePasse} onChangeText={setNouveauMotDePasse} />
          <Text style={styles.label}>Confirmation</Text>
          <TextInput style={styles.champ} secureTextEntry value={confirmation} onChangeText={setConfirmation} />

          <View style={styles.rangeeForce}>
            <Text style={styles.labelForce}>Robustesse :</Text>
            <Text style={[styles.labelForce, { color: couleurForce, fontWeight: "700" }]}>{labelForce}</Text>
          </View>
          <View style={styles.barreForce}>
            <View style={[styles.barreForceRemplie, { width: `${(scoreForce / 5) * 100}%`, backgroundColor: couleurForce }]} />
          </View>

          <View style={styles.exigences}>
            <Text style={styles.titreExigences}>Exigences de sécurité :</Text>
            <Text style={styles.exigence}>{exigences.longueur ? "✅" : "❌"} minimum 8 caractères</Text>
            <Text style={styles.exigence}>{exigences.majuscule ? "✅" : "❌"} une lettre majuscule</Text>
            <Text style={styles.exigence}>{exigences.minuscule ? "✅" : "❌"} une lettre minuscule</Text>
            <Text style={styles.exigence}>{exigences.chiffre ? "✅" : "❌"} un chiffre</Text>
            <Text style={styles.exigence}>{exigences.special ? "✅" : "❌"} un caractère spécial</Text>
          </View>

          <Bouton
            titre="Changer le mot de passe"
            onPress={changerMotDePasse}
            desactive={!motDePasseActuel || nouveauMotDePasse.length < 8 || !confirmation}
          />
          <View style={{ marginTop: 12 }}>
            <Bouton titre="🛡️ Déconnexion de tous les appareils" variante="contour" onPress={deconnexionTousAppareils} />
          </View>
        </View>
      )}

      {onglet === "compte" && (
        <View style={styles.carteCompte}>
          <View style={styles.ligneCompte}><Text style={styles.labelCompte}>Identifiant</Text><Text style={styles.valeurCompte}>{identite?.username ?? "-"}</Text></View>
          <View style={styles.ligneCompte}><Text style={styles.labelCompte}>Rôle</Text><Text style={styles.valeurCompte}>{identite?.type === "super" ? "SUPERADMIN" : "CHORALE"}</Text></View>
          <View style={styles.ligneCompte}><Text style={styles.labelCompte}>Statut du compte</Text><Text style={styles.badgeVerifie}>Compte vérifié ✅</Text></View>
        </View>
      )}

      <View style={{ marginTop: 24 }}>
        <Bouton titre="Se déconnecter" onPress={seDeconnecter} variante="contour" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fond: { backgroundColor: "#eef2f9" },
  scroll: { padding: 16, paddingBottom: 40 },
  titre: { fontSize: 20, fontWeight: "800", color: "#1F4A7C" },
  sousTitre: { fontSize: 12, color: "#64748b", marginTop: 2, marginBottom: 14 },
  tabs: { flexDirection: "row", gap: 8, marginBottom: 16 },
  tab: { backgroundColor: "#fff", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, flex: 1, alignItems: "center" },
  tabActif: { backgroundColor: "#2563eb" },
  texteTab: { fontSize: 11, color: "#334155", fontWeight: "600" },
  texteTabActif: { color: "#fff" },
  label: { fontSize: 12, color: "#64748b", marginBottom: 4, marginTop: 6 },
  champ: { borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 10, padding: 12, backgroundColor: "#fff", marginBottom: 4 },
  rangeeForce: { flexDirection: "row", justifyContent: "space-between", marginTop: 14 },
  labelForce: { fontSize: 11, color: "#64748b" },
  barreForce: { height: 6, backgroundColor: "#e2e8f0", borderRadius: 3, marginTop: 4, overflow: "hidden" },
  barreForceRemplie: { height: "100%" },
  exigences: { backgroundColor: "#f8fafc", borderRadius: 10, padding: 14, marginTop: 16, marginBottom: 16 },
  titreExigences: { fontSize: 12, fontWeight: "700", color: "#475569", marginBottom: 6 },
  exigence: { fontSize: 12, color: "#64748b", marginBottom: 4 },
  carteCompte: { backgroundColor: "#f8fafc", borderRadius: 12, borderWidth: 1, borderColor: "#e2e8f0", padding: 16 },
  ligneCompte: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", paddingBottom: 10, marginBottom: 10 },
  labelCompte: { fontSize: 13, color: "#64748b" },
  valeurCompte: { fontSize: 13, fontWeight: "700", color: "#1F4A7C" },
  badgeVerifie: { fontSize: 11, backgroundColor: "#dcfce7", color: "#15803d", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, fontWeight: "700" },
});
