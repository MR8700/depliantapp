import { useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { getParametresGlobaux } from "../api/parametres";
import Bouton from "../components/Bouton";

interface CarteIcone { icon?: string; title?: string; desc?: string }

function parseJsonArray<T>(valeur: any): T[] {
  if (!valeur) return [];
  try { const parse = JSON.parse(valeur); return Array.isArray(parse) ? parse : []; } catch { return []; }
}

function Paragraphes({ texte, style }: { texte: string; style?: any }) {
  return (
    <>
      {texte.split("\n\n").filter(Boolean).map((p, i) => (
        <Text key={i} style={[styles.paragraphe, style]}>{p}</Text>
      ))}
    </>
  );
}

function CarteGrille({ item, accentColor }: { item: CarteIcone; accentColor?: string }) {
  return (
    <View style={[styles.carteGrille, accentColor ? { borderLeftWidth: 4, borderLeftColor: accentColor } : null]}>
      <Text style={styles.carteIcone}>{item.icon || "□"}</Text>
      <Text style={styles.carteTitre}>{item.title || ""}</Text>
      <Text style={styles.carteDesc}>{item.desc || ""}</Text>
    </View>
  );
}

export default function AProposScreen() {
  const navigation = useNavigation<any>();
  const [s, setS] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    getParametresGlobaux().then(setS).catch(() => {});
  }, []);

  if (!s) return <View style={styles.conteneur} />;

  const valeurs = parseJsonArray<CarteIcone>(s.got_valeurs);
  const features = parseJsonArray<CarteIcone>(s.got_app_features);
  const timeline = parseJsonArray<CarteIcone>(s.got_why_timeline);
  const engagements = parseJsonArray<CarteIcone>(s.got_engagements);
  const securite = parseJsonArray<CarteIcone>(s.got_securite);
  const utilisation = parseJsonArray<string>(s.got_utilisation_donnees);
  const droits = parseJsonArray<CarteIcone>(s.got_droits_utilisateurs);

  const liensSociaux = [
    { label: "🌐 Site web", val: s.got_contact_siteweb },
    { label: "📘 Facebook", val: s.got_contact_facebook },
    { label: "💼 LinkedIn", val: s.got_contact_linkedin },
    { label: "🐙 GitHub", val: s.got_contact_github },
    { label: "💬 WhatsApp", val: s.got_contact_whatsapp },
  ].filter((l) => l.val);

  return (
    <ScrollView style={styles.conteneur} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      {/* Hero */}
      <View style={styles.hero}>
        <Text style={styles.heroTitre}>À propos</Text>
        {!!s.got_slogan && <Text style={styles.heroSlogan}>{s.got_slogan}</Text>}
        <View style={styles.heroActions}>
          <View style={{ flex: 1 }}>
            <Bouton titre="Nous contacter" onPress={() => navigation.navigate("Messages")} />
          </View>
        </View>
      </View>

      {/* Entreprise */}
      <View style={styles.section}>
        <Text style={styles.tag}>Qui sommes-nous ?</Text>
        <Text style={styles.titreSection}>{s.got_nom_entreprise || "GO Technologie (GOT)"}</Text>
        {!!s.got_presentation && <Paragraphes texte={s.got_presentation} />}
      </View>

      {/* Mission / Vision */}
      <View style={styles.carteGrille}>
        <Text style={styles.carteIcone}>🎯</Text>
        <Text style={styles.carteTitre}>Notre mission</Text>
        <Text style={styles.carteDesc}>{s.got_mission || ""}</Text>
      </View>
      <View style={styles.carteGrille}>
        <Text style={styles.carteIcone}>🚀</Text>
        <Text style={styles.carteTitre}>Notre vision</Text>
        <Text style={styles.carteDesc}>{s.got_vision || ""}</Text>
      </View>

      {/* Valeurs */}
      <View style={styles.entete}>
        <Text style={styles.titreSection}>Nos valeurs</Text>
        <Text style={styles.sousTitre}>Les principes cardinaux qui animent chacun de nos projets au quotidien.</Text>
      </View>
      {valeurs.map((v, i) => <CarteGrille key={i} item={v} />)}

      {/* Application */}
      <View style={styles.section}>
        <Text style={styles.tag}>L'application</Text>
        <Text style={styles.titreSection}>À propos de l'application</Text>
        {!!s.got_app_description && <Text style={styles.paragrapheLead}>{s.got_app_description}</Text>}
      </View>
      {features.map((f, i) => <CarteGrille key={i} item={f} />)}
      <Text style={styles.piedApp}>
        Notre objectif est de réduire le temps consacré à la mise en page afin que les équipes puissent se concentrer sur l'essentiel : la préparation de la célébration.
      </Text>

      {/* Pourquoi */}
      <View style={styles.entete}>
        <Text style={styles.titreSection}>Pourquoi cette application ?</Text>
        <Text style={styles.sousTitre}>Le parcours menant de l'identification des frictions à l'aboutissement de notre solution automatique.</Text>
      </View>
      {timeline.map((item, i) => (
        <View key={i} style={styles.timelineItem}>
          <View style={styles.timelineMarker} />
          <View style={styles.timelineCarte}>
            <Text style={styles.carteTitre}>{item.title || ""}</Text>
            <Text style={styles.carteDesc}>{item.desc || ""}</Text>
          </View>
        </View>
      ))}

      {/* Engagements */}
      <View style={styles.entete}>
        <Text style={styles.titreSection}>Nos engagements</Text>
        <Text style={styles.sousTitre}>Notre pacte de confiance et de rigueur technique envers notre communauté.</Text>
      </View>
      {engagements.map((e, i) => <CarteGrille key={i} item={e} />)}

      {/* Confidentialité */}
      <View style={styles.section}>
        <Text style={styles.carteIcone}>🛡️</Text>
        <Text style={styles.titreSection}>Politique de confidentialité</Text>
        {!!s.got_politique_confidentialite && <Text style={styles.paragraphe}>{s.got_politique_confidentialite}</Text>}
      </View>

      {/* Sécurité */}
      <View style={styles.entete}>
        <Text style={styles.titreSection}>Sécurité des données</Text>
        <Text style={styles.sousTitre}>Des infrastructures et protocoles robustes garantissant la protection intégrale de vos informations.</Text>
      </View>
      {securite.map((sec, i) => <CarteGrille key={i} item={sec} />)}

      {/* Utilisation des données */}
      <View style={styles.section}>
        <Text style={styles.titreSous}>Comment nous utilisons vos données</Text>
        <Text style={styles.sousTitre}>La transparence est au cœur de notre éthique. Vos données servent uniquement à assurer le bon fonctionnement de vos services :</Text>
        {utilisation.map((item, i) => (
          <Text key={i} style={styles.puce}>• {item}</Text>
        ))}
        <View style={styles.avertissement}>
          <Text>⚠️ </Text>
          <Text style={styles.texteAvertissement}>Nous ne collectons aucune donnée sans objectif légitime.</Text>
        </View>
      </View>

      {/* Droits */}
      <View style={styles.entete}>
        <Text style={styles.titreSection}>Vos droits concernant vos données</Text>
        <Text style={styles.sousTitre}>Vous conservez la maîtrise et la propriété pleine et entière de toutes vos informations.</Text>
      </View>
      {droits.map((d, i) => <CarteGrille key={i} item={d} accentColor="#10b981" />)}

      {/* Contact */}
      <View style={styles.section}>
        <Text style={styles.tag}>Contact</Text>
        <Text style={styles.titreSection}>Nous contacter</Text>
        <Text style={styles.sousTitre}>Une question, un besoin d'assistance ou une proposition de projet ? Écrivez-nous ou retrouvez nos coordonnées officielles ci-dessous.</Text>
        <View style={styles.ligneContact}><Text style={styles.libelleContact}>🏢 Entreprise</Text><Text style={styles.valeurContact}>{s.got_nom_entreprise || "GO Technologie (GOT)"}</Text></View>
        <View style={styles.ligneContact}><Text style={styles.libelleContact}>📧 Email</Text><Text style={styles.valeurContact}>{s.got_contact_email || "marerichard10@gmail.com"}</Text></View>
        <View style={styles.ligneContact}>
          <Text style={styles.libelleContact}>✉️ Messagerie interne</Text>
          <Text style={styles.lienContact} onPress={() => navigation.navigate("Messages")}>Nous écrire directement</Text>
        </View>
        {!!s.got_contact_telephone && (
          <View style={styles.ligneContact}><Text style={styles.libelleContact}>📞 Téléphone</Text><Text style={styles.valeurContact}>{s.got_contact_telephone}</Text></View>
        )}
        <View style={styles.ligneContact}><Text style={styles.libelleContact}>🌍 Localisation</Text><Text style={styles.valeurContact}>{s.got_contact_adresse || "Burkina Faso"}</Text></View>
        {liensSociaux.length > 0 && (
          <View style={styles.blocSocial}>
            <Text style={styles.titreSocial}>Retrouvez-nous en ligne :</Text>
            <View style={styles.grilleSociale}>
              {liensSociaux.map((l) => (
                <Text key={l.label} style={styles.lienSocial} onPress={() => Linking.openURL(l.val)}>{l.label}</Text>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* Signature */}
      {!!s.got_signature && (
        <View style={styles.signature}>
          <Text style={styles.guillemet}>“</Text>
          <Paragraphes texte={s.got_signature} style={styles.texteSignature} />
          <Text style={styles.auteurSignature}>L'équipe de GO Technologie</Text>
        </View>
      )}

      {/* Footer */}
      <View style={styles.pied}>
        <Text style={styles.textePied}>© {new Date().getFullYear()} GO Technologie (GOT). Tous droits réservés.</Text>
        <Text style={styles.textePiedVersion}>DepliantApp • Conçu avec rigueur et passion.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  conteneur: { flex: 1, backgroundColor: "#eef2f9" },
  hero: { backgroundColor: "#1F4A7C", borderRadius: 16, padding: 20, marginBottom: 14 },
  heroTitre: { fontSize: 24, fontWeight: "800", color: "#fff" },
  heroSlogan: { fontSize: 13, color: "#dbeafe", marginTop: 6, lineHeight: 19 },
  heroActions: { flexDirection: "row", marginTop: 14 },
  section: { backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 10 },
  entete: { marginBottom: 8, marginTop: 4 },
  tag: { fontSize: 11, fontWeight: "700", color: "#2563eb", textTransform: "uppercase", marginBottom: 4 },
  titreSection: { fontSize: 17, fontWeight: "800", color: "#1e293b", marginBottom: 6 },
  titreSous: { fontSize: 15, fontWeight: "700", color: "#1e293b", marginBottom: 4 },
  sousTitre: { fontSize: 12, color: "#64748b", marginBottom: 10, lineHeight: 18 },
  paragraphe: { fontSize: 13, color: "#334155", lineHeight: 20, marginBottom: 8 },
  paragrapheLead: { fontSize: 13, color: "#334155", lineHeight: 20, fontWeight: "600" },
  puce: { fontSize: 13, color: "#334155", lineHeight: 20 },
  carteGrille: { backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 10 },
  carteIcone: { fontSize: 22, marginBottom: 6 },
  carteTitre: { fontSize: 14, fontWeight: "700", color: "#1e293b", marginBottom: 4 },
  carteDesc: { fontSize: 12, color: "#64748b", lineHeight: 18 },
  piedApp: { fontSize: 12, color: "#64748b", fontStyle: "italic", marginBottom: 10, paddingHorizontal: 4 },
  timelineItem: { flexDirection: "row", gap: 10, marginBottom: 10 },
  timelineMarker: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#2563eb", marginTop: 6 },
  timelineCarte: { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 14 },
  avertissement: { flexDirection: "row", backgroundColor: "#fef9c3", borderRadius: 10, padding: 10, marginTop: 8 },
  texteAvertissement: { flex: 1, fontSize: 12, color: "#713f12" },
  ligneContact: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  libelleContact: { fontSize: 12, color: "#64748b" },
  valeurContact: { fontSize: 12, color: "#0f172a", fontWeight: "600" },
  lienContact: { fontSize: 12, color: "#2563eb", fontWeight: "700", textDecorationLine: "underline" },
  blocSocial: { marginTop: 12 },
  titreSocial: { fontSize: 12, fontWeight: "700", color: "#1e293b", marginBottom: 8 },
  grilleSociale: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  lienSocial: { fontSize: 12, fontWeight: "600", color: "#1F4A7C", backgroundColor: "#eaf0fa", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  signature: { backgroundColor: "#1e293b", borderRadius: 16, padding: 20, marginTop: 6, marginBottom: 14, alignItems: "center" },
  guillemet: { fontSize: 32, color: "#3b82f6", fontWeight: "800" },
  texteSignature: { color: "#e2e8f0", textAlign: "center" },
  auteurSignature: { color: "#94a3b8", fontSize: 12, marginTop: 8, fontStyle: "italic" },
  pied: { alignItems: "center", paddingVertical: 12 },
  textePied: { fontSize: 11, color: "#94a3b8" },
  textePiedVersion: { fontSize: 11, color: "#cbd5e1", marginTop: 2 },
});
