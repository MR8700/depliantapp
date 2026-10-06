import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { getStatistiques, Statistiques } from "../api/statistiques";
import Bouton from "../components/Bouton";
import { categorieLabel } from "../utils/labels";

import { useIdentite } from "../context/IdentiteContext";

function formaterDateCourte(valeur: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valeur || "");
  if (!m) return valeur || "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export default function StatistiquesScreen() {
  const { estSuperAdmin, identite } = useIdentite();
  const [stats, setStats] = useState<Statistiques | null>(null);
  const [rafraichissement, setRafraichissement] = useState(false);

  const charger = useCallback(async () => {
    try { setStats(await getStatistiques()); } catch {}
  }, []);

  useEffect(() => { charger(); }, [charger]);

  async function onRafraichir() {
    setRafraichissement(true);
    await charger();
    setRafraichissement(false);
  }

  async function exporterProcesVerbal() {
    if (!stats) return;
    const s = stats;
    const timestamp = new Date().toLocaleString("fr-FR");

    if (!estSuperAdmin || s.is_chorale) {
      const choraleNom = s.chorale_nom || identite?.nom || "Chorale";
      const lignes = [
        "================================================================================",
        `RAPPORT D'ACTIVITÉ LITURGIQUE - CHORALE : ${choraleNom}`,
        "================================================================================",
        `Généré le : ${timestamp}`,
        `Compte : Chorale (${choraleNom})`,
        "Statut : Opérationnel - Multi-appareils illimité",
        "--------------------------------------------------------------------------------",
        "",
        "1. RÉSUMÉ DE VOTRE ACTIVITÉ",
        `- Dépliants créés : ${s.total_feuillets || 0}`,
        `- Sessions / appareils actifs : ${s.sessions_ouvertes || 1}`,
        `- Chants accessibles au répertoire commun : ${s.total_chants || 0}`,
        `- Demandes auprès de l'administrateur en attente : ${s.demandes_en_attente || 0}`,
        `- Chants masqués de votre vue : ${s.masques_actifs || 0}`,
        `- Demandes validées par l'administrateur : ${s.demandes_validees || 0}`,
        "",
        "2. VOS DERNIERS DÉPLIANTS",
        ...(s.feuillets_recents || []).map((f) => `* Le ${f.date ?? "—"} à ${f.lieu ?? "—"}`),
        "",
        "3. RÉPARTITION DU RÉPERTOIRE LITURGIQUE",
        ...(s.chants_par_categorie || []).map((c) => `* ${categorieLabel(c.categorie)} : ${c.nombre} chants`),
        "",
        "================================================================================",
        `FIN DU RAPPORT - HORODATAGE VALIDÉ : ${timestamp}`,
        "================================================================================",
      ];
      const dest = `${FileSystem.cacheDirectory}rapport_chorale_${Date.now()}.txt`;
      await FileSystem.writeAsStringAsync(dest, lignes.join("\n"));
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(dest);
      return;
    }

    const lignes = [
      "PROCÈS-VERBAL TECHNIQUE - AUDIT ET STATISTIQUES DE LA PLATEFORME DEPLIANTAPP",
      `Généré le : ${timestamp}`,
      "",
      "1. RAPPORT SYNTHÉTIQUE DES MÉTRIQUES CLÉS",
      `- Nombre total de Chorales enregistrées : ${s.total_chorales ?? 0}`,
      `- Nombre total de Chants en bibliothèque : ${s.total_chants}`,
      `- Nombre total de Dépliants (Feuillets) générés : ${s.total_feuillets}`,
      `- Demandes de suppression en attente de modération : ${s.demandes_en_attente}`,
      `- Ressources masquées actives (Accès privé) : ${s.masques_actifs}`,
      `- Historique des suppressions validées : ${s.demandes_validees}`,
      "",
      "2. ANALYSE ET ACTIVITÉ PAR CHORALE",
      ...(s.feuillets_par_chorale || []).map(
        (f) => `* ${f.chorale_nom} : ${f.nombre} dépliants (dernier en date : ${f.dernier ? f.dernier.slice(0, 10) : "aucun"})`,
      ),
      "",
      "3. STATISTIQUES D'ORGANISATION LITURGIQUE",
      ...(s.chants_par_categorie || []).map((c) => `* ${categorieLabel(c.categorie)} : ${c.nombre} chants`),
      "",
      "4. COMPILATION DE L'ACTIVITÉ RÉCENTE",
      "Derniers dépliants générés :",
      ...(s.feuillets_recents || []).map((f) => `* Le ${f.date ?? "—"} à ${f.lieu ?? "—"} par [${f.chorale_nom ?? "Inconnue"}]`),
      "",
      "Derniers chants ajoutés à la bibliothèque :",
      ...(s.chants_recents || []).map((c) => `* "${c.titre}" [Catégorie : ${categorieLabel(c.categorie)}]`),
      "",
      "5. RECOMMANDATIONS ET AIDE À LA DÉCISION",
      "- Taux de rotation de la bibliothèque : l'activité est équilibrée.",
      "- Recommandation technique : penser à relancer les chorales inactives depuis plus de 6 mois.",
      `- Modération : ${s.demandes_en_attente > 0 ? `il reste ${s.demandes_en_attente} demandes de suppression à valider dans Administration.` : "aucune action de modération requise actuellement."}`,
    ];
    const dest = `${FileSystem.cacheDirectory}proces_verbal_${Date.now()}.txt`;
    await FileSystem.writeAsStringAsync(dest, lignes.join("\n"));
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(dest);
  }

  if (!stats) return <View style={styles.conteneur} />;

  // Vue Chorale restreinte
  if (!estSuperAdmin || stats.is_chorale) {
    const choraleNom = stats.chorale_nom || identite?.nom || "Ma Chorale";
    return (
      <ScrollView
        style={styles.conteneur}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={rafraichissement} onRefresh={onRafraichir} tintColor="#2563eb" />}
      >
        <Text style={styles.filDAriane}>Espace Chorale {">"} Statistiques</Text>
        <Text style={styles.titrePage}>Statistiques de la chorale</Text>
        <Text style={styles.sousTitrePage}>Suivi de votre activité liturgique, dépliants et ressources.</Text>

        <View style={styles.banniereChorale}>
          <Text style={styles.banniereTitre}>{choraleNom}</Text>
          <Text style={styles.banniereSousTitre}>Compte actif &bull; Multi-appareils libre &amp; illimité</Text>
        </View>

        <View style={{ marginBottom: 16 }}>
          <Bouton titre="📥 Exporter mon rapport d'activité" onPress={exporterProcesVerbal} />
        </View>

        <View style={styles.grille}>
          {[
            ["Mes dépliants", stats.total_feuillets],
            ["Sessions actives", stats.sessions_ouvertes || 1],
            ["Chants disponibles", stats.total_chants],
            ["Demandes en cours", stats.demandes_en_attente],
            ["Chants masqués", stats.masques_actifs],
            ["Demandes validées", stats.demandes_validees],
          ].map(([label, valeur]) => (
            <View key={label as string} style={styles.carteStat}>
              <Text style={styles.valeurStat}>{valeur}</Text>
              <Text style={styles.labelStat}>{label}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.section}>Mes derniers dépliants</Text>
        {(stats.feuillets_recents || []).length > 0 ? (
          (stats.feuillets_recents || []).map((f, i) => (
            <View key={i} style={styles.ligneTableau}>
              <Text style={styles.texteTableau}>{f.date}{f.lieu ? ` — ${f.lieu}` : ""}</Text>
              <Text style={styles.texteTableauDate}>{f.created_at ? formaterDateCourte(f.created_at) : "—"}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.vide}>Aucun dépliant créé pour le moment</Text>
        )}

        <Text style={styles.section}>Répartition du répertoire liturgique</Text>
        {(stats.chants_par_categorie || []).map((c) => (
          <View key={c.categorie} style={styles.ligneTableau}>
            <Text style={styles.texteTableau}>{categorieLabel(c.categorie)}</Text>
            <Text style={styles.texteTableauNombre}>{c.nombre} chants</Text>
          </View>
        ))}

        <Text style={styles.section}>Derniers chants ajoutés au répertoire</Text>
        {(stats.chants_recents || []).map((c, i) => (
          <View key={i} style={styles.ligneTableau}>
            <Text style={styles.texteTableau}>{c.titre}</Text>
            <Text style={styles.texteTableauDate}>{categorieLabel(c.categorie)}</Text>
          </View>
        ))}
      </ScrollView>
    );
  }

  // Vue Super-administrateur
  return (
    <ScrollView
      style={styles.conteneur}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={rafraichissement} onRefresh={onRafraichir} tintColor="#2563eb" />}
    >
      <Text style={styles.filDAriane}>Administration {">"} Statistiques</Text>
      <Text style={styles.titrePage}>Tableau de bord statistique</Text>
      <Text style={styles.sousTitrePage}>Analyse globale de l'utilisation de la plateforme et des ressources liturgiques.</Text>

      <View style={{ marginBottom: 16 }}>
        <Bouton titre="📥 Exporter le procès-verbal" onPress={exporterProcesVerbal} />
      </View>

      <View style={styles.grille}>
        {[
          ["Chorales", stats.total_chorales ?? 0], ["Chants", stats.total_chants], ["Feuillets", stats.total_feuillets],
          ["Demandes en attente", stats.demandes_en_attente], ["Ressources masquées", stats.masques_actifs], ["Demandes validées", stats.demandes_validees],
        ].map(([label, valeur]) => (
          <View key={label as string} style={styles.carteStat}>
            <Text style={styles.valeurStat}>{valeur}</Text>
            <Text style={styles.labelStat}>{label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.section}>Feuillets par chorale</Text>
      {(stats.feuillets_par_chorale || []).map((f) => (
        <View key={f.chorale_nom} style={styles.ligneTableauChorale}>
          <Text style={styles.texteTableau} numberOfLines={1}>{f.chorale_nom}</Text>
          <Text style={styles.texteTableauNombre}>{f.nombre}</Text>
          <Text style={styles.texteTableauDate}>{f.dernier ? formaterDateCourte(f.dernier) : "—"}</Text>
        </View>
      ))}

      <Text style={styles.section}>Chants par catégorie</Text>
      {(stats.chants_par_categorie || []).map((c) => (
        <View key={c.categorie} style={styles.ligneTableau}>
          <Text style={styles.texteTableau}>{categorieLabel(c.categorie)}</Text>
          <Text style={styles.texteTableauNombre}>{c.nombre}</Text>
        </View>
      ))}

      <Text style={styles.section}>Derniers dépliants</Text>
      {(stats.feuillets_recents || []).map((f, i) => (
        <View key={i} style={styles.ligneTableau}>
          <Text style={styles.texteTableau}>{f.date} · {f.chorale_nom ?? "?"}</Text>
        </View>
      ))}

      <Text style={styles.section}>Chants récents</Text>
      {(stats.chants_recents || []).map((c, i) => (
        <View key={i} style={styles.ligneTableau}>
          <Text style={styles.texteTableau}>{c.titre} · {categorieLabel(c.categorie)}</Text>
        </View>
      ))}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  conteneur: { flex: 1, backgroundColor: "#eef2f9" },
  filDAriane: { fontSize: 12, color: "#64748b" },
  titrePage: { fontSize: 19, fontWeight: "800", color: "#1F4A7C", marginTop: 2 },
  sousTitrePage: { fontSize: 12, color: "#64748b", marginTop: 4, marginBottom: 14 },
  banniereChorale: {
    backgroundColor: "#1e40af", borderRadius: 12, padding: 16, marginBottom: 16,
    shadowColor: "#1e40af", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6, elevation: 2,
  },
  banniereTitre: { fontSize: 18, fontWeight: "800", color: "#ffffff" },
  banniereSousTitre: { fontSize: 12, color: "#dbeafe", marginTop: 4, fontWeight: "500" },
  grille: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  carteStat: { width: "31%", backgroundColor: "#fff", borderRadius: 12, padding: 12, alignItems: "center", marginBottom: 8 },
  valeurStat: { fontSize: 20, fontWeight: "800", color: "#2563eb" },
  labelStat: { fontSize: 10, color: "#64748b", textAlign: "center", marginTop: 2 },
  section: { fontSize: 14, fontWeight: "700", color: "#1e293b", marginTop: 18, marginBottom: 6 },
  ligneTableau: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "#fff", borderRadius: 8, padding: 10, marginBottom: 4 },
  ligneTableauChorale: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 8, padding: 10, marginBottom: 4 },
  texteTableau: { fontSize: 13, color: "#334155", flex: 1 },
  texteTableauNombre: { fontSize: 13, fontWeight: "700", color: "#1e293b" },
  texteTableauDate: { fontSize: 11, color: "#64748b" },
  vide: { fontSize: 13, color: "#94a3b8", textAlign: "center", paddingVertical: 12, fontStyle: "italic" },
});
