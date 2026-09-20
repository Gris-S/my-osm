// ---------------------------------------------------------------------------
// Configuration centrale de l'application.
//
// Les **clés d'API** y sont des accesseurs et non des constantes : elles se
// saisissent dans la fenêtre « API » du menu, et `.env.local` ne fournit plus
// qu'une valeur par défaut — voir `services/apiKeys.ts`. Les lire reste
// identique partout ailleurs (`CONFIG.TOMTOM_KEY`), mais **ne pas les
// déstructurer au chargement d'un module** : la valeur serait figée à
// l'import, et changer la clé dans l'application n'aurait plus d'effet.
//
// Toutes les URLs de services externes sont regroupées ici. En Phase 1
// (V1 en ligne), elles pointent vers des services publics gratuits.
// En Phase 2 (hors-ligne), il suffira de remplacer ces valeurs par les URLs
// de tes services auto-hébergés (voir README.md § "Passer en hors-ligne").
// ---------------------------------------------------------------------------

import { apiKey } from "./services/apiKeys";

export const CONFIG = {
  // Fond de carte vectoriel (MapLibre style JSON). OpenFreeMap est gratuit,
  // sans clé API, et peut être auto-hébergé plus tard avec les mêmes outils.
  // - Mode clair : style `liberty` d'OpenFreeMap (URL ci-dessous).
  // - Mode sombre : `src/styles/appleDark.ts`, généré à partir de `liberty` et
  //   recoloré façon Apple Plans (voir `scripts/build-apple-dark-style.mjs`).
  //   Il réutilise les mêmes tuiles vectorielles — rien de plus à héberger.
  MAP_STYLE_URL: "https://tiles.openfreemap.org/styles/liberty",

  // Vue satellite (imagerie aérienne), en **deux couches superposées**.
  //
  // Le fond mondial est Esri World Imagery : gratuit, sans clé, partout. Mais
  // sa qualité en France est mauvaise — comparé sur la Tour Eiffel en zoom 19,
  // le rendu Esri est sombre, contrasté et flou au point qu'on ne distingue ni
  // les passages piétons ni la structure de la tour, là où l'orthophotographie
  // de l'IGN les donne nettement, piétons compris. Esri ne sert donc plus que
  // de repli hors du territoire français.
  SATELLITE_TILE_URL:
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",

  // Par-dessus, la BD ORTHO de l'IGN, servie par la Géoplateforme : 20 cm par
  // pixel, sans clé ni inscription depuis l'ouverture des données publiques,
  // et l'origine croisée est autorisée (`access-control-allow-origin: *`,
  // mesuré). Le gabarit est un WMTS : MapLibre y substitue `{z}`, `{x}` et
  // `{y}` comme dans n'importe quelle URL, y compris en paramètres de requête.
  //
  // Ne pas chercher `HR.ORTHOIMAGERY.ORTHOPHOTOS` : mesuré, cette couche rend
  // exactement la même tuile (empreintes identiques).
  SATELLITE_IGN_TILE_URL:
    "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
    "&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM" +
    "&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",

  // Les emprises où l'IGN a des données. Hors d'elles, la source rend un 404
  // (vérifié à Londres, New York et Genève) : sans ces bornes, chaque
  // déplacement à l'étranger demanderait des tuiles pour rien. La même couche
  // couvre les départements d'outre-mer — Fort-de-France répond — d'où les
  // trois emprises plutôt qu'une seule sur la métropole.
  //
  // Pour en ajouter une (Nouvelle-Calédonie, Polynésie…), il suffit d'une
  // ligne : `MapView` en dérive source et couche.
  SATELLITE_IGN_AREAS: [
    { id: "metropole", bounds: [-5.7, 41.2, 9.9, 51.3] },
    { id: "antilles-guyane", bounds: [-63.2, 2.0, -50.8, 18.2] },
    { id: "ocean-indien", bounds: [44.9, -21.6, 55.9, -12.5] },
  ] as { id: string; bounds: [number, number, number, number] }[],

  // Routes et toponymes superposés à l'imagerie (vue « hybride »).
  SATELLITE_LABELS_TILE_URL:
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  // Liste de crédits, volontairement sans mot de liaison : elle est affichée
  // telle quelle dans les deux langues.
  SATELLITE_ATTRIBUTION:
    "© IGN (BD ORTHO) · © Esri, Maxar, Earthstar Geographics, USDA, USGS, AeroGRID, GIS community",

  // Zoom natif maximal des deux sources. Mesuré : Esri comme l'IGN rendent un
  // 404 au-delà (« Map data not yet available » côté Esri, « No data found »
  // côté IGN, testé à Paris, Lyon et Marseille). Ce n'est pas une limite
  // arbitraire côté IGN : 20 cm par pixel, c'est précisément la résolution du
  // zoom 19 sous nos latitudes. MapLibre étire ces tuiles au-delà.
  SATELLITE_MAX_ZOOM: 19,

  // -------------------------------------------------------------------------
  // Cartes hors ligne (menu burger → « Téléchargement »).
  //
  // Une zone téléchargée, c'est trois choses de natures différentes : des
  // **tuiles** (mises dans le Cache Storage, pour que le Service Worker les
  // serve sans que MapView ait à le savoir), des **détails de lieux** et des
  // **adresses** (mis dans IndexedDB, parce qu'ils sont interrogés par le
  // texte et non par une URL).
  // -------------------------------------------------------------------------
  OFFLINE: {
    // Cache **dédié**, et c'est délibéré : la règle d'exécution du Service
    // Worker qui garde les tuiles simplement consultées a un plafond
    // d'entrées et une expiration. Une zone téléchargée rangée là se ferait
    // effacer sans un mot au bout de quelques semaines de navigation.
    CACHE_NAME: "osm-local-hors-ligne-v1",

    // Les tuiles vectorielles s'arrêtent au zoom 14 (relevé dans le TileJSON
    // d'OpenFreeMap) : au-delà, MapLibre étire les mêmes tuiles. Télécharger
    // une ville, c'est donc aller jusqu'au 14, pas jusqu'au 18 — c'est ce qui
    // fait tenir Paris intra-muros dans une soixantaine de mégaoctets.
    VECTOR_MAX_ZOOM: 14,

    // Le satellite, lui, est du raster jusqu'au 19 et coûte un autre ordre de
    // grandeur : mesuré sur Paris intra-muros, 93 500 tuiles et 1,1 Go au zoom
    // 19 contre 57 Mo pour la carte entière. D'où une case décochée par
    // défaut et un zoom maximal choisi, avec le poids affiché en direct.
    SATELLITE_ZOOM_MIN: 15,
    SATELLITE_ZOOM_MAX: 19,
    SATELLITE_ZOOM_DEFAULT: 17,

    // Relief. Une tuile d'altitude pèse de 55 à 155 ko (mesuré), plus qu'une
    // tuile vectorielle, et **chaque cran de zoom quadruple le poids** : sur la
    // France, 258 Mo au zoom 10, 997 au 11, 4,1 Go au 12. D'où une plage
    // resserrée et un défaut bas — au zoom 10 on a déjà 150 mètres par pixel,
    // largement de quoi dessiner une ombre de montagne, et le relief est lisse
    // par nature : MapLibre étire les tuiles au-delà sans que cela se voie.
    RELIEF_ZOOM_MIN: 8,
    RELIEF_ZOOM_MAX: 12,
    RELIEF_ZOOM_DEFAULT: 10,
    BYTES_PER_RELIEF_TILE: 110_000,

    // Poids par tuile, **médianes mesurées** sur deux profils opposés (Paris
    // dense et banlieue/rural francilien, 14 tuiles par zoom et par profil).
    // L'écart entre les deux est considérable — 568 ko contre 84 ko au zoom 14
    // — donc ces valeurs ne servent qu'à afficher un ordre de grandeur
    // immédiat, que `calibrate()` corrige ensuite sur de vraies tuiles de la
    // zone choisie.
    BYTES_PER_VECTOR_TILE: {
      8: 263_000,
      9: 315_000,
      10: 274_000,
      11: 174_000,
      12: 184_000,
      13: 121_000,
      14: 291_000,
    } as Record<number, number>,
    BYTES_PER_VECTOR_TILE_DEFAULT: 120_000,
    BYTES_PER_RASTER_TILE: 12_000,

    // Calibrage : le zoom sur lequel on échantillonne, et combien de tuiles.
    // Le 13 est le bon compromis — assez fin pour distinguer une ville d'un
    // champ, assez léger pour que quatre tuiles coûtent un demi-mégaoctet.
    CALIBRATION_ZOOM: 13,
    CALIBRATION_SAMPLES: 4,

    // Choix d'une zone d'un toucher, comme dans Organic Maps : le zoom de la
    // carte réduite dit ce qu'on vise — en dessous de 5 un pays, jusqu'à 7 une
    // région, au-delà un département.
    PICK_REGION_ZOOM: 5,
    PICK_DEPARTMENT_ZOOM: 7,

    // Zoom maximal des tuiles selon ce qu'on a touché, sans curseur. Mesuré sur
    // la France : 2,4 Go au zoom 12, 7,1 au 13, **51,6 au 14** — un pays ne peut
    // pas descendre au détail d'une rue.
    LEVEL_VECTOR_ZOOM: { country: 11, region: 13, department: 14 } as Record<
      "country" | "region" | "department",
      number
    >,

    // Les morceaux d'une zone à plus de 4° de celui qu'on a touché sont écartés :
    // la France garde la Corse, pas l'outre-mer.
    TRIM_FAR_PARTS_DEG: 4,

    // Au-delà, le téléchargement demande une confirmation explicite. Ce n'est
    // pas une limite : on peut passer outre, mais pas sans l'avoir vu.
    CONFIRM_ABOVE_BYTES: 300_000_000,

    // Fraîcheur. La vérification est gratuite — l'URL des tuiles porte un
    // numéro de version daté (`…/planet/20260830_080001_pt/…`), il suffit de
    // relire le TileJSON pour savoir s'il y a du neuf. Faite toute seule à cet
    // intervalle (`hooks/useFreshness.ts`), sans réglage.
    REFRESH_AFTER_MS: 7 * 24 * 60 * 60 * 1000,

    // Découpe des requêtes Overpass pour les détails de lieux. Mesuré : une
    // maille de 0,02° × 0,04° rend 16 000 objets en 3,6 s. Au-delà, la requête
    // devient assez lourde pour être refusée aux heures chargées.
    OVERPASS_CHUNK_DEG: 0.04,
    OVERPASS_PAUSE_MS: 1200,

    // Ce qu'il faut mettre en cache pour que le style s'affiche sans réseau :
    // le style lui-même, ses pictogrammes et ses polices. Trois familles y
    // suffisent (relevé dans `liberty`), et ces quatre plages couvrent le
    // latin, sa ponctuation et les flèches.
    GLYPH_RANGES: ["0-255", "256-511", "8192-8447", "8448-8703"],

    // Adresses : la **BAN servie en WFS par la Géoplateforme de l'IGN**, le
    // même hôte que l'orthophotographie de la vue satellite.
    //
    // Ni le fichier de la BAN — son serveur (`adresse.data.gouv.fr/data/…`)
    // accepte la connexion puis ne répond jamais, mesuré en HTTP/2 comme en
    // HTTP/1.1 — ni BANO, le repli d'OpenStreetMap France, qui est
    // **incomplète** : 158 186 adresses sur Paris intra-muros contre 242 153
    // ici, et pas de 12 rue de Rivoli. Le WFS a par ailleurs l'avantage
    // décisif de se demander **par emprise** : quelques rues coûtent quelques
    // centaines de kilo-octets, là où un fichier BANO se prend par département
    // entier (13,9 Mo pour Paris, 77,1 Mo pour le Nord).
    BAN_WFS_URL: "https://data.geopf.fr/wfs/ows",
    BAN_WFS_LAYER: "BAN-PLUS:adresse",
    BAN_WFS_PAGE: 2000,
    // Mesuré, champs inutiles écartés : 258 octets par adresse (340 sans le
    // tri). Sert à annoncer un poids exact, le comptage `hits` étant gratuit.
    BYTES_PER_ADDRESS: 258,

  },

  // Relief : modèle numérique de terrain, pour l'ombrage et le volume.
  //
  // Les tuiles « terrarium » d'AWS encodent l'altitude dans les canaux d'un
  // PNG. Gratuites, sans clé, mondiales, et l'origine croisée est autorisée
  // (mesuré). Surtout, une **seule** source sert les deux usages : l'ombrage à
  // plat et le relief en volume quand la vue 3D est allumée.
  //
  // L'IGN publie bien un ombrage déjà dessiné, plus fin sur la France, mais
  // c'est une image : elle ne peut pas donner d'altitude, donc pas de volume,
  // et elle s'arrête aux frontières. Une source qui fait tout vaut mieux que
  // deux qui se partagent le travail.
  TERRAIN_TILE_URL: "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  TERRAIN_ENCODING: "terrarium" as const,
  // Mesuré : les tuiles existent jusqu'au zoom 15 (404 au-delà), et pèsent de
  // 55 à 155 ko pièce — plus qu'une tuile vectorielle. MapLibre étire au-delà,
  // ce qui ne se voit pas : le relief est lisse par nature.
  TERRAIN_MAX_ZOOM: 15,
  // Exagération du volume. À plat, elle est discrète : le sol se déplace juste
  // assez pour qu'on sente la hauteur sans que la carte paraisse gondolée. En
  // vue 3D, la caméra étant inclinée, on peut aller plus loin — mais pas trop,
  // au-delà les Alpes deviennent des aiguilles.
  TERRAIN_EXAGGERATION: 1.3,
  TERRAIN_EXAGGERATION_FLAT: 0.6,

  // Courbes de niveau : les lignes qui disent la raideur d'une pente —
  // serrées, ça grimpe ; espacées, c'est plat. Servies déjà dessinées par la
  // Géoplateforme, en PNG transparent (le JPEG est refusé par le service).
  //
  // Elles ne couvrent que le territoire français, et c'est assumé : l'autre
  // voie était de les calculer dans le navigateur depuis le modèle d'altitude
  // (`maplibre-contour`), ce qui aurait été mondial et sans téléchargement
  // supplémentaire — mais c'est une dépendance en version 0.1.0, un worker et
  // un protocole, qu'il aurait fallu livrer sans jamais l'avoir vue tourner.
  // Une couche raster vérifiée vaut mieux qu'une bibliothèque supposée. Les
  // emprises sont celles de l'orthophotographie : même fournisseur, mêmes
  // territoires.
  CONTOUR_TILE_URL:
    "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
    "&LAYER=ELEVATION.CONTOUR.LINE&STYLE=normal&TILEMATRIXSET=PM" +
    "&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
  // Poids mesuré : 45 ko en moyenne dans les Alpes, 3 ko en plaine — une tuile
  // sans relief est presque vide. Moyenne retenue pour l'estimation.
  BYTES_PER_CONTOUR_TILE: 25_000,
  // En dessous, les courbes d'un massif se touchent et noircissent la carte.
  CONTOUR_MIN_ZOOM: 11,
  CONTOUR_BYTES_PER_TILE_HINT: 25_000,

  // Géocodage (recherche d'adresses / lieux par nom).
  // Service public Photon (basé sur les données OSM, par Komoot).
  PHOTON_URL: "https://photon.komoot.io/api/",
  PHOTON_REVERSE_URL: "https://photon.komoot.io/reverse",

  // Recherche sur le web, pour ce que la carte ne connaît pas
  // (`services/webSearch.ts`) : DuckDuckGo, qui ne rattache pas une recherche
  // à une personne. Ouverte dans le navigateur intégré de l'APK.
  WEB_SEARCH_URL: "https://duckduckgo.com/",

  // Plateforme transport (`src/transport/`, `docs/ARCHITECTURE-API.md`).
  // Transitous : service communautaire MOTIS 2, sans clé, réservé aux projets
  // libres et non commerciaux. Sa politique d'usage (https://transitous.org/api/)
  // impose un `User-Agent` avec contact, du cache, et un lien visible vers ses
  // sources — d'où `TRANSITOUS_SOURCES_URL`.
  TRANSITOUS_API_URL: "https://api.transitous.org/api/",
  TRANSITOUS_SOURCES_URL: "https://transitous.org/sources/",
  // Adresse publique du projet : le contact placé dans les `User-Agent`
  // envoyés aux services. Jamais une adresse personnelle.
  PROJECT_URL: "https://github.com/Gris-S/my-osm",
  // Pages des sources citées dans « Sources et licences » (menu principal).
  ATTRIBUTION_LINKS: {
    osm: "https://www.openstreetmap.org/copyright",
    openfreemap: "https://openfreemap.org/",
    idfm: "https://prim.iledefrance-mobilites.fr/",
    photon: "https://photon.komoot.io/",
    ban: "https://adresse.data.gouv.fr/",
    osrm: "https://routing.openstreetmap.de/",
    openmeteo: "https://open-meteo.com/",
    meteofrance: "https://meteofrance.com/",
    tomtom: "https://www.tomtom.com/",
    bisonfute: "https://www.bison-fute.gouv.fr/",
    ign: "https://geoservices.ign.fr/",
    esri: "https://www.esri.com/",
    mapillary: "https://www.mapillary.com/",
  },

  // Contours des pays, régions et départements, pour choisir d'un toucher une
  // zone à télécharger (`services/offline/boundaries.ts`). Nominatim est le
  // géocodeur d'OpenStreetMap ; son service public n'accepte **qu'une requête
  // par seconde**, et le module s'y tient.
  NOMINATIM_REVERSE_URL: "https://nominatim.openstreetmap.org/reverse",

  // Repli quand Photon ne répond pas — ce qui arrive : l'instance publique est
  // tombée en cours de développement, et la recherche avec elle. La Base
  // Adresse Nationale est un service public français, sans clé, taillé pour la
  // saisie au clavier (0,1 s de réponse). Elle couvre les adresses, voies et
  // communes, mais pas les commerces par leur nom : c'est un filet, pas un
  // remplacement.
  BAN_URL: "https://api-adresse.data.gouv.fr/search/",
  BAN_REVERSE_URL: "https://api-adresse.data.gouv.fr/reverse/",

  // Nombre maximal de lieux ramenés par une recherche d'enseigne (« tous les
  // Burger King »), en une seule requête Overpass. Au-delà, la carte serait de
  // toute façon illisible, et le bandeau annonce « ou plus ».
  BRAND_SEARCH_LIMIT: 400,

  // Détails d'un lieu (horaires, téléphone, adresse) via Overpass API, à
  // l'ouverture d'une fiche et pour ce seul lieu. Les commerces affichés sur la
  // carte, eux, ne passent plus par le réseau : ils sont lus dans les tuiles
  // vectorielles déjà téléchargées (voir `services/tilePois.ts`).
  //
  // Plusieurs instances : les serveurs publics tombent régulièrement et
  // limitent le débit par adresse IP. La suivante n'est lancée que si la
  // précédente tarde (voir `OVERPASS_HEDGE_MS`), et la première réponse gagne.
  // En auto-hébergement, ne laisser que sa propre instance.
  OVERPASS_URLS: [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    // `maps.mail.ru` (VK, en Russie) figurait ici en dernier recours : retiré
    // le 17 septembre 2026. Il recevait la zone consultée dès que les trois
    // autres tardaient, et un exploitant de ce genre n'a pas à la connaître.
  ],

  // Délai au-delà duquel on interroge *aussi* l'instance suivante, sans
  // abandonner la première. Une instance saturée peut mettre une minute à
  // avouer son échec ; l'attendre seule laisserait la fiche sans horaires
  // pendant tout ce temps.
  OVERPASS_HEDGE_MS: 1500,

  // Délai au-delà duquel une instance est abandonnée pour de bon.
  OVERPASS_TIMEOUT_MS: 12000,

  // Seconde source pour ces mêmes détails : l'API OpenStreetMap rend un objet
  // précis par son identifiant, sans moteur de requête, donc vite et sans file
  // d'attente. Elle n'est interrogée que si Overpass tarde, et toujours pour un
  // seul objet à la fois : c'est une API d'édition, pas une source de données en
  // masse, et son règlement d'usage l'interdirait pour peupler la carte.
  OSM_API_URL: "https://api.openstreetmap.org/api/0.6",

  // Horaires en temps réel des transports franciliens (bus, métro, RER,
  // tramway, Transilien), via la plateforme PRIM d'Île-de-France Mobilités.
  //
  // La clé est **personnelle et gratuite** : elle se crée en quelques minutes
  // sur https://prim.iledefrance-mobilites.fr/. Elle se place dans un fichier
  // `.env.local` à la racine (ignoré par git) :
  //
  //     VITE_IDFM_API_KEY=votre_clé
  //
  // Sans clé, l'application fonctionne normalement : la fiche d'un arrêt
  // affiche simplement comment l'activer, au lieu des prochains passages.
  // Le quota par défaut est de 1 000 appels par jour, d'où l'absence de
  // rafraîchissement automatique et la mise en cache des réponses.
  get IDFM_API_KEY(): string {
    return apiKey("idfm");
  },
  IDFM_STOP_MONITORING_URL: "https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring",

  // Référentiel des lignes (nom, mode, couleurs officielles). Données ouvertes
  // d'Île-de-France Mobilités : pas de clé, et le résultat est mis en cache
  // localement puisqu'il ne change pratiquement jamais.
  IDFM_LINES_URL:
    "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/referentiel-des-lignes/records",

  // Référentiel des arrêts, même portail ouvert : il rattache un point de la
  // carte à sa zone d'arrêt régionale, seule à réunir les deux sens de
  // circulation.
  IDFM_STOPS_URL: "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/arrets/records",
  // Relations du référentiel : rattachent un arrêt ou une zone d'arrêt à sa
  // **zone de correspondance**, celle que Navitia nomme `stop_area:IDFM:…`
  // (Ranelagh : zone d'arrêt 44594, correspondance 71243).
  IDFM_RELATIONS_URL: "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/relations/records",

  // Lignes desservant chaque arrêt, pour afficher sur la carte les pastilles du
  // RER A ou du bus 317 plutôt qu'un pictogramme générique. L'export accepte un
  // filtre géographique et rend toute la zone en une requête, sans pagination.
  IDFM_STOP_LINES_URL:
    "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/arrets-lignes/exports/json",
  // Tracés des lignes (source GTFS), pour dessiner sur la carte la ligne dont on
  // consulte les horaires. Quelques kilo-octets pour un bus, près de six cents
  // pour le RER B : demandé à la volée, jamais préchargé.
  IDFM_LINE_SHAPES_URL:
    "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/traces-des-lignes-de-transport-en-commun-idfm/records",

  IDFM_LINES_EXPORT_URL:
    "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/referentiel-des-lignes/exports/json",

  // Réseaux dont les lignes sont représentées sur la carte : métro, tramway,
  // RER et Transilien, plus les bus RATP. Les autres transporteurs franciliens
  // gardent le pictogramme de catégorie.
  IDFM_NETWORK_FILTER:
    "transportmode in ('metro','tram') or (transportmode='rail' and transportsubmode in ('local','suburbanRailway')) or (transportmode='bus' and operatorname like 'RATP*')",

  // Les pastilles de ligne s'affichent dès que les POI apparaissent : au-delà
  // d'un certain zoom seulement, un même arrêt changeait d'apparence en cours
  // de route — pictogramme de catégorie puis pastilles — ce qui se lisait comme
  // une disparition. Sans les bus, interroger même une vue large reste léger.
  MIN_ZOOM_FOR_LINE_ICONS: 13,

  // Les arrêts de bus n'apparaissent qu'à hauteur de quartier. Paris en compte
  // des milliers : les afficher en vue large noyait la carte sous les
  // pastilles, et interroger leurs lignes sur une telle étendue coûtait plus
  // d'un méga-octet. Gares, stations de métro et de tramway, elles, s'affichent
  // dès le zoom des POI : elles sont peu nombreuses et servent de repères.
  //
  // Abaissé de 15 à 14, le zoom d'ouverture, le 19 septembre 2026 (demande
  // explicite) : la carte s'ouvrait sur la position sans une seule pastille —
  // près de 400 arrêts de bus dans les tuiles autour, aucun affiché. Au
  // zoom 14, le décombrement de MapLibre (jusqu'au zoom 15) garde la carte
  // lisible, et le coût des lignes est tenu par `IDFM_BUS_LINES_MAX_RADIUS`.
  MIN_ZOOM_FOR_BUS_STOPS: 14,
  // Rayon des lignes de bus demandées autour du centre de la vue, en mètres.
  // Mesuré à Châtelet : 110 Ko à 1,5 km, 400 Ko à 2,9 km (demi-diagonale d'une
  // vue de téléphone au zoom 14).
  IDFM_BUS_LINES_MAX_RADIUS: 1500,

  // Rayon maximal interrogé autour du centre de la vue, en mètres. Large est
  // ici sans danger : hors des bus, dix kilomètres de rayon tiennent en 200 Ko.
  IDFM_STOP_LINES_MAX_RADIUS: 10000,

  // Durée de validité d'une réponse « prochains passages » pour un arrêt.
  IDFM_DEPARTURES_TTL_MS: 30000,

  // Nombre de passages listés par destination une fois l'encart déplié.
  IDFM_MAX_DEPARTURES: 5,
  // Lignes montrées d'emblée dans la fiche d'un arrêt, les autres se déplient
  // (demande explicite : les 16 lignes de Lille Flandres faisaient déborder la
  // fiche). Elles arrivent déjà classées, le lourd d'abord.
  DEPARTURES_VISIBLE_LINES: 5,

  // Itinéraires en transports en commun : moteur Navitia exposé par PRIM. Même
  // clé et même quota que le temps réel, d'où le cache côté service — un
  // itinéraire ne se recalcule qu'à la demande (voir `services/transit.ts`).
  // Racine de l'API : on y greffe `/journeys` pour un trajet, et les départs
  // d'un arrêt pour les horaires suivants.
  IDFM_NAVITIA_URL: "https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia",

  // Trajets demandés à Navitia. On en demande plus qu'on n'en montre : les
  // trajets entièrement à pied, que le moteur propose quand le réseau ne sert
  // à rien, sont écartés à la lecture.
  IDFM_MAX_JOURNEYS: 5,
  TRANSIT_MAX_RESULTS: 3,

  // Durée de validité d'un calcul d'itinéraire en transports. Assez courte
  // pour que les horaires restent justes, assez longue pour qu'un aller-retour
  // entre les modes ne coûte pas un appel de plus.
  IDFM_JOURNEYS_TTL_MS: 60000,

  // Recherche : résultats demandés au géocodeur, et résultats montrés après
  // réunion des arrêts d'une même station (voir `search/searchResults.ts`).
  SEARCH_FETCH_RESULTS: 20,
  SEARCH_SHOWN_RESULTS: 8,

  // Âge maximal de la position quand « Ma position » devient le point de
  // départ (ou une étape) d'un itinéraire. Au-delà, on redemande un relevé et
  // l'on attend. Constaté le 19 septembre 2026 : un trajet en transports partait
  // d'une position relevée des heures plus tôt, à plusieurs kilomètres — le GPS
  // ne répondait plus, et l'ancienne position servait sans rien dire.
  ROUTE_POSITION_MAX_AGE_MS: 2 * 60_000,

  // Nombre de départs suivants montrés sous une étape dépliée : de quoi savoir
  // ce qu'on risque en ratant sa correspondance, sans transformer la frise en
  // tableau d'affichage.
  IDFM_NEXT_DEPARTURES: 5,

  // Météo, qualité de l'air et pollens : Open-Meteo. Gratuit, sans clé,
  // origine croisée autorisée, et une couverture mondiale — c'est la même
  // logique que le reste de l'application, où les services publics font le
  // travail sans inscription. Les paramètres demandés sont dans
  // `services/weather.ts`.
  OPEN_METEO_URL: "https://api.open-meteo.com/v1/forecast",
  OPEN_METEO_AIR_QUALITY_URL: "https://air-quality-api.open-meteo.com/v1/air-quality",

  // Durée de validité d'un relevé. La météo d'un lieu ne change pas d'une
  // minute à l'autre, et l'encart est rouvert souvent : dix minutes évitent
  // d'interroger le service à chaque coup d'œil.
  WEATHER_TTL_MS: 600000,

  // Vigilance météorologique (orages, canicule, crues…) : Météo-France, seule
  // source officielle pour la France, et la seule joignable depuis un
  // navigateur — les flux européens MeteoAlarm n'autorisent pas l'origine
  // croisée. Elle demande une **clé personnelle et gratuite**, créée sur
  // https://portail-api.meteofrance.fr/ (API « Données Publiques de
  // Vigilance »), à placer dans `.env.local` :
  //
  //     VITE_METEOFRANCE_API_KEY=votre_clé
  //
  // Sans clé, l'encart météo fonctionne normalement : la section vigilance ne
  // s'affiche simplement pas.
  //
  // **Une clé API seulement**, envoyée en en-tête `apikey` : elle vaut jusqu'à
  // la date choisie à sa création, et l'endpoint de vigilance l'accepte depuis
  // n'importe quelle origine. L'identifiant et le secret d'application ont été
  // retirés le 17 septembre 2026 (demande explicite) : trois champs pour un
  // service embrouillaient l'écran des clés, et leur jeton exigeait un relais.
  get METEOFRANCE_API_KEY(): string {
    return apiKey("meteofranceApiKey");
  },
  METEOFRANCE_VIGILANCE_URL: "https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours",

  // Calcul d'itinéraires par la route (voiture / marche). Les transports en
  // commun, eux, demandent des horaires : ils passent par Navitia
  // (`IDFM_NAVITIA_URL`), pas par OSRM.
  // Instances OSRM publiques de la FOSSGIS (celles utilisées par
  // openstreetmap.org). Contrairement au serveur de démo `router.project-osrm.org`
  // (voiture uniquement), il y a ici un vrai profil par mode : `routed-foot`
  // emprunte les chemins/trottoirs, ignore les autoroutes et calcule un temps
  // de marche réaliste (~4,5 km/h). Usage raisonnable seulement — pour de la
  // production, héberger ses propres instances OSRM (voir README.md).
  OSRM_ROUTING: {
    driving: "https://routing.openstreetmap.de/routed-car",
    walking: "https://routing.openstreetmap.de/routed-foot",
  } as const,

  // Étapes intermédiaires d'un parcours. Le plafond n'est pas une limite des
  // moteurs — OSRM en accepte cent, et les transports enchaînent des appels —
  // mais celle de ce qu'un panneau flottant peut montrer et de ce qu'un
  // itinéraire en transports peut coûter : chaque étape ajoute un appel à
  // Navitia, sur le quota partagé de 1 000 par jour.
  MAX_WAYPOINTS: 15,

  // Au-delà de ce nombre d'étapes, la liste cesse de s'allonger et défile sur
  // place : le panneau porte aussi les modes, le résultat et le détail du
  // trajet, et quinze lignes le pousseraient hors de l'écran.
  WAYPOINTS_VISIBLE: 4,

  // Photos de rue Mapillary (Meta). La couverture est publiée en tuiles
  // vectorielles — les séquences parcourues et les points de prise de vue — et
  // chaque photo se demande ensuite à l'API Graph.
  //
  // Une **clé personnelle et gratuite** est nécessaire, créée en quelques
  // minutes sur https://www.mapillary.com/dashboard/developers (« Client
  // token », de la forme `MLY|…`), à placer dans `.env.local` :
  //
  //     VITE_MAPILLARY_TOKEN=votre_jeton
  //
  // Sans jeton, l'option reste visible dans le menu d'affichage et explique
  // comment l'activer, plutôt que de disparaître sans raison apparente.
  get MAPILLARY_TOKEN(): string {
    return apiKey("mapillary");
  },
  MAPILLARY_TILE_URL: "https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}",
  MAPILLARY_GRAPH_URL: "https://graph.mapillary.com",

  // Vert de Mapillary, celui de leur propre carte de couverture.
  MAPILLARY_COLOR: "#05cb63",

  // Les points de prise de vue ne s'affichent qu'à hauteur de rue. Ce n'est pas
  // qu'une question de lisibilité : mesuré, une tuile z14 de Paris pèse 1,5 Mo
  // sur le réseau — elle porte près de 40 000 points — contre 112 Ko en z13,
  // qui n'a que les séquences. Le seuil décide donc de ce qu'on télécharge.
  MAPILLARY_MIN_ZOOM_FOR_IMAGES: 15,

  // Zoom au-delà duquel les séquences ne sont plus redemandées : la tuile z13
  // est étirée, ce qui évite les tuiles z14 et leur mégaoctet et demi tant
  // qu'on ne cherche pas une photo précise.
  MAPILLARY_SEQUENCE_MAX_ZOOM: 13,

  // --- Calque « Trafic » ---------------------------------------------------
  //
  // Deux sources, l'une gratuite et publique, l'autre facultative :
  //
  //  - **Bison Futé** (Point d'Accès National, format DATEX II) : les
  //    événements du réseau routier national — bouchons, accidents, chantiers,
  //    fermetures — avec leur gravité et leur description en français. Mesuré :
  //    11 564 enregistrements dont 2 576 localisés, 4,3 Mo bruts mais 198 Ko
  //    compressés, publiés en continu. Gratuit, sans clé, national.
  //
  //    L'URL est **relative** parce que le flux n'envoie aucun en-tête
  //    d'origine croisée — mesuré, comme pour le jeton Météo-France : le
  //    serveur de développement le relaie (`vite.config.ts`), et une
  //    installation en production a besoin du même relais.
  //
  //  - **TomTom** (facultatif) : les routes colorées selon le débit, en tuiles
  //    prêtes à poser. C'est ce qu'on imagine en disant « trafic », et aucune
  //    source publique française ne le rend — l'état coloré de Bison Futé
  //    (TRAFICOLOR) désigne ses points par identifiant sans publier leur
  //    géométrie. Une clé personnelle et gratuite s'obtient sur
  //    https://developer.tomtom.com — palier gratuit relevé sur la page tarifs
  //    du 9 septembre 2026 : **200 000 tuiles par mois** pour « Traffic Flow &
  //    Incidents API Raster Tiles », sans carte bancaire. Elle se place dans
  //    `.env.local` :
  //
  //        VITE_TOMTOM_KEY=votre_clé
  //
  //    Sans clé, le calque fonctionne : il montre les événements, et l'explique.
  TRAFFIC_EVENTS_URL: "/api/traffic/events",
  // Les adresses réelles derrière les relais du serveur de développement
  // (`vite.config.ts`). L'APK n'a pas de serveur : il les appelle directement,
  // par le natif (`services/native.ts`). Les deux listes doivent rester
  // d'accord — un relais ajouté là-bas s'ajoute ici.
  RELAY_TARGETS: {
    "/api/traffic/events":
      "https://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/Evenementiel-DIR/grt/RRN/content.xml",
  } as Record<string, string>,
  get TOMTOM_KEY(): string {
    return apiKey("tomtom");
  },
  TOMTOM_TRAFFIC_TILE_URL:
    "https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png",

  // Calcul d'itinéraire voiture, pour la **navigation guidée** (voir
  // `src/navigation/car/`). Même clé que le calque ci-dessus, autre palier :
  // 20 000 requêtes par mois, une par calcul quelle que soit la distance.
  //
  // C'est la seule entrée que le dossier `src/navigation/` ajoute ici, et elle
  // y est plutôt que dans le module parce que la règle qui veut qu'aucune URL
  // de service ne soit codée ailleurs sert un but plus large : le passage à
  // l'auto-hébergement se lit à un seul endroit. Retirer la navigation, c'est
  // donc supprimer le dossier **et** cette ligne.
  //
  // Ce que cette API donne, mesuré le 11 septembre 2026 : la durée avec le
  // trafic en cours (`traffic=true`), les sections à péage, les **vitesses
  // limites** (`sectionType=speedLimit` → `maxSpeedLimitInKmh`), les **voies à
  // emprunter** (`sectionType=lanes`, chaque voie portant ses flèches et un
  // marqueur `follow`), des instructions en français, et des itinéraires de
  // rechange. Elle autorise l'origine croisée — contrairement à Bison Futé,
  // aucun relais à prévoir. Ce qu'elle ne donne **pas** : le prix des péages.
  TOMTOM_ROUTING_URL: "https://api.tomtom.com/routing/1/calculateRoute",
  // Le flux est republié en continu ; le relire plus souvent ne rendrait pas
  // des bouchons plus frais, et chaque lecture coûte deux cents kilo-octets.
  TRAFFIC_TTL_MS: 3 * 60 * 1000,
  // En dessous de ce zoom, les événements se superposent en un cordon illisible
  // à l'échelle du pays, et il y en a plus de deux mille.
  TRAFFIC_MIN_ZOOM: 8,

  // Centre initial de la carte + pays de travail prioritaire.
  // Paris, France par défaut (déduit de ta position) — modifiable librement.
  DEFAULT_CENTER: { lon: 2.3522, lat: 48.8566 },
  // Zoom d'ouverture : les tuiles ne portent toute la densité de commerces qu'à
  // partir du zoom 14 (avant, seulement les lieux majeurs). Ouvrir la carte à
  // 14 donne donc d'emblée une vue peuplée.
  DEFAULT_ZOOM: 14,
  COUNTRY_NAME: "France",
  COUNTRY_BBOX: [-5.317, 41.2, 9.66, 51.34] as [number, number, number, number], // pour Photon (bias) et futurs exports OSM

  // En dessous de ce niveau de zoom, aucun commerce n'est affiché. Les tuiles
  // ne portent de toute façon que les lieux majeurs avant le zoom 14 : la
  // densité complète arrive à partir de là, ce qui évite d'encombrer les vues
  // larges sans qu'on ait à filtrer nous-mêmes.
  MIN_ZOOM_FOR_POIS: 13,

  // Plafond de POI passés à la carte pour une vue. Les tuiles en contiennent
  // beaucoup plus en zone dense ; au-delà de ce nombre, les mieux classés
  // (champ `rank` d'OpenMapTiles) sont retenus et MapLibre écarte de lui-même
  // les pastilles qui se chevauchent.
  MAX_VISIBLE_POIS: 1500,
};

// Le mode « transit » n'a pas de profil OSRM : il est calculé sur les horaires
// (voir `services/transit.ts`). D'où `RoadMode`, qui désigne les seuls modes
// que l'on demande à un routeur de voirie.
export type TravelMode = "driving" | "walking" | "transit";
export type RoadMode = Exclude<TravelMode, "transit">;
