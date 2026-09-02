import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useIdentite } from "../context/IdentiteContext";

interface Props {
  navigation: any;
}

interface Entree { cle: string; titre: string; icone: string; superAdminUniquement?: boolean }

// Icônes reprises du tiroir "Extras" du web mobile (index.html ::
// #bottom-sheet-extras) -- même mapping icône/écran que la version web.
const ENTREES: Entree[] = [
  { cle: "Profil", titre: "Mon profil", icone: "👤" },
  { cle: "Reglages", titre: "Réglages", icone: "⚙️" },
  { cle: "Editeur", titre: "Éditeur de chants", icone: "🎵" },
  { cle: "Import", titre: "Importer un carnet", icone: "📥" },
  { cle: "Statistiques", titre: "Statistiques", icone: "📊", superAdminUniquement: true },
  { cle: "Administration", titre: "Administration", icone: "🔑", superAdminUniquement: true },
  { cle: "APropos", titre: "À propos", icone: "ℹ️" },
];

// Menu "Plus" : regroupe les écrans secondaires plutôt que de saturer la
// barre d'onglets (9 écrans au total dans l'inventaire web -- inutilisable
// en barre du bas). Administration/Statistiques masqués aux comptes
// chorale, comme le garde VUES_SUPERADMIN_UNIQUEMENT côté web.
export default function PlusMenuScreen({ navigation }: Props) {
  const { estSuperAdmin } = useIdentite();

  return (
    <ScrollView style={styles.fond} contentContainerStyle={styles.scroll}>
      {ENTREES.filter((e) => !e.superAdminUniquement || estSuperAdmin).map((e) => (
        <Pressable key={e.cle} style={styles.ligne} onPress={() => navigation.navigate(e.cle)}>
          <View style={styles.ligneGauche}>
            <Text style={styles.icone}>{e.icone}</Text>
            <Text style={styles.titre}>{e.titre}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fond: { backgroundColor: "#eef2f9" },
  scroll: { padding: 16 },
  ligne: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 10,
  },
  ligneGauche: { flexDirection: "row", alignItems: "center", gap: 12 },
  icone: { fontSize: 18 },
  titre: { fontSize: 15, color: "#1e293b", fontWeight: "600" },
  chevron: { fontSize: 18, color: "#94a3b8" },
});
