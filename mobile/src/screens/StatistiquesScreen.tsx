import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { getStatistiques, Statistiques } from "../api/statistiques";
import Bouton from "../components/Bouton";
import { categorieLabel } from "../utils/labels";

function formaterDateCourte(valeur: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valeur || "");
  if (!m) return valeur || "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export default function StatistiquesScreen() {
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
    // Contenu aligné sur exporterPVStatistiques (app.js) -- mêmes sections,
    // même formulation des recommandations -- juste un fichier texte brut
    // (pas de padStart/padEnd, superflu ici) au lieu d'un export navigateur.
    const lignes = [
      "PROCÈS-VERBAL TECHNIQUE - AUDIT ET STATISTIQUES DE LA PLATEFORME DEPLIANTAPP",
      `Généré le : ${timestamp}`,
      "",
      "1. RAPPORT SYNTHÉTIQUE DES MÉTRIQUES CLÉS",
      `- Nombre total de Chorales enregistrées : ${s.total_chorales}`,
      `- Nombre total de Chants en bibliothèque : ${s.total_chants}`,
      `- Nombre total de Dépliants (Feuillets) générés : ${s.total_feuillets}`,
      `- Demandes de suppression en attente de modération : ${s.demandes_en_attente}`,
      `- Ressources masquées actives (Accès privé) : ${s.masques_actifs}`,
      `- Historique des suppressions validées : ${s.demandes_validees}`,
      "",
      "2. ANALYSE ET ACTIVITÉ PAR CHORALE",
      ...stats.feuillets_par_chorale.map(
        (f) => `* ${f.chorale_nom} : ${f.nombre} dépliants (dernier en date : ${f.dernier ? f.dernier.slice(0, 10) : "aucun"})`,
      ),
      "",
      "3. STATISTIQUES D'ORGANISATION LITURGIQUE",
      ...stats.chants_par_categorie.map((c) => `* ${categorieLabel(c.categorie)} : ${c.nombre} chants`),
      "",
      "4. COMPILATION DE L'ACTIVITÉ RÉCENTE",
      "Derniers dépliants générés :",
      ...stats.feuillets_recents.map((f) => `* Le ${f.date ?? "—"} à ${f.lieu ?? "—"} par [${f.chorale_nom ?? "Inconnue"}]`),
      "",
      "Derniers chants ajoutés à la bibliothèque :",
      ...stats.chants_recents.map((c) => `* "${c.titre}" [Catégorie : ${categorieLabel(c.categorie)}]`),
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

  return (
    <ScrollView
      style={styles.conteneur}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={rafraichissement} onRefresh={onRafraichir} tintColor="#2563eb" />}
    >
      <Text style={styles.filDAriane}>Administration {">"} Statistiques</Text>
      <Text style={styles.titrePage}>Tableau de bord statistique</Text>
      <Text style={styles.sousTitrePage}>Analyse globale de l'utilisation de la plateforme et des ressources liturgiques.</Text>
      {/* Depuis le passage des comptes chorale en licence 100% hors-ligne,
          aucune chorale n'envoie plus jamais de chant/dépliant à ce serveur
          -- ces chiffres ne bougent donc plus qu'avec le contenu créé
          directement par l'administrateur (Éditeur), jamais avec l'activité
          réelle des chorales. Sans cet avertissement, un total figé pouvait
          être lu à tort comme le reflet de l'usage courant. */}
      <View style={styles.avertissementDonnees}>
        <Text style={styles.texteAvertissementDonnees}>
          ⚠️ Les comptes chorale fonctionnent désormais 100% hors-ligne (bibliothèque et dépliants restent sur leur appareil) -- ces chiffres ne
          reflètent plus leur activité réelle, seulement le contenu créé directement par l'administration et l'historique antérieur à ce passage
          hors-ligne.
        </Text>
      </View>
      <View style={{ marginBottom: 16 }}>
        <Bouton titre="📥 Exporter le procès-verbal" onPress={exporterProcesVerbal} />
      </View>

      <View style={styles.grille}>
        {[
          ["Chorales", stats.total_chorales], ["Chants", stats.total_chants], ["Feuillets", stats.total_feuillets],
          ["Demandes en attente", stats.demandes_en_attente], ["Ressources masquées", stats.masques_actifs], ["Demandes validées", stats.demandes_validees],
        ].map(([label, valeur]) => (
          <View key={label as string} style={styles.carteStat}>
            <Text style={styles.valeurStat}>{valeur}</Text>
            <Text style={styles.labelStat}>{label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.section}>Feuillets par chorale</Text>
      {stats.feuillets_par_chorale.map((f) => (
        <View key={f.chorale_nom} style={styles.ligneTableauChorale}>
          <Text style={styles.texteTableau} numberOfLines={1}>{f.chorale_nom}</Text>
          <Text style={styles.texteTableauNombre}>{f.nombre}</Text>
          <Text style={styles.texteTableauDate}>{f.dernier ? formaterDateCourte(f.dernier) : "—"}</Text>
        </View>
      ))}

      <Text style={styles.section}>Chants par catégorie</Text>
      {stats.chants_par_categorie.map((c) => (
        <View key={c.categorie} style={styles.ligneTableau}>
          <Text style={styles.texteTableau}>{categorieLabel(c.categorie)}</Text>
          <Text style={styles.texteTableauNombre}>{c.nombre}</Text>
        </View>
      ))}

      <Text style={styles.section}>Derniers dépliants</Text>
      {stats.feuillets_recents.map((f, i) => (
        <View key={i} style={styles.ligneTableau}>
          <Text style={styles.texteTableau}>{f.date} · {f.chorale_nom ?? "?"}</Text>
        </View>
      ))}

      <Text style={styles.section}>Chants récents</Text>
      {stats.chants_recents.map((c, i) => (
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
  avertissementDonnees: { backgroundColor: "#fef3c7", borderRadius: 10, padding: 10, marginBottom: 12 },
  texteAvertissementDonnees: { fontSize: 11, color: "#92400e", lineHeight: 16 },
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
});
