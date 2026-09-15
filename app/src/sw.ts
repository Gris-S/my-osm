/// <reference lib="webworker" />
// ---------------------------------------------------------------------------
// Service Worker de l'application.
//
// Il est **écrit à la main** (`injectManifest`) et non plus généré, et c'est le
// téléchargement de cartes qui l'exige : une zone téléchargée ne peut pas
// vivre dans les caches d'exécution de Workbox, dont le plafond d'entrées et
// l'expiration l'effaceraient sans un mot au bout de quelques semaines de
// navigation. Il faut un cache à part, consulté avant tout le reste — une
// règle qui ne s'exprime pas dans la configuration déclarative.
//
// **Ne pas ajouter d'écouteur `fetch` à côté du routeur de Workbox.** Les deux
// appelleraient `respondWith` sur les mêmes URLs, et le second lèverait un
// `InvalidStateError` : la tuile ne serait alors servie ni par l'un ni par
// l'autre. Les deux logiques sont donc **composées** — la route ci-dessous
// regarde d'abord la zone téléchargée, puis délègue à la stratégie de cache
// d'exécution, qui garde son expiration et son plafond.
// ---------------------------------------------------------------------------

import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { cacheKeyFor, isStyleAssetUrl, tileRefFromUrl } from "./services/offline/keys";
import { assetPath, pathOf, readAnywhere } from "./services/offline/blobStore";

declare const self: ServiceWorkerGlobalScope;

const WEEK = 60 * 60 * 24 * 7;
const MONTH = 60 * 60 * 24 * 30;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// La nouvelle version prend la main au chargement suivant, comme avant :
// l'application n'a pas d'état à préserver en cours de route.
self.skipWaiting();
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/**
 * Ce qu'une zone téléchargée contient pour cette URL, s'il y a quelque chose.
 *
 * Les tuiles sont rangées dans **OPFS** — un système de fichiers, pas un cache
 * — sous un chemin normalisé, débarrassé du numéro de version daté que porte
 * l'URL d'OpenFreeMap (voir `services/offline/keys.ts`). Sans cette
 * normalisation, une republication amont rendrait d'un coup toutes les zones
 * invisibles. `readAnywhere` consulte aussi l'ancien Cache Storage, pour que
 * les zones prises avant la bascule restent lisibles.
 */
async function fromOfflineZone(url: string): Promise<Response | undefined> {
  try {
    const ref = tileRefFromUrl(url);
    const path = ref ? pathOf(cacheKeyFor(ref)) : isStyleAssetUrl(url) ? assetPath(url) : null;
    if (!path) return undefined;
    const blob = await readAnywhere(path);
    return blob ? new Response(blob) : undefined;
  } catch {
    // Magasin indisponible : on laisse le réseau faire, plutôt que de rendre
    // la carte muette.
    return undefined;
  }
}

/**
 * Une route qui regarde la zone téléchargée, puis se rabat sur la stratégie
 * d'exécution. Hors ligne et hors zone, elle rend un 504 franc plutôt qu'une
 * exception : MapLibre laisse alors la tuile vide au lieu de s'interrompre.
 */
function offlineFirst(strategy: CacheFirst) {
  return async ({ event, request }: { event: ExtendableEvent; request: Request }) => {
    const stored = await fromOfflineZone(request.url);
    if (stored) return stored;
    try {
      return await strategy.handle({ event, request });
    } catch {
      return new Response("", { status: 504, statusText: "Hors ligne" });
    }
  };
}

const cacheFirst = (cacheName: string, maxEntries: number, maxAgeSeconds: number) =>
  new CacheFirst({
    cacheName,
    plugins: [
      new ExpirationPlugin({ maxEntries, maxAgeSeconds }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  });

// Fond de carte vectoriel, polices et pictogrammes du style : ce sont les
// mêmes fichiers d'une visite à l'autre, et c'est le plus gros du trafic.
registerRoute(
  ({ url }) =>
    url.origin === "https://tiles.openfreemap.org" || url.origin === "https://assets.openfreemap.org",
  offlineFirst(cacheFirst("fond-de-carte", 900, WEEK)),
);

// Imagerie satellite : le fond mondial d'Esri **et** l'orthophotographie de
// l'IGN qui se pose dessus en France. Les deux doivent être ici, sinon la
// moitié de la vue satellite repart sur le réseau à chaque visite.
registerRoute(
  ({ url }) =>
    url.origin === "https://server.arcgisonline.com" || url.origin === "https://data.geopf.fr",
  offlineFirst(cacheFirst("imagerie-satellite", 800, MONTH)),
);

// Tuiles d'altitude (relief) : mêmes règles que l'imagerie — elles ne changent
// pas d'un mois à l'autre, et une zone téléchargée les porte.
registerRoute(
  ({ url }) => url.origin === "https://s3.amazonaws.com" && url.pathname.startsWith("/elevation-tiles-prod/"),
  offlineFirst(cacheFirst("relief", 600, MONTH)),
);

// Couverture Mapillary et fragment du visualiseur : gardés une fois vus,
// jamais préchargés. Aucune zone hors ligne ne les porte — les photos de rue
// sont demandées à l'API au clic, il n'y a rien à télécharger d'avance.
registerRoute(
  ({ url }) => url.origin === "https://tiles.mapillary.com",
  cacheFirst("couverture-mapillary", 120, WEEK),
);

// Ce qui n'est **pas** mis en cache mérite d'être dit : les horaires de
// transport, la météo, la qualité de l'air, les vigilances, les itinéraires et
// les résultats de recherche passent tous par le réseau à chaque fois. Leurs
// durées de validité leur sont propres et sont déjà tenues service par service
// dans `src/services` ; un cache d'infrastructure par-dessus servirait un
// horaire périmé sans que rien ne le signale. Les zones téléchargées font
// exception, et c'est le propre du hors ligne : ce sont des données que
// l'utilisateur a demandé à garder, et il sait quand il les a prises.
