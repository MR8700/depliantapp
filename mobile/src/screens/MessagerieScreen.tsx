import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  listerThreadsAdmin, listerMessages, envoyerMessage, modifierMessage, supprimerMessage,
  toggleReaction, marquerLu, urlPieceJointe, FilThread, Message, PieceJointeAEnvoyer,
} from "../api/messages";
import { jetonAuthorizationHeader } from "../api/client";
import { useIdentite } from "../context/IdentiteContext";

const EMOJIS = ["❤️", "👍", "👏", "🙏", "😂", "🎵"];
// Mêmes 10 emojis que le picker rapide du web (app.js::initMessagerieEventListeners).
const EMOJIS_PICKER = ["😀", "😂", "❤️", "👍", "👏", "🙏", "🎵", "🎉", "🔥", "✨"];
const INTERVALLE_POLLING_MS = 3000;

function formaterOctets(octets: number | null): string {
  if (!octets) return "0 octet";
  if (octets < 1024) return `${octets} octets`;
  if (octets < 1048576) return `${(octets / 1024).toFixed(1)} Ko`;
  return `${(octets / 1048576).toFixed(1)} Mo`;
}

function iconePieceJointe(nomFichier: string | null): string {
  const ext = (nomFichier ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "📄";
  if (["doc", "docx"].includes(ext)) return "📝";
  if (["xls", "xlsx"].includes(ext)) return "📊";
  if (["ppt", "pptx"].includes(ext)) return "📉";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "📦";
  return "📁";
}

export default function MessagerieScreen() {
  const { estSuperAdmin, identite } = useIdentite();
  const estFocalise = useIsFocused();
  const [threads, setThreads] = useState<FilThread[]>([]);
  const [choraleActive, setChoraleActive] = useState<{ id: number; nom: string } | null>(
    estSuperAdmin ? null : { id: identite?.compte_id ?? 0, nom: identite?.nom ?? "Administrateur" },
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [texte, setTexte] = useState("");
  const [messageEnReponseA, setMessageEnReponseA] = useState<Message | null>(null);
  const [messageEnEdition, setMessageEnEdition] = useState<Message | null>(null);
  const [rechercheThreads, setRechercheThreads] = useState("");
  const [filtreThreads, setFiltreThreads] = useState<"all" | "unread" | "archived">("all");
  const [archives] = useState<number[]>([]);
  const [pieceJointe, setPieceJointe] = useState<PieceJointeAEnvoyer | null>(null);
  const [menuAttachOuvert, setMenuAttachOuvert] = useState(false);
  const [menuEmojiOuvert, setMenuEmojiOuvert] = useState(false);
  const [telechargementEnCours, setTelechargementEnCours] = useState<number | null>(null);
  const intervalle = useRef<ReturnType<typeof setInterval> | null>(null);
  const [authHeaders, setAuthHeaders] = useState<Record<string, string>>({});

  useEffect(() => { jetonAuthorizationHeader().then(setAuthHeaders); }, []);

  const chargerMessages = useCallback(async () => {
    if (!choraleActive) return;
    try {
      const liste = await listerMessages(estSuperAdmin ? choraleActive.id : undefined);
      setMessages(liste);
      marquerLu(estSuperAdmin ? choraleActive.id : undefined).catch(() => {});
    } catch {
      // silencieux : la liste précédente reste affichée (voir pattern web §10 de l'inventaire)
    }
  }, [choraleActive, estSuperAdmin]);

  const chargerThreads = useCallback(async () => {
    try { setThreads(await listerThreadsAdmin()); } catch {}
  }, []);

  useEffect(() => {
    if (!estFocalise) return;
    if (choraleActive) chargerMessages();
    else chargerThreads();
    intervalle.current = setInterval(() => {
      if (choraleActive) chargerMessages(); else chargerThreads();
    }, INTERVALLE_POLLING_MS);
    return () => { if (intervalle.current) clearInterval(intervalle.current); };
  }, [estFocalise, choraleActive, chargerMessages, chargerThreads]);

  async function envoyer() {
    if ((!texte.trim() && !pieceJointe) || !choraleActive) return;
    const brouillon = texte.trim();
    const piece = pieceJointe;
    setTexte("");
    setPieceJointe(null);
    const idTemporaire = -Date.now();
    const optimiste: Message = {
      id: idTemporaire, chorale_id: choraleActive.id, expediteur_type: estSuperAdmin ? "super" : "chorale",
      texte: brouillon || null, piece_jointe_content_type: piece?.type ?? null, piece_jointe_filename: piece?.name ?? null,
      piece_jointe_size: null, lu: false,
      parent_id: messageEnReponseA?.id ?? null, reactions: {}, modifie: false, supprime: false,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimiste]);
    const enReponseA = messageEnReponseA;
    setMessageEnReponseA(null);
    try {
      await envoyerMessage({
        choraleId: estSuperAdmin ? choraleActive.id : undefined,
        texte: brouillon || undefined,
        parentId: enReponseA?.id,
        pieceJointe: piece ?? undefined,
      });
      chargerMessages();
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== idTemporaire));
      Alert.alert("Échec de l'envoi", "Le message n'a pas pu être envoyé.");
    }
  }

  async function choisirImageOuVideo(type: "image" | "video") {
    setMenuAttachOuvert(false);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert("Permission refusée", "Accès à la galerie nécessaire."); return; }
    const resultat = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: type === "image" ? ImagePicker.MediaTypeOptions.Images : ImagePicker.MediaTypeOptions.Videos,
      quality: 0.8,
    });
    if (resultat.canceled || !resultat.assets?.[0]) return;
    const asset = resultat.assets[0];
    const nom = asset.fileName ?? asset.uri.split("/").pop() ?? (type === "image" ? "image.jpg" : "video.mp4");
    const mime = asset.mimeType ?? (type === "image" ? "image/jpeg" : "video/mp4");
    setPieceJointe({ uri: asset.uri, name: nom, type: mime });
  }

  async function choisirFichierOuAudio(type: "audio" | "file") {
    setMenuAttachOuvert(false);
    const resultat = await DocumentPicker.getDocumentAsync({ type: type === "audio" ? "audio/*" : "*/*" });
    if (resultat.canceled || !resultat.assets?.[0]) return;
    const asset = resultat.assets[0];
    setPieceJointe({ uri: asset.uri, name: asset.name, type: asset.mimeType ?? "application/octet-stream" });
  }

  async function ouvrirPieceJointe(message: Message) {
    if (telechargementEnCours === message.id) return;
    setTelechargementEnCours(message.id);
    try {
      const headers = await jetonAuthorizationHeader();
      const dest = `${FileSystem.cacheDirectory}${message.piece_jointe_filename}`;
      const resultat = await FileSystem.downloadAsync(urlPieceJointe(message.id), dest, { headers });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(resultat.uri);
    } catch {
      Alert.alert("Erreur", "Impossible d'ouvrir cette pièce jointe.");
    } finally {
      setTelechargementEnCours(null);
    }
  }

  async function enregistrerEdition() {
    if (!messageEnEdition || !texte.trim()) return;
    try {
      await modifierMessage(messageEnEdition.id, texte.trim());
      setMessageEnEdition(null);
      setTexte("");
      chargerMessages();
    } catch (erreur: any) {
      Alert.alert("Erreur", erreur?.message ?? "Impossible de modifier ce message");
    }
  }

  function confirmerSuppression(message: Message) {
    Alert.alert("Supprimer ce message ?", undefined, [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: async () => {
        try { await supprimerMessage(message.id); chargerMessages(); }
        catch (erreur: any) { Alert.alert("Erreur", erreur?.message ?? "Impossible de supprimer"); }
      } },
    ]);
  }

  async function reagir(message: Message, emoji: string) {
    try { await toggleReaction(message.id, emoji); chargerMessages(); } catch {}
  }

  const estMonMessage = (m: Message) => (estSuperAdmin ? m.expediteur_type === "super" : m.expediteur_type === "chorale");

  if (estSuperAdmin && !choraleActive) {
    const threadsFiltres = threads.filter((t) => {
      if (rechercheThreads.trim() && !t.chorale_nom.toLowerCase().includes(rechercheThreads.trim().toLowerCase())) return false;
      if (filtreThreads === "unread") return t.non_lus > 0;
      if (filtreThreads === "archived") return archives.includes(t.chorale_id);
      return true;
    });
    return (
      <View style={styles.fond}>
        <Text style={styles.titreMessagerie}>Messagerie</Text>
        <View style={styles.rechercheWrapper}>
          <TextInput style={styles.champRecherche} placeholder="Rechercher une chorale..." value={rechercheThreads} onChangeText={setRechercheThreads} />
          <Text>🔍</Text>
        </View>
        <View style={styles.filtresThreads}>
          {(["all", "unread", "archived"] as const).map((f) => (
            <Pressable key={f} style={[styles.filtreThread, filtreThreads === f && styles.filtreThreadActif]} onPress={() => setFiltreThreads(f)}>
              <Text style={[styles.texteFiltreThread, filtreThreads === f && styles.texteFiltreThreadActif]}>
                {f === "all" ? "Tous" : f === "unread" ? "Non lus" : "Archivés"}
              </Text>
            </Pressable>
          ))}
        </View>
      <FlatList
        contentContainerStyle={{ padding: 16 }}
        data={threadsFiltres}
        keyExtractor={(t) => String(t.chorale_id)}
        renderItem={({ item }) => (
          <Pressable style={styles.carteThread} onPress={() => setChoraleActive({ id: item.chorale_id, nom: item.chorale_nom })}>
            <View style={{ flex: 1 }}>
              <Text style={styles.nomThread}>{item.chorale_nom}</Text>
              <Text style={styles.apercuThread} numberOfLines={1}>{item.dernier_message?.texte ?? "Aucun message"}</Text>
            </View>
            {item.non_lus > 0 && (
              <View style={styles.badge}><Text style={styles.badgeTexte}>{item.non_lus}</Text></View>
            )}
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.vide}>Aucune conversation.</Text>}
      />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.fond} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {estSuperAdmin && (
        <Pressable style={styles.retour} onPress={() => setChoraleActive(null)}>
          <Text style={styles.texteRetour}>‹ {choraleActive?.nom}</Text>
        </Pressable>
      )}
      <FlatList
        data={messages.filter((m) => !m.supprime)}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => {
          const moi = estMonMessage(item);
          return (
            <View style={[styles.bulleConteneur, moi ? styles.bulleConteneurMoi : styles.bulleConteneurAutre]}>
              <View style={[styles.bulle, moi ? styles.bulleMoi : styles.bulleAutre]}>
                {item.parent_id && <Text style={styles.citation}>↩ réponse</Text>}
                {item.piece_jointe_filename && (
                  (item.piece_jointe_content_type ?? "").startsWith("image/") ? (
                    <Pressable onPress={() => ouvrirPieceJointe(item)}>
                      <Image source={{ uri: urlPieceJointe(item.id), headers: authHeaders }} style={styles.imagePieceJointe} resizeMode="cover" />
                    </Pressable>
                  ) : (
                    <Pressable style={styles.cartePieceJointe} onPress={() => ouvrirPieceJointe(item)}>
                      <Text style={styles.iconePieceJointe}>
                        {(item.piece_jointe_content_type ?? "").startsWith("video/") ? "🎥"
                          : (item.piece_jointe_content_type ?? "").startsWith("audio/") ? "🎧"
                          : iconePieceJointe(item.piece_jointe_filename)}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.nomPieceJointe, moi && styles.texteBulleMoi]} numberOfLines={1}>{item.piece_jointe_filename}</Text>
                        <Text style={[styles.tailleFichier, moi && styles.texteBulleMoi]}>
                          {telechargementEnCours === item.id ? "Téléchargement..." : formaterOctets(item.piece_jointe_size)}
                        </Text>
                      </View>
                      <Text style={styles.boutonTelecharger}>📥</Text>
                    </Pressable>
                  )
                )}
                {!!item.texte && <Text style={[styles.texteBulle, moi && styles.texteBulleMoi]}>{item.texte}</Text>}
                {item.modifie && <Text style={styles.modifieTag}>modifié</Text>}
              </View>
              <View style={styles.actionsMessage}>
                {EMOJIS.slice(0, 3).map((e) => (
                  <Pressable key={e} onPress={() => reagir(item, e)} hitSlop={6}><Text style={styles.emojiAction}>{e}</Text></Pressable>
                ))}
                <Pressable onPress={() => setMessageEnReponseA(item)} hitSlop={6}><Text style={styles.lienAction}>Répondre</Text></Pressable>
                {moi && (
                  <>
                    <Pressable onPress={() => { setMessageEnEdition(item); setTexte(item.texte ?? ""); }} hitSlop={6}>
                      <Text style={styles.lienAction}>Modifier</Text>
                    </Pressable>
                    <Pressable onPress={() => confirmerSuppression(item)} hitSlop={6}>
                      <Text style={[styles.lienAction, { color: "#dc2626" }]}>Supprimer</Text>
                    </Pressable>
                  </>
                )}
              </View>
              {Object.entries(item.reactions ?? {}).filter(([, u]) => u.length > 0).length > 0 && (
                <View style={styles.reactions}>
                  {Object.entries(item.reactions).filter(([, u]) => u.length > 0).map(([emoji, utilisateurs]) => (
                    <Text key={emoji} style={styles.pillReaction}>{emoji} {utilisateurs.length}</Text>
                  ))}
                </View>
              )}
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.vide}>Aucun message pour le moment.</Text>}
      />
      {(messageEnReponseA || messageEnEdition) && (
        <View style={styles.barreContexte}>
          <Text style={styles.texteContexte} numberOfLines={1}>
            {messageEnEdition ? `Modifier : ${messageEnEdition.texte}` : `Répondre à : ${messageEnReponseA?.texte}`}
          </Text>
          <Pressable onPress={() => { setMessageEnReponseA(null); setMessageEnEdition(null); setTexte(""); }}>
            <Text style={styles.annulerContexte}>✕</Text>
          </Pressable>
        </View>
      )}
      {pieceJointe && (
        <View style={styles.previewPieceJointe}>
          <Text style={styles.textePreviewPieceJointe} numberOfLines={1}>📎 {pieceJointe.name}</Text>
          <Pressable onPress={() => setPieceJointe(null)}><Text style={styles.annulerContexte}>✕</Text></Pressable>
        </View>
      )}
      <View style={styles.composer}>
        {!messageEnEdition && (
          <Pressable style={styles.boutonIcone} onPress={() => setMenuAttachOuvert(true)}>
            <Text style={styles.iconeComposer}>📎</Text>
          </Pressable>
        )}
        {!messageEnEdition && (
          <Pressable style={styles.boutonIcone} onPress={() => setMenuEmojiOuvert(true)}>
            <Text style={styles.iconeComposer}>😊</Text>
          </Pressable>
        )}
        <TextInput
          style={styles.champComposer}
          value={texte}
          onChangeText={setTexte}
          placeholder="Écris un message..."
          multiline
        />
        <Pressable style={styles.boutonEnvoyer} onPress={messageEnEdition ? enregistrerEdition : envoyer}>
          <Text style={styles.texteEnvoyer}>{messageEnEdition ? "✓" : "➤"}</Text>
        </Pressable>
      </View>

      <Modal visible={menuAttachOuvert} animationType="fade" transparent onRequestClose={() => setMenuAttachOuvert(false)}>
        <Pressable style={styles.fondPopover} onPress={() => setMenuAttachOuvert(false)}>
          <View style={styles.popoverAttach}>
            <Pressable style={styles.itemAttach} onPress={() => choisirImageOuVideo("image")}>
              <Text style={styles.texteItemAttach}>🖼️ Image</Text>
            </Pressable>
            <Pressable style={styles.itemAttach} onPress={() => choisirImageOuVideo("video")}>
              <Text style={styles.texteItemAttach}>🎥 Vidéo</Text>
            </Pressable>
            <Pressable style={styles.itemAttach} onPress={() => choisirFichierOuAudio("audio")}>
              <Text style={styles.texteItemAttach}>🎧 Audio</Text>
            </Pressable>
            <Pressable style={styles.itemAttach} onPress={() => choisirFichierOuAudio("file")}>
              <Text style={styles.texteItemAttach}>📁 Fichier</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={menuEmojiOuvert} animationType="fade" transparent onRequestClose={() => setMenuEmojiOuvert(false)}>
        <Pressable style={styles.fondPopover} onPress={() => setMenuEmojiOuvert(false)}>
          <View style={styles.popoverEmoji}>
            {EMOJIS_PICKER.map((e) => (
              <Pressable key={e} onPress={() => { setTexte((t) => t + e); setMenuEmojiOuvert(false); }}>
                <Text style={styles.emojiPopoverItem}>{e}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fond: { flex: 1, backgroundColor: "#eef2f9" },
  titreMessagerie: { fontSize: 18, fontWeight: "800", color: "#1e293b", padding: 16, paddingBottom: 8 },
  rechercheWrapper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderRadius: 10, marginHorizontal: 16, padding: 10, borderWidth: 1, borderColor: "#dbe2ea" },
  champRecherche: { flex: 1, fontSize: 13 },
  filtresThreads: { flexDirection: "row", gap: 8, padding: 16, paddingBottom: 0 },
  filtreThread: { backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  filtreThreadActif: { backgroundColor: "#2563eb" },
  texteFiltreThread: { fontSize: 12, color: "#475569", fontWeight: "600" },
  texteFiltreThreadActif: { color: "#fff" },
  vide: { textAlign: "center", color: "#94a3b8", marginTop: 40 },
  carteThread: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8 },
  nomThread: { fontSize: 15, fontWeight: "700", color: "#1e293b" },
  apercuThread: { fontSize: 13, color: "#64748b", marginTop: 2 },
  badge: { backgroundColor: "#dc2626", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeTexte: { color: "#fff", fontSize: 12, fontWeight: "700" },
  retour: { padding: 12, backgroundColor: "#fff" },
  texteRetour: { color: "#2563eb", fontWeight: "600" },
  bulleConteneur: { marginBottom: 14, maxWidth: "85%" },
  bulleConteneurMoi: { alignSelf: "flex-end", alignItems: "flex-end" },
  bulleConteneurAutre: { alignSelf: "flex-start", alignItems: "flex-start" },
  bulle: { borderRadius: 14, padding: 10 },
  bulleMoi: { backgroundColor: "#2563eb" },
  bulleAutre: { backgroundColor: "#fff" },
  citation: { fontSize: 11, color: "#94a3b8", marginBottom: 2 },
  texteBulle: { fontSize: 14, color: "#1e293b" },
  texteBulleMoi: { color: "#fff" },
  modifieTag: { fontSize: 10, color: "#cbd5e1", marginTop: 2 },
  actionsMessage: { flexDirection: "row", gap: 10, marginTop: 4 },
  emojiAction: { fontSize: 14 },
  lienAction: { fontSize: 11, color: "#64748b" },
  reactions: { flexDirection: "row", gap: 6, marginTop: 4 },
  pillReaction: { fontSize: 11, backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  barreContexte: { flexDirection: "row", justifyContent: "space-between", padding: 10, backgroundColor: "#fef9c3" },
  texteContexte: { flex: 1, fontSize: 12, color: "#713f12" },
  annulerContexte: { color: "#713f12", fontWeight: "700" },
  composer: { flexDirection: "row", alignItems: "flex-end", padding: 10, gap: 8, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  champComposer: { flex: 1, borderWidth: 1, borderColor: "#dbe2ea", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, maxHeight: 100 },
  boutonEnvoyer: { justifyContent: "center", alignItems: "center", width: 40, height: 40, backgroundColor: "#2563eb", borderRadius: 20 },
  texteEnvoyer: { color: "#fff", fontWeight: "700", fontSize: 16 },
  boutonIcone: { justifyContent: "center", alignItems: "center", width: 36, height: 36 },
  iconeComposer: { fontSize: 20 },
  previewPieceJointe: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 10, backgroundColor: "#eef2ff", borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  textePreviewPieceJointe: { flex: 1, fontSize: 12, color: "#3730a3" },
  imagePieceJointe: { width: 200, height: 150, borderRadius: 10, marginBottom: 6 },
  cartePieceJointe: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(0,0,0,0.05)", borderRadius: 10, padding: 8, marginBottom: 6, minWidth: 200 },
  iconePieceJointe: { fontSize: 24 },
  nomPieceJointe: { fontSize: 12, fontWeight: "600", color: "#1e293b" },
  tailleFichier: { fontSize: 10, color: "#64748b" },
  boutonTelecharger: { fontSize: 16 },
  fondPopover: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.3)" },
  popoverAttach: { backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingVertical: 8 },
  itemAttach: { paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#f8fafc" },
  texteItemAttach: { fontSize: 14, fontWeight: "500", color: "#334155" },
  popoverEmoji: { flexDirection: "row", flexWrap: "wrap", gap: 12, backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 },
  emojiPopoverItem: { fontSize: 28 },
});
