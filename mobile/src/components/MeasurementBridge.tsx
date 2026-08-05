import { forwardRef, useImperativeHandle, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { StyleParagraphe } from "../render/typography";

export interface MesureDemandee {
  html: string;
  /** Style déjà résolu par l'appelant (taille effective = base +/-
   * supplément ciblé par chant, voir genererPdfLocal.ts::testerTaille) --
   * ce composant ne connaît plus les "nomStyle", juste des styles concrets,
   * pour que deux unités du même rôle (ex: deux "couplet") puissent être
   * mesurées à des tailles différentes dans la même passe. */
  style: StyleParagraphe;
}

export interface MeasurementBridgeHandle {
  /** Mesure la hauteur réelle (mm) de chaque unité HTML, en une seule passe
   * DOM -- équivalent mobile de Paragraph.wrap() (ReportLab), voir
   * render/measure.py côté backend. */
  mesurer(unites: MesureDemandee[], largeurColonneMm: number): Promise<number[]>;
}

let compteurRequete = 0;

// Harnais HTML minimal : reçoit une demande de mesure via postMessage,
// construit chaque unité dans un <div> caché à la largeur de colonne exacte
// (mm) et à la police demandée (pt -- CSS convertit nativement pt<->mm, pas
// de calcul manuel nécessaire), lit getBoundingClientRect().height de
// chacune EN UNE SEULE PASSE, et renvoie tout d'un coup -- un seul aller-
// retour par taille candidate plutôt qu'un par unité.
const HTML_HARNAIS = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Times New Roman', Times, serif; }
  #racine { position: absolute; visibility: hidden; }
  #racine > div { box-sizing: border-box; }
  .auteur-compositeur { font-style: italic; }
</style>
</head><body>
<div id="racine"></div>
<script>
  function traiter(data) {
    try {
      const demande = JSON.parse(data);
      const racine = document.getElementById('racine');
      racine.innerHTML = '';
      racine.style.width = demande.largeurColonneMm + 'mm';
      const noeuds = demande.unites.map(function (u) {
        const style = u.style || {};
        const div = document.createElement('div');
        div.innerHTML = u.html;
        div.style.fontSize = (style.fontSize || 8) + 'pt';
        div.style.lineHeight = (style.lineHeight || 8) + 'pt';
        div.style.fontWeight = style.fontWeight || 'normal';
        div.style.marginTop = (style.marginTop || 0) + 'pt';
        div.style.marginBottom = (style.marginBottom || 0) + 'pt';
        racine.appendChild(div);
        // getBoundingClientRect() ne compte JAMAIS les marges (modele de
        // boite CSS) -- on les rajoute nous-memes, comme measure.py cote
        // backend (h + marges) : sinon chaque unite mesuree paraît plus
        // petite que ce qu'elle occupera reellement une fois assemblee dans
        // pdfAssembler.ts, et le moteur choisit systematiquement la plus
        // grande taille de police en pensant que tout rentre.
        return { noeud: div, margesPt: (style.marginTop || 0) + (style.marginBottom || 0) };
      });
      const pxParMm = 96 / 25.4;
      const ptParMm = 2.83465;
      const hauteurs = noeuds.map(function (n) {
        return n.noeud.getBoundingClientRect().height / pxParMm + n.margesPt / ptParMm;
      });
      window.ReactNativeWebView.postMessage(JSON.stringify({ id: demande.id, hauteurs: hauteurs }));
    } catch (err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ id: -1, erreur: String(err) }));
    }
  }
  document.addEventListener('message', function (e) { traiter(e.data); });
  window.addEventListener('message', function (e) { traiter(e.data); });
</script>
</body></html>`;

// Composant invisible : ne s'affiche jamais à l'écran (monté une seule fois
// par genererPdfLocal.ts, hors du flux visuel).
const MeasurementBridge = forwardRef<MeasurementBridgeHandle>((_props, ref) => {
  const webviewRef = useRef<WebView>(null);
  const pret = useRef<Promise<void> | null>(null);
  const debloquerPret = useRef<(() => void) | null>(null);
  const enAttente = useRef(new Map<number, { resolve: (h: number[]) => void; reject: (e: unknown) => void }>());

  if (!pret.current) {
    pret.current = new Promise((resolve) => { debloquerPret.current = resolve; });
  }

  useImperativeHandle(ref, () => ({
    async mesurer(unites, largeurColonneMm) {
      await pret.current;
      return new Promise((resolve, reject) => {
        const id = ++compteurRequete;
        enAttente.current.set(id, { resolve, reject });
        webviewRef.current?.postMessage(JSON.stringify({ id, unites, largeurColonneMm }));
      });
    },
  }));

  function onMessage(e: WebViewMessageEvent) {
    try {
      const { id, hauteurs, erreur } = JSON.parse(e.nativeEvent.data);
      const attente = enAttente.current.get(id);
      if (!attente) return;
      enAttente.current.delete(id);
      if (erreur) attente.reject(new Error(erreur));
      else attente.resolve(hauteurs);
    } catch {
      // Message non conforme -- ignoré, la requête en attente finira par
      // expirer côté appelant si elle ne reçoit jamais de réponse valide.
    }
  }

  return (
    <View style={styles.cache} pointerEvents="none">
      <WebView
        ref={webviewRef}
        source={{ html: HTML_HARNAIS }}
        onLoadEnd={() => debloquerPret.current?.()}
        onMessage={onMessage}
        style={styles.webview}
      />
    </View>
  );
});

export default MeasurementBridge;

const styles = StyleSheet.create({
  cache: { position: "absolute", width: 1, height: 1, opacity: 0, top: -10000, left: -10000 },
  webview: { width: 400, height: 400 },
});
