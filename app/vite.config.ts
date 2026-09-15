import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Relais vers le point d'authentification de Météo-France.
//
// Il ne peut pas être appelé directement depuis le navigateur : sa réponse au
// préflight (OPTIONS, déclenché par l'en-tête `Authorization`) ne porte aucun
// en-tête d'origine croisée — mesuré — et le navigateur abandonne donc avant
// même d'envoyer la requête. Passer les identifiants dans le corps plutôt que
// dans l'en-tête ne sauve rien : l'API répond « Unsupported Client
// Authentication Method ».
//
// Le serveur de développement fait donc l'intermédiaire, et l'application
// s'adresse à sa propre origine. Les autres services (vigilance comprise)
// autorisent l'origine croisée et sont appelés directement.
const METEOFRANCE_TOKEN_PROXY = {
  '/api/meteofrance/token': {
    target: 'https://portail-api.meteofrance.fr',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/meteofrance\/token/, '/token'),
  },
}

// Relais vers Bison Futé (Point d'Accès National), pour le calque « Trafic ».
//
// Même raison que ci-dessus, et même mesure : le flux d'événements routiers du
// réseau national n'envoie **aucun en-tête d'origine croisée**. Il est pourtant
// servi en HTTPS, gratuit, sans clé et en direct — c'est la seule source de
// trafic routier français qui coche toutes ces cases. Le serveur de
// développement fait donc l'intermédiaire.
//
// En production web, il faudrait un relais équivalent : une règle de reverse
// proxy d'une ligne devant l'application. Voir `CONFIG.TRAFFIC_EVENTS_URL`, qui
// est **relatif** pour cette raison. **L'APK, lui, n'a pas besoin de relais** :
// `services/native.ts` appelle l'adresse réelle par le natif (`CapacitorHttp`),
// d'après `CONFIG.RELAY_TARGETS` — à tenir d'accord avec ce fichier.
const TRAFFIC_PROXY = {
  '/api/traffic/events': {
    target: 'https://tipi.bison-fute.gouv.fr',
    changeOrigin: true,
    rewrite: (path: string) =>
      path.replace(
        /^\/api\/traffic\/events/,
        '/bison-fute-ouvert/publicationsDIR/Evenementiel-DIR/grt/RRN/content.xml'
      ),
  },
}

const PROXY = { ...METEOFRANCE_TOKEN_PROXY, ...TRAFFIC_PROXY }

/**
 * Vrai quand on compile pour l'empaquetage Android (`../apk`).
 *
 * Une seule chose en dépend, et elle est importante : le **Service Worker est
 * retiré**. Dans une WebView Android il n'intercepte pas les requêtes comme
 * dans un navigateur — il ne servirait donc pas les cartes hors ligne, ce pour
 * quoi il existe — et il est connu pour empêcher l'injection du pont natif de
 * Capacitor, ce qui coûterait la géolocalisation. Un composant qui n'apporte
 * rien et peut casser le reste n'a pas sa place dans l'APK.
 *
 * Le hors-ligne de l'APK passe donc par la carte elle-même :
 * `services/offline/nativeTiles.ts` réécrit les adresses de tuiles en `zone://`
 * (`transformRequest`) et les sert depuis le même OPFS, zone d'abord.
 */
const FOR_APK = process.env.OSM_TARGET === 'apk'

/**
 * Version de l'application, affichée au bas du menu principal. **Une seule
 * source : `package.json`** — l'APK la relit aussi (`apk/android/app/build.gradle`).
 * Tant qu'on est en alpha, elle s'écrit `0.1.0-alpha.N`, N montant à chaque
 * modification.
 */
