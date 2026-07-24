import { Pressable, StyleSheet, Text, View } from "react-native";
import { Chant } from "../types";
import { categorieLabel, etatChant, iconeCategorie, LABEL_ETAT, COULEUR_ETAT, NOMS_LANGUES } from "../utils/labels";

interface Props {
  chant: Chant;
  estSuperAdmin: boolean;
  modeGrille?: boolean;
  onVoir: () => void;
  onModifier: () => void;
  onDupliquer: () => void;
  onFavori: () => void;
  /** Appelé au clic sur le badge d'état, quand il est cliquable (voir
   * calcul ci-dessous) -- la chorale propose une validation, l'admin
   * valide/annule. Absent = badge non-cliquable. */
  onChangerEtat?: () => void;
}

// Reproduit chantCardHtml() (app.js) à l'identique : même contenu (pastille
// catégorie, titre, référence, aperçu du refrain, langue/occasions,
// mots-clés, badge d'état) et mêmes actions selon le rôle (super:
// voir/modifier/dupliquer -- chorale: voir/favori).
export default function ChantCard({ chant, estSuperAdmin, modeGrille, onVoir, onModifier, onDupliquer, onFavori, onChangerEtat }: Props) {
  const etat = etatChant(chant);
  // Cliquable si "à vérifier" (chorale propose / admin valide), ou si
  // "actif" par validation manuelle explicite (admin peut annuler).
  const badgeCliquable = !!onChangerEtat && (etat === "a-verifier" || (etat === "actif" && chant.valide_manuellement && estSuperAdmin));
  const libelleEtat = etat === "a-verifier" && chant.propose_par_chorale_nom
    ? `À vérifier · ${chant.propose_par_chorale_nom}`
    : LABEL_ETAT[etat];
  const apercu = (chant.refrain || chant.couplets[0] || "").slice(0, 80);
  const occasionsText = chant.occasions.length > 0 ? chant.occasions.join(", ") : "N/A";
  const nomLangue = NOMS_LANGUES[chant.langue] || chant.langue || "Français";
  const tagsVisibles = chant.mots_cles.slice(0, 3);
  const tagsRestants = chant.mots_cles.length - 3;

  return (
    <Pressable onPress={onVoir} style={[styles.carte, modeGrille && styles.carteGrille]}>
      <View style={styles.icone}><Text style={styles.iconeTexte}>{iconeCategorie(chant.categorie)}</Text></View>
      <View style={styles.contenu}>
        <View style={styles.ligneTitre}>
          <Text style={styles.pillCategorie}>{categorieLabel(chant.categorie)}</Text>
          <Text style={styles.titre} numberOfLines={1}>{chant.titre || "(sans titre)"}</Text>
        </View>
        {chant.code_reference ? <Text style={styles.reference}>{chant.code_reference}</Text> : null}
        {apercu ? <Text style={styles.apercu} numberOfLines={2}>{apercu}{apercu.length >= 80 ? "..." : ""}</Text> : null}
        <View style={styles.ligneMeta}>
          <Text style={styles.meta}>Langue : <Text style={styles.metaFort}>{nomLangue}</Text></Text>
          <Text style={styles.meta}>Occasions : <Text style={styles.metaFort}>{occasionsText}</Text></Text>
        </View>
        {tagsVisibles.length > 0 && (
          <View style={styles.tags}>
            {tagsVisibles.map((t) => <Text key={t} style={styles.tag}>{t}</Text>)}
            {tagsRestants > 0 && <Text style={[styles.tag, styles.tagPlus]}>+{tagsRestants}</Text>}
          </View>
        )}
      </View>
      <View style={styles.aside}>
        {badgeCliquable ? (
          <Pressable hitSlop={6} onPress={(e) => { e.stopPropagation(); onChangerEtat?.(); }}>
            <Text style={[styles.badgeEtat, styles.badgeEtatCliquable, { color: COULEUR_ETAT[etat], borderColor: COULEUR_ETAT[etat] }]}>{libelleEtat}</Text>
          </Pressable>
        ) : (
          <Text style={[styles.badgeEtat, { color: COULEUR_ETAT[etat], borderColor: COULEUR_ETAT[etat] }]}>{libelleEtat}</Text>
        )}
        <View style={styles.actions}>
          <Pressable hitSlop={8} onPress={(e) => { e.stopPropagation(); onVoir(); }}><Text style={styles.action}>👁</Text></Pressable>
          {estSuperAdmin ? (
            <>
              <Pressable hitSlop={8} onPress={(e) => { e.stopPropagation(); onModifier(); }}><Text style={styles.action}>✏</Text></Pressable>
              <Pressable hitSlop={8} onPress={(e) => { e.stopPropagation(); onDupliquer(); }}><Text style={styles.action}>📄</Text></Pressable>
            </>
          ) : (
            <Pressable hitSlop={8} onPress={(e) => { e.stopPropagation(); onFavori(); }}>
              <Text style={styles.action}>{chant.favori ? "★" : "☆"}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  carte: {
    flexDirection: "row", backgroundColor: "#fff", borderRadius: 14, padding: 14, marginBottom: 10, gap: 10,
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  carteGrille: { flexDirection: "column" },
  icone: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#eef2f9", alignItems: "center", justifyContent: "center" },
  iconeTexte: { fontSize: 18 },
  contenu: { flex: 1, minWidth: 0 },
  ligneTitre: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  pillCategorie: {
    fontSize: 10, color: "#2563eb", backgroundColor: "#eef2f9", borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden",
  },
  titre: { fontSize: 15, fontWeight: "700", color: "#1e293b", flexShrink: 1 },
  reference: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  apercu: { fontSize: 13, color: "#64748b", marginTop: 6, lineHeight: 18 },
  ligneMeta: { marginTop: 6, gap: 2 },
  meta: { fontSize: 11, color: "#94a3b8" },
  metaFort: { color: "#475569", fontWeight: "600" },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 },
  tag: { fontSize: 10, color: "#475569", backgroundColor: "#f1f5f9", borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  tagPlus: { color: "#94a3b8" },
  aside: { alignItems: "flex-end", justifyContent: "space-between", gap: 8 },
  badgeEtat: { fontSize: 10, fontWeight: "700", borderWidth: 1, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  badgeEtatCliquable: { textDecorationLine: "underline" },
  actions: { flexDirection: "row", gap: 10 },
  action: { fontSize: 16 },
});
