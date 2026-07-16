// Service worker de DepliantApp : permet l'installation comme appli mobile
// (icône sur l'écran d'accueil, lancement en plein écran sans barre
// d'adresse) via manifest.json. Ne met en cache QUE la coquille statique de
// l'appli (HTML/CSS/JS/icônes) — jamais les réponses d'API (chants,
// feuillets, messages…), qui changent en permanence : servir une réponse
// API en cache risquerait d'afficher des données périmées sans que
// l'utilisateur s'en rende compte. Le cache ne sert que de secours si le
// réseau est indisponible, jamais de source principale.
const CACHE_NAME = "depliantapp-shell-v8";
const FICHIERS_COQUILLE = [
  "/", "/index.html", "/login.html", "/style.css?v=8", "/app.js?v=8",
  "/manifest.json", "/favicon.svg", "/icon-192.png", "/icon-512.png",
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
  const urlObj = new URL(url);
  const pathWithSearch = urlObj.pathname + urlObj.search;
  return FICHIERS_COQUILLE.includes(pathWithSearch) || FICHIERS_COQUILLE.includes(urlObj.pathname);
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = event.request.url;
  if (estFichierCoquille(url)) {
    // Stratégie Stale-While-Revalidate pour la coquille de l'application
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse.ok) {
              const copie = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copie));
            }
            return networkResponse;
          })
          .catch(() => {
            // Ignorer l'échec réseau silencieusement en arrière-plan
          });
        return cachedResponse || fetchPromise;
      })
    );
  } else {
    // Réseau d'abord pour les requêtes dynamiques / API
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
  }
});
