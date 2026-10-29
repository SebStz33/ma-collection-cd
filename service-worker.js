/* ==========================================================================
   Service worker : permet d'utiliser l'outil hors connexion (PWA).
   Le navigateur l'installe en arrière-plan et lui confie toutes les requêtes
   de la page. Actif seulement en https (site en ligne), pas en test local.
   ========================================================================== */

// Changer ce numéro force le navigateur à recharger les fichiers de la page.
const VERSION = "v2";
const RESERVE_PAGE = "page-" + VERSION;
const RESERVE_POCHETTES = "pochettes";

// Les fichiers de la page, mis en réserve dès l'installation.
const FICHIERS_PAGE = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "manifest.json",
  "icones/icone.svg",
  "icones/icone-180.png",
  "icones/icone-192.png",
];

self.addEventListener("install", (evenement) => {
  evenement.waitUntil(caches.open(RESERVE_PAGE).then((reserve) => reserve.addAll(FICHIERS_PAGE)));
  self.skipWaiting();
});

// À l'activation d'une nouvelle version, on supprime les anciennes réserves de la page.
self.addEventListener("activate", (evenement) => {
  evenement.waitUntil(
    caches.keys().then((noms) => Promise.all(
      noms.filter((nom) => nom.startsWith("page-") && nom !== RESERVE_PAGE).map((nom) => caches.delete(nom))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (evenement) => {
  const requete = evenement.request;
  if (requete.method !== "GET") return;
  const url = new URL(requete.url);

  // 1. La collection : on essaie d'abord le réseau (données à jour),
  //    et on retombe sur la copie en réserve hors connexion.
  if (url.pathname.endsWith("/data/collection.json")) {
    evenement.respondWith(
      fetch(requete)
        .then((reponse) => {
          const copie = reponse.clone();
          caches.open(RESERVE_PAGE).then((reserve) => reserve.put(requete, copie));
          return reponse;
        })
        .catch(() => caches.match(requete))
    );
    return;
  }

  // 2. Les pochettes (servies par Discogs) : on garde celles déjà vues.
  if (url.hostname.endsWith("discogs.com")) {
    evenement.respondWith(
      caches.open(RESERVE_POCHETTES).then((reserve) =>
        reserve.match(requete).then((enReserve) => enReserve || fetch(requete).then((reponse) => {
          reserve.put(requete, reponse.clone());
          return reponse;
        }))
      )
    );
    return;
  }

  // 3. Les fichiers de la page : la réserve d'abord, le réseau sinon.
  if (url.origin === self.location.origin) {
    evenement.respondWith(caches.match(requete).then((enReserve) => enReserve || fetch(requete)));
  }
});
