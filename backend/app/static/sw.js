// Service worker de DepliantApp : permet l'installation comme appli mobile
// (icône sur l'écran d'accueil, lancement en plein écran sans barre
// d'adresse) via manifest.json. Ne met en cache QUE la coquille statique de
// l'appli (HTML/CSS/JS/icônes) — jamais les réponses d'API (chants,
// feuillets, messages…), qui changent en permanence : servir une réponse
// API en cache risquerait d'afficher des données périmées sans que
// l'utilisateur s'en rende compte. Le cache ne sert que de secours si le
// réseau est indisponible, jamais de source principale.
const CACHE_NAME = "depliantapp-shell-v1";
const FICHIERS_COQUILLE = [
  "/", "/index.html", "/login.html", "/style.css", "/app.js",
  "/manifest.json", "/icon-192.png", "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FICHIERS_COQUILLE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((noms) =>
      Promise.all(noms.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

function estFichierCoquille(url) {
  const chemin = new URL(url).pathname;
  return FICHIERS_COQUILLE.includes(chemin);
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((reponse) => {
        if (reponse.ok && estFichierCoquille(event.request.url)) {
          const copie = reponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copie));
        }
        return reponse;
      })
      .catch(() => caches.match(event.request))
  );
});
