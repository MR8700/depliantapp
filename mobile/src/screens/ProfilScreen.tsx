import { useEffect, useState } from "react";
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { useIdentite } from "../context/IdentiteContext";
import { getParametres, sauvegarderParametres } from "../api/parametres";
import { apiFetch } from "../api/client";
import { effacerJetonSession } from "../storage/secureStore";
import { pinDefini, definirPin } from "../licence/pinChorale";
import { synchroniserVerrouillageDisque } from "../licence/metaDisqueLicence";
import { logoutAdminServeur, changerMotDePasseAdminServeur } from "../api/auth";
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
const TAILLE_MAX_AVATAR_OCTETS = 5 * 1024 * 1024;

export default function ProfilScreen({ onDeconnecte }: Props) {
  const { identite, rafraichirIdentite, avatarUri, definirAvatar } = useIdentite();
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

  // Modal de définition du mot de passe de connexion chorale
  const [modalPinVisible, setModalPinVisible] = useState(false);
  const [nouveauPin, setNouveauPin] = useState("");
  const [confirmationPin, setConfirmationPin] = useState("");
  const [enCoursPin, setEnCoursPin] = useState(false);

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

  async function changerAvatar() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert("Permission refusée", "Accès à la galerie nécessaire."); return; }
    const resultat = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, base64: true, allowsEditing: true, aspect: [1, 1],
    });
    if (resultat.canceled || !resultat.assets?.[0]) return;
    const asset = resultat.assets[0];
    if (asset.fileSize && asset.fileSize > TAILLE_MAX_AVATAR_OCTETS) {
      Alert.alert("Fichier trop grand", "5 Mo maximum.");
      return;
    }
    if (!asset.base64) { Alert.alert("Erreur", "Impossible de lire cette image."); return; }
    const mime = asset.mimeType ?? "image/jpeg";
    await definirAvatar(`data:${mime};base64,${asset.base64}`);
  }

  function supprimerAvatar() {
    Alert.alert("Supprimer la photo de profil ?", undefined, [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: () => definirAvatar(null) },
    ]);
  }

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
      await changerMotDePasseAdminServeur(motDePasseActuel, nouveauMotDePasse);
      setMotDePasseActuel(""); setNouveauMotDePasse(""); setConfirmation("");
      Alert.alert("Succès", "Mot de passe administrateur modifié et enregistré sur le serveur.");
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Mot de passe actuel incorrect");
    }
  }

  function deconnexionTousAppareils() {
    Alert.alert("Fonctionnalité non disponible", "La déconnexion à distance des autres appareils n'est pas disponible pour le moment.");
  }

  async function seDeconnecter() {
    if (identite?.type === "super") {
      Alert.alert(
        "Déconnexion administrateur",
        "Voulez-vous vous déconnecter de votre session administrateur sur le serveur ?",
        [
          { text: "Annuler", style: "cancel" },
          {
            text: "Se déconnecter",
            style: "destructive",
            onPress: async () => {
              await logoutAdminServeur();
              onDeconnecte();
            },
          },
        ],
      );
      return;
    }

    // Déconnexion Chorale :
    // On demande à la chorale de définir un mot de passe de connexion si absent,
    // puis on verrouille pour demander la connexion à l'ouverture de l'application.
    const dejaDefini = await pinDefini();
    if (!dejaDefini) {
      setNouveauPin("");
      setConfirmationPin("");
      setModalPinVisible(true);
    } else {
      Alert.alert(
        "Déconnexion de la chorale",
        "L'application va être verrouillée. Votre mot de passe de connexion vous sera demandé pour y accéder à nouveau.",
        [
          { text: "Annuler", style: "cancel" },
          {
            text: "Modifier le mot de passe",
            onPress: () => {
              setNouveauPin("");
              setConfirmationPin("");
              setModalPinVisible(true);
            },
          },
          {
            text: "Se déconnecter",
            style: "destructive",
            onPress: async () => {
              await synchroniserVerrouillageDisque(true);
              onDeconnecte();
            },
          },
        ],
      );
    }
  }

  async function validerNouveauPinEtDeconnecter() {
    if (!nouveauPin || nouveauPin.length < 4) {
      Alert.alert("Mot de passe trop court", "Le mot de passe de connexion doit comporter au moins 4 caractères.");
      return;
    }
    if (nouveauPin !== confirmationPin) {
      Alert.alert("Erreur", "La confirmation ne correspond pas au mot de passe saisi.");
      return;
    }
    setEnCoursPin(true);
    try {
      await definirPin(nouveauPin);
      await synchroniserVerrouillageDisque(true);
      setModalPinVisible(false);
      Alert.alert(
        "Mot de passe configuré",
        "Votre mot de passe de connexion a été enregistré. Il vous sera demandé à chaque ouverture de l'application.",
        [{ text: "OK", onPress: () => onDeconnecte() }],
      );
    } catch {
      Alert.alert("Erreur", "Impossible d'enregistrer le mot de passe de connexion.");
    } finally {
      setEnCoursPin(false);
    }
  }

  return (
    <ScrollView style={styles.fond} contentContainerStyle={styles.scroll}>
      <Text style={styles.titre}>Mon profil</Text>
      <Text style={styles.sousTitre}>Gérez les informations de votre compte.</Text>

      <View style={styles.tabs}>
        <Pressable style={[styles.tab, onglet === "informations" && styles.tabActif]} onPress={() => setOnglet("informations")}>
          <Text style={[styles.texteTab, onglet === "informations" && styles.texteTabActif]}>👤 Informations</Text>
        </Pressable>
        {identite?.type === "super" && (
          <Pressable style={[styles.tab, onglet === "securite" && styles.tabActif]} onPress={() => setOnglet("securite")}>
            <Text style={[styles.texteTab, onglet === "securite" && styles.texteTabActif]}>🔒 Sécurité</Text>
          </Pressable>
        )}
        <Pressable style={[styles.tab, onglet === "compte" && styles.tabActif]} onPress={() => setOnglet("compte")}>
          <Text style={[styles.texteTab, onglet === "compte" && styles.texteTabActif]}>ℹ️ Infos du compte</Text>
        </Pressable>
      </View>

      {onglet === "informations" && (
        <View>
          <View style={styles.blocAvatar}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarPlaceholderTexte}>
                  {(identite?.nom || identite?.username || "?").trim().charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.actionsAvatar}>
              <Pressable style={styles.boutonAvatar} onPress={changerAvatar}>
                <Text style={styles.texteBoutonAvatar}>Changer</Text>
              </Pressable>
              {avatarUri && (
                <Pressable style={[styles.boutonAvatar, styles.boutonAvatarSuppr]} onPress={supprimerAvatar}>
                  <Text style={[styles.texteBoutonAvatar, styles.texteBoutonAvatarSuppr]}>Supprimer</Text>
                </Pressable>
              )}
            </View>
          </View>
          <Text style={styles.label}>{identite?.type === "super" ? "Prénom" : "Nom complet"}</Text>
          <TextInput style={styles.champ} placeholder="Entrez votre nom..." value={nomComplet} onChangeText={setNomComplet} />
          {identite?.type !== "super" && (
            <>
              <Text style={styles.label}>Nom de la chorale</Text>
              <TextInput style={styles.champ} placeholder="Chorale..." value={choraleNom} onChangeText={setChoraleNom} />
            </>
          )}
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

      {onglet === "securite" && identite?.type === "super" && (
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

      <Modal visible={modalPinVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitre}>🔒 Mot de passe de connexion</Text>
            <Text style={styles.modalSousTitre}>
              Pour sécuriser l'accès à votre chorale avant la déconnexion, veuillez définir un mot de passe de connexion.
              Il vous sera demandé à chaque ouverture de l'application.
            </Text>
            <Text style={styles.label}>Mot de passe de connexion</Text>
            <TextInput
              style={styles.champ}
              placeholder="Minimum 4 caractères"
              secureTextEntry
              value={nouveauPin}
              onChangeText={setNouveauPin}
              editable={!enCoursPin}
            />
            <Text style={styles.label}>Confirmation du mot de passe</Text>
            <TextInput
              style={styles.champ}
              placeholder="Répétez le mot de passe"
              secureTextEntry
              value={confirmationPin}
              onChangeText={setConfirmationPin}
              editable={!enCoursPin}
            />
            <View style={{ marginTop: 14 }}>
              <Bouton
                titre="Valider et se déconnecter"
                onPress={validerNouveauPinEtDeconnecter}
                enCours={enCoursPin}
                desactive={!nouveauPin || nouveauPin.length < 4 || !confirmationPin}
              />
            </View>
            <Pressable
              style={styles.boutonAnnulerModal}
              onPress={() => setModalPinVisible(false)}
              disabled={enCoursPin}
            >
              <Text style={styles.texteAnnulerModal}>Annuler</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  blocAvatar: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 18 },
  avatarImage: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#e2e8f0" },
  avatarPlaceholder: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#2f6bb2", alignItems: "center", justifyContent: "center" },
  avatarPlaceholderTexte: { color: "#fff", fontSize: 26, fontWeight: "800" },
  actionsAvatar: { flexDirection: "row", gap: 8 },
  boutonAvatar: { borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#fff" },
  boutonAvatarSuppr: { borderColor: "#fecaca" },
  texteBoutonAvatar: { fontSize: 12, fontWeight: "600", color: "#334155" },
  texteBoutonAvatarSuppr: { color: "#ef4444" },
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
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 },
  modalContent: { backgroundColor: "#fff", borderRadius: 16, padding: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 5 },
  modalTitre: { fontSize: 18, fontWeight: "800", color: "#1F4A7C", textAlign: "center", marginBottom: 8 },
  modalSousTitre: { fontSize: 13, color: "#64748b", textAlign: "center", marginBottom: 16, lineHeight: 18 },
  boutonAnnulerModal: { marginTop: 12, alignItems: "center", paddingVertical: 8 },
  texteAnnulerModal: { color: "#64748b", fontSize: 14, fontWeight: "600" },
});