const APP_VERSION: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    // Objet de diagnostic `window.__myosm` (carte, journal, zones) : présent
    // partout sauf dans la version release (`npm run apk:release`, qui passe
    // `MYOSM_DIAGNOSTICS=0`). `outils/journal.sh` en dépend en debug.
    __DIAGNOSTICS__: JSON.stringify(process.env.MYOSM_DIAGNOSTICS !== '0'),
  },
  plugins: [
    react(),
    !FOR_APK &&
    VitePWA({
      // La nouvelle version prend la main au chargement suivant, sans rien
      // demander : l'application n'a pas d'état à sauvegarder en cours de route.
      registerType: 'autoUpdate',
      manifest: {
        name: 'MY OSM — carte locale',
        short_name: 'MY OSM',
        description: 'Carte locale basée sur OpenStreetMap : commerces, horaires, itinéraires.',
        lang: 'fr',
        start_url: '/',
        display: 'standalone',
        background_color: '#f4f2ed',
        theme_color: '#f4f2ed',
        // Toutes générées par `npm run build:icons` depuis un dessin unique.
        // La variante « maskable » est indispensable sur Android : sans elle le
        // lanceur pose l'icône carrée dans une pastille blanche au lieu de la
        // rogner à la forme du système. Elle est pleine bord et le marqueur y
        // tient dans la zone sûre des 80 %.
        icons: [
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // **Service Worker écrit à la main**, et non plus généré. Le
      // téléchargement de cartes l'impose : une zone téléchargée ne peut pas
      // vivre dans un cache d'exécution de Workbox, dont le plafond d'entrées
      // et l'expiration l'effaceraient silencieusement. Il faut un cache
      // dédié, consulté avant tout le reste — une règle qui ne s'écrit pas
      // dans la configuration déclarative. Les stratégies d'exécution qui
      // étaient ici sont donc passées dans `src/sw.ts`, à l'identique.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        // Le visualiseur Mapillary reste **volontairement hors du
        // préchargement** : un mégaoctet que la plupart des visites n'ouvrent
        // jamais, et qui contredirait son chargement à la demande. Il est mis
        // en cache s'il sert, pas avant.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        globIgnores: ['**/mapillary*'],
      },
    }),
  ].filter(Boolean),
  // -------------------------------------------------------------------------
  // Le worker de MapLibre doit être **émis à côté du bundle**, sous son nom
  // exact.
  //
  // MapLibre calcule l'URL de son worker à l'exécution :
  //
  //     const url = import.meta.url
  //     const nom = url.endsWith('-dev.mjs') ? '…-worker-dev.mjs' : '…-worker.mjs'
  //     return new URL(`./${nom}`, url).href
  //
  // Le nom sort d'un ternaire, donc Vite ne peut pas l'analyser statiquement et
  // **n'émet pas le fichier**. À l'exécution, `import.meta.url` vaut
  // `…/assets/index-HASH.js` et la carte va chercher
  // `…/assets/maplibre-gl-worker.mjs`, qui n'existe pas : le worker ne démarre
  // jamais, aucune tuile n'est décodée, et la carte reste vide **sans la
  // moindre erreur** — MapLibre n'en signale aucune.
  //
  // Le serveur de développement masquait entièrement le défaut : `import.meta.url`
  // y désigne `node_modules/maplibre-gl/dist/`, où le worker existe bel et bien.
  // C'est d'ailleurs la vraie raison d'être d'`optimizeDeps.exclude` ci-dessous.
  // Le bogue ne se voyait donc qu'en version compilée, et il a fallu un APK sur
  // un vrai téléphone pour le débusquer : « Unable to open asset URL:
  // https://localhost/assets/maplibre-gl-worker.mjs ».
  //
  // On déclare donc le worker comme **seconde entrée**, avec un nom de sortie
  // figé. Rollup place ce que les deux entrées partagent dans un fragment
  // commun, que le worker importe : il n'y a pas de duplication, et le worker
  // reste un module — c'est ainsi que MapLibre l'instancie.
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        'maplibre-gl-worker': fileURLToPath(
          new URL('./node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url)
        ),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'maplibre-gl-worker'
            ? 'assets/maplibre-gl-worker.mjs'
            : 'assets/[name]-[hash].js',
      },
    },
  },

  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: { proxy: PROXY },
  preview: { proxy: PROXY },
})
