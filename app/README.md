# MY OSM — carte locale basée sur OpenStreetMap

V1 en ligne d'une application de cartographie type Apple Plans : fond de
carte OSM, recherche de lieux, commerces avec horaires d'ouverture,
itinéraires (voiture, à pied, transports en commun), météo, géolocalisation. Pensée dès le départ
pour évoluer vers un mode hors-ligne puis un packaging APK (Capacitor).

## Démarrer

```bash
npm install
npm run dev
```

Ouvre `http://localhost:5173`. Aucune clé API n'est nécessaire pour la carte,
la recherche, les commerces et les itinéraires voiture / à pied : ces services
sont publics et gratuits.

Deux fonctionnalités demandent une clé, personnelle et gratuite dans les deux
cas, et facultative : les **transports franciliens** (prochains passages en
temps réel et itinéraires en transports en commun) et la **vigilance
météorologique**. La météo elle-même, la qualité de l'air et les pollens n'en
demandent aucune.

Côté Météo-France, deux formes d'identifiants sont acceptées : une **clé API**
durable (en-tête `apikey`), ou l'**identifiant et le secret** de l'application
— dans ce second cas l'application demande elle-même un jeton et le
**renouvelle automatiquement**, ce qui évite de recopier toutes les heures le
jeton éphémère que délivre la console d'essai du portail. Voir `.env.example`.

Cette seconde voie passe par un **relais du serveur de développement**
(`vite.config.ts`) : le point d'authentification de Météo-France est le seul
service de l'application à refuser les appels d'origine croisée, et un
navigateur ne peut donc pas l'atteindre directement. `npm run dev` et
`npm run preview` fournissent ce relais ; un déploiement statique aurait besoin
de son équivalent, ou d'une clé API, qui s'utilise sans relais.

```bash
cp .env.example .env.local     # puis y coller les clés obtenues sur
                               # https://prim.iledefrance-mobilites.fr/
                               # et https://portail-api.meteofrance.fr/
```

Sans elles, l'application fonctionne normalement : la fiche d'un arrêt et le
mode « transports » du panneau d'itinéraire indiquent comment activer la
première, et l'encart météo se passe de sa section « Vigilance ».

```bash
npm run build     # build de production dans dist/
npm run preview   # sert le build pour vérification
```

## Stack technique

| Brique | Choix | Rôle |
|---|---|---|
| UI | React 19 + TypeScript + Vite | app shell, composants |
| Carte | [MapLibre GL JS](https://maplibre.org/) | rendu de tuiles **vectorielles** (nécessaire pour un rendu fin façon Apple Plans — du raster classique type Leaflet ne le permettrait pas) |
| Fond de carte | [OpenFreeMap](https://openfreemap.org/) (style `liberty`) | gratuit, sans clé API, **auto-hébergeable à l'identique** plus tard |
| Recherche / géocodage | [Photon](https://photon.komoot.io/) (Komoot, public) | recherche de lieux/adresses, géocodage inverse |
| Repli de recherche | [Base Adresse Nationale](https://adresse.data.gouv.fr/) | adresses, voies et communes quand Photon ne répond pas — service public français, sans clé |
| Commerces affichés | couche `poi` des **tuiles vectorielles** (schéma OpenMapTiles) | lus en mémoire dans les tuiles déjà téléchargées : aucune requête, affichage instantané |
| Horaires & coordonnées | [Overpass API](https://overpass-api.de/), API OSM en secours | interrogées pour un seul lieu, à l'ouverture de sa fiche |
| Itinéraires | [OSRM](http://project-osrm.org/) via les instances publiques FOSSGIS (`routing.openstreetmap.de`) | un profil dédié par mode : `routed-car` (voiture), `routed-foot` (à pied — emprunte les chemins, ignore les voies rapides) |
| Temps réel transports | [PRIM](https://prim.iledefrance-mobilites.fr/) (Île-de-France Mobilités), format SIRI Lite | prochains passages bus / métro / RER / tram / Transilien ; clé gratuite, appelée directement depuis le navigateur |
| Itinéraires en transports | moteur [Navitia](https://doc.navitia.io/) exposé par PRIM | calcule sur les **horaires** (théoriques, ou du jour quand la ligne les diffuse) : heures de départ et d'arrivée, correspondances, temps d'attente. Même clé et même quota que le temps réel, Île-de-France seulement |
| Référentiel des lignes | [données ouvertes IDFM](https://data.iledefrance-mobilites.fr/) | nom, mode et couleurs officielles d'une ligne, sans clé |
| Météo | [Open-Meteo](https://open-meteo.com/) | relevé du moment (température, code temps OMM) ; gratuit, sans clé, couverture mondiale |
| Qualité de l'air & pollens | Open-Meteo *Air Quality* (données européennes CAMS) | indice européen EAQI et six espèces de pollens ; sans clé |
| Vigilance météo | [Météo-France](https://portail-api.meteofrance.fr/) (API Données Publiques de Vigilance) | seule source officielle joignable depuis un navigateur — les flux européens MeteoAlarm n'autorisent pas l'origine croisée ; identifiants gratuits et facultatifs (clé API durable, ou identifiant + secret avec renouvellement automatique du jeton) : sans eux, la section vigilance ne s'affiche pas |
| Photos de rue | [Mapillary](https://www.mapillary.com/) (Meta) + `mapillary-js` | couverture en tuiles vectorielles (séquences et points de prise de vue), puis le visualiseur officiel — rotation de la caméra, déplacement dans la rue, panoramas — chargé à la demande ; jeton gratuit, facultatif |
| Icônes | lucide-react | cohérent avec un langage visuel type SF Symbols |

Toutes les URLs de services externes sont centralisées dans `src/config.ts` —
c'est le seul fichier à modifier pour basculer vers des services
auto-hébergés (voir plus bas).

## Structure du projet

```
src/
  config.ts              # endpoints, zone géographique par défaut
  types.ts                # types partagés (Place, RouteResult...)
  filters.ts               # catégories de POI : tags OSM, couleurs, requête Overpass
  utils/
    openingHours.ts        # parseur simplifié de la syntaxe OSM opening_hours
    format.ts               # formatage distance/durée
    clipboard.ts             # copie presse-papiers (avec repli hors contexte sécurisé)
    share.ts                  # partage système + lien carte d'un lieu
    markerImage.ts           # pastilles de POI dessinées sur canvas (icône + couleur)
  services/
    geocode.ts              # recherche + géocodage inverse (Photon)
    tilePois.ts              # commerces lus dans les tuiles vectorielles (aucun réseau)
    idfm.ts                   # prochains passages des transports franciliens (PRIM
                               # + référentiel ouvert des arrêts et des lignes)
    idfmNetwork.ts             # lignes desservant les arrêts visibles (pastilles sur la carte)
    overpass.ts               # horaires/téléphone d'un lieu (Overpass, puis API OSM)
    weather.ts                  # météo, qualité de l'air, pollens, vigilance
    routing.ts                 # itinéraires voiture / à pied (OSRM, une instance par mode)
    transit.ts                  # itinéraires en transports en commun (Navitia via PRIM)
  hooks/
    useGeolocation.ts         # position GPS (à remplacer par le plugin
                                # Capacitor en version APK, même interface)
    useTheme.ts                # thème clair/sombre (système + choix persisté)
    useBasemap.ts              # fond de carte plan / satellite (choix persisté)
    useMap3D.ts                # vue 3D : caméra inclinée (choix persisté)
    useMapillary.ts             # couverture des photos de rue (choix persisté)
    usePlaceSearch.ts          # recherche Photon anti-rebond (barre + départ d'itinéraire)
    usePlaceFilters.ts          # catégories cochées dans le menu des catégories (choix persisté)
    useBookmarks.ts              # lieux enregistrés, dossiers et couleurs (persistés)
  i18n/
    index.ts                  # langue de l'interface : magasin, t(), tp(), tParts()
    fr.ts                      # dictionnaire français — la référence
    en.ts                       # traduction anglaise (typée sur fr.ts)
  styles/
    appleDark.ts              # style MapLibre du mode sombre (généré, cf. scripts/)
    ui/*.css                   # feuilles de l'interface, une par zone
  components/
    MapView.tsx                # carte MapLibre : POI, itinéraire, marqueurs
    SearchBar.tsx                # barre de recherche + autocomplétion
    FilterMenu.tsx                # menu des catégories : ce que la carte affiche
    MapStatus.tsx                  # bandeau "chargement" / "commerces indisponibles"
    WeatherCard.tsx                 # encart météo (haut à droite) + air, pollens, vigilance
    BookmarksMenu.tsx               # signets : dossiers dépliables, couleurs, affichage sur la carte
    SavePlaceDialog.tsx             # fenêtre « Enregistrer » : nom et dossier
    PlaceSheet.tsx                 # fiche lieu (bottom sheet) + horaires
    ItineraryPanel.tsx              # départ/arrivée, sélecteur de mode, résumé trajet
                                     # (en transports : liste des trajets proposés)
    LocateButton.tsx                 # bouton "me localiser"
    AppMenu.tsx                       # burger + fenêtre « Paramètres » au centre (thème, langue)
    MapOptionsMenu.tsx                # menu d'affichage : plan / satellite, 3D, photos de rue
    StreetPhoto.tsx                    # vue de rue (mapillary-js), chargée à la demande
    TransitDepartures.tsx             # prochains passages : un encart par ligne, puis par direction
    ErrorBoundary.tsx                # évite la page blanche si le rendu échoue
  App.tsx                            # assemblage + état de l'application
  App.css                             # liste ordonnée des feuilles de styles/ui/
```

## Icône

L'icône est **une image fournie**, `scripts/icon-source.png` (1024 px, coins
transparents) : une maison posée sur une carte, marquée d'un repère de
position. Elle a remplacé le 16 septembre 2026 un dessin vectoriel décrit dans
ce même script, qui superposait une maison aux proportions du logo Home
Assistant, une carte en aplats et le dard de Mapillary.

> Ce remplacement lève au passage une réserve qui pesait sur la diffusion : le
> dard est une marque déposée de Mapillary, et l'ancien dessin en reprenait le
> tracé officiel — acceptable pour un logiciel personnel, mais il aurait fallu
> en dériver une forme propre avant de publier. La nouvelle image n'en contient
> aucun.

**Une seule commande produit tout**, et le lanceur Android n'est plus tenu à
part :

```bash
npm run build:icons
```

| Fichier | Rôle | Traitement |
| --- | --- | --- |
| `public/favicon.png` (256 px) | onglet du navigateur, manifeste | couleurs pleines |
| `public/apple-touch-icon.png` (180 px) | écran d'accueil iOS | aplati sur blanc — iOS refuse la transparence |
| `public/icon-512.png` | manifeste `purpose: any`, logo du README | couleurs pleines |
| `public/icon-maskable-512.png` | manifeste `purpose: maskable` | aplati, pleine bord |
| `…/res/mipmap-*/ic_launcher*.png` | lanceur Android, 5 densités × 3 fichiers | palette de 255 couleurs |
| `fastlane/…/images/icon.png` | fiche F-Droid | copie du 512 |

Trois choses à connaître avant d'y revenir :

- **Il n'y a plus de `favicon.svg`.** Une image matricielle n'a pas de forme
  vectorielle ; `index.html` et le manifeste pointent un PNG. Le script
  supprime l'ancien SVG s'il le trouve.
- **La palette ne s'applique qu'aux petites.** Mesuré sur le 512 : elle divise
  le poids par cinq pour 2,2 % d'écart quadratique, et agrandie trois fois elle
  se voit — le ciel se marche en paliers, la route rose se mouchette. Le
  lanceur dessine ses rasters de 48 à 192 px et jamais au-delà, où les deux
  versions sont indiscernables ; les grandes, qu'on regarde en grand sur la
  fiche F-Droid et le README, restent en couleurs pleines. Sans ce partage
  l'ensemble pèserait 1,24 Mo au lieu de 807 ko.
- **Sans icône *maskable*, le lanceur pose l'icône carrée dans une pastille
  blanche** au lieu de la rogner à sa forme. Elle est donc pleine bord, comme
  le premier plan adaptatif : le masque recoupe la bordure de carte, jamais le
  sujet, qui est centré.

**Ne retoucher aucun de ces fichiers à la main** : ils sont écrasés à chaque
exécution. Seul prérequis, ImageMagick (« magick »), qui n'est pas une
dépendance npm.

## Fonctionnalités V1

- **Interface en français ou en anglais**, au choix dans les paramètres
  (menu burger → « Paramètres » → « Langue »). Par défaut, l'application suit
  la langue de l'appareil et continue de la suivre tant qu'on n'a rien choisi ;
  le choix, lui, est mémorisé. Le français est la langue de référence
  (`src/i18n/fr.ts`) et l'anglais en est la traduction, typée sur elle — une
  phrase sans traduction casse le build plutôt que d'atterrir à l'écran. Les
  dates, les heures et les nombres suivent la langue retenue. Les libellés de
  la carte, eux, restent ceux d'OpenStreetMap : ce sont les noms locaux.
- **Carte vectorielle** interactive (zoom, rotation, pan) rendue façon Plans.
- **Recherche** de lieux/adresses en direct avec autocomplétion, avec un
  **repli** sur la Base Adresse Nationale. Ce n'est pas une précaution
  théorique : l'instance publique de Photon est tombée en cours de
  développement — connexion refusée, y compris depuis d'autres réseaux — et la
  recherche avec elle. La BAN est un service public français, sans clé, taillé
  pour la saisie au clavier : mesuré, 100 ms par requête. Elle couvre adresses,
  voies et communes, mais pas les commerces par leur nom : la recherche y perd
  en portée, la barre continue de servir. Le géocodage inverse — le nom du point
  qu'on touche sur la carte — bascule de la même façon.
- **Commerces & POI, sans attente** : ils sont lus **dans les tuiles
  vectorielles déjà téléchargées** pour dessiner la carte. Le schéma
  OpenMapTiles y embarque une couche `poi` (nom, `class`, `subclass`, `rank`) :
  `map.querySourceFeatures()` la relit en mémoire, sans la moindre requête —
  environ **7 ms pour 1 500 commerces**, là où interroger Overpass sur la même
  zone demandait **près de 40 secondes**, quand l'instance publique ne refusait
  pas simplement de répondre. Les POI apparaissent donc au rythme des tuiles,
  c'est-à-dire en même temps que la carte elle-même.
  Le classement dans les catégories se fait en deux temps
  (`src/services/tilePois.ts`) : la `subclass` d'une tuile *est* la valeur du
  tag OSM (`restaurant`, `supermarket`, `bus_stop`…), il suffit donc d'en
  retrouver la clé à partir des valeurs déclarées dans `filters.ts` ; pour les
  valeurs qu'aucun groupe n'énumère — les milliers de `shop=*` du fourre-tout —
  c'est la `class` de la tuile qui tranche, via le champ `tileClasses` de chaque
  groupe. Ce qui n'est réclamé ni par une valeur ni par une classe n'est pas
  affiché, ce qui écarte d'office les corbeilles, bornes et arceaux à vélos que
  la couche POI transporte aussi.
  Les POI lus sont **gardés en mémoire** au fil de la navigation, et l'affichage
  est tiré de ce souvenir filtré par l'emprise visible. C'est ce qui garantit
  qu'ils restent là quand on zoome sur une rue précise : les tuiles ne portent
  la couche `poi` que jusqu'au zoom 14, au-delà MapLibre réutilise la tuile de
  niveau 14 et la relecture peut ne plus rien rendre selon l'état de son cache.
  Au passage, l'affichage ne clignote plus pendant qu'une tuile se recharge.
  Trois réglages de la couche veillent à ce qu'une pastille ne disparaisse pas
  au moment où l'on zoome pour la voir :
  - **le décombrement s'arrête au zoom 15.** En vue large, MapLibre écarte les
    pastilles qui se chevauchent, ce qui garde la carte lisible ; passé le
    zoom 15, toutes sont dessinées, sans quoi deux commerces voisins de
    quelques mètres se masquaient l'un l'autre ;
  - **les noms n'arrivent qu'au zoom 16**, un cran après. Un libellé occupe
    beaucoup plus de place à l'écran que la pastille qu'il accompagne et entre
    lui aussi dans le calcul des chevauchements : en apparaissant en même temps
    que les pastilles, il empêchait d'en placer certaines, et zoomer faisait
    donc disparaître des commerces ;
  - **l'ordre de placement est fixé par le `rank` d'OpenMapTiles** plutôt que
    par l'ordre d'arrivée des lieux dans la source. Cet ordre-là change à
    chaque relecture : ce n'étaient jamais les mêmes pastilles qui gagnaient la
    place disponible, et certaines clignotaient d'un déplacement à l'autre.
  La densité suit le zoom sans qu'on ait à la brider : avant le zoom 14, les
  tuiles ne portent que les lieux majeurs (une centaine par tuile) ; à partir de
  14, tout y est (près de 10 000 lieux nommés sur une tuile parisienne). Seul un
  plafond (`MAX_VISIBLE_POIS`) retient les mieux classés — champ `rank`
  d'OpenMapTiles — quand la vue en contient plus, et MapLibre écarte ensuite les
  pastilles qui se chevauchent.
- **Fiche lieu : horaires, téléphone, site web, adresse.** Elle s'ouvre partout
  — sur une pastille, sur un résultat de recherche, ou sur un point quelconque
  de la carte, nommé alors par l'adresse la plus proche. C'est **son contenu**
  qui s'adapte : l'**encart d'horaires n'apparaît que là où il a un sens**,
  c'est-à-dire pour un lieu classé (commerce, musée, parc…). Une rue, une
  adresse ou un point posé au hasard n'ouvre ni ne ferme, et « horaires non
  renseignés » n'y apprendrait rien.

  Ces champs ne sont pas dans les tuiles. Ils sont demandés **à l'ouverture d'une fiche, pour ce
  seul lieu**, à partir de son identifiant OSM — que la tuile porte, encodé par
  Planetiler sous la forme `id OSM × 10 + type` (1 = nœud, 2 = chemin,
  3 = relation). Les résultats de recherche partagent cette clé (Photon rend
  `osm_type`/`osm_id`), donc un lieu trouvé par son nom donne la même fiche
  qu'un lieu cliqué sur la carte. La fiche s'affiche immédiatement avec le nom
  et la catégorie ; le reste s'y ajoute dès la réponse, gardée ensuite en
  mémoire. Elle présente :
  - un **encart d'horaires** : « Ouvert » en vert ou « Fermé » en rouge, suivi
    de l'heure de fermeture (« · ferme à 19:00 ») ou de la prochaine ouverture
    (« · ouvre demain à 10:00 »), et une flèche qui déplie le **tableau de la
    semaine**, jour courant en évidence ;
  - **le tracé de la ligne dépliée s'affiche sur la carte**, à sa couleur
    officielle et cerné d'un liseré pour se détacher du fond. Il vient des
    tracés GTFS publiés par Île-de-France Mobilités (sans clé), demandés à la
    volée : quelques kilo-octets pour un bus, près de six cents pour le RER B —
    d'où un chargement au moment du dépli plutôt qu'un préchargement, et un
    cache de huit tracés en mémoire. Replier la ligne, ou fermer la fiche,
    efface le tracé.
  - les boutons **Itinéraire**, **Appeler**, **Site web** et **Partager** ;
  - le **numéro de téléphone en clair**, cliquable (`tel:`) ;
  - l'**adresse**.

  Chaque cas d'absence a son message : recherche en cours, horaires non
  renseignés dans OSM, ou sources injoignables — une information manquante ne
  se dit jamais comme une fermeture. Exception faite des **transports**, où
  l'encart d'horaires ne s'affiche que si le lieu en déclare vraiment : un
  arrêt n'a pas d'heures d'ouverture, ce sont ses prochains passages qui
  répondent à la question. Une station-service ouverte 24 h/24 garde donc son
  encart, un arrêt de bus n'affiche plus « horaires non renseignés ».
- **Lecture des `opening_hours` : ce qui se lit est lu, le reste est mis de
  côté.** Une valeur courante comme
  `Mo-Fr 09:00-18:30; Sa 09:00-12:30; PH off; 2024 May 20 off` ne doit pas faire
  abandonner tout le parseur. `src/utils/openingHours.ts` en tire donc la
  semaine complète, la mention « Fermé les jours fériés » affichée sous le
  tableau, et l'oubli de l'exception datée d'une année révolue — qui
  n'apprendrait plus rien. Sont également gérés : les horaires sans jour
  (`09:00-18:00`, valables toute la semaine), les mentions `PH`/`SH` avec ou
  sans horaires, les dates traduites (`Dec 25 off` → « Fermé le 25 décembre »),
  les commentaires entre guillemets et les **préfixes de saison**
  (`Apr-Sep: Mo-Su 09:00-19:00`), dont seule la saison en cours s'applique,
  l'autre étant mentionnée sous le tableau.
  Ce qui reste indéchiffrable n'est jamais deviné : un jour dont l'horaire ne se
  lit pas (`Sa sunrise-sunset`) est marqué « Horaires variables » et non
  « Fermé », et si c'est le jour même, l'encart s'abstient de trancher plutôt
  que d'annoncer une fermeture. Une valeur dont rien n'est lisible s'affiche
  telle qu'elle est dans OpenStreetMap.
- **« Transports » ne contient que des points de montée.** Une catégorie de
  transports pleine de choses sans horaire n'aidait pas à lire la carte : les
  bouches de métro et accès de gare en sont sortis — une seule grande gare en
  aligne parfois vingt, tous redondants avec la station qu'ils desservent — le
  stationnement a sa propre catégorie, et les services de mobilité
  (stations-service, bornes de recharge, Vélib', loueurs, stations de taxi)
  rejoignent « autres commerces & services », où ils restent affichables sans
  encombrer les lignes. Mesuré sur une tuile parisienne dense : 572 icônes de
  transport avant, **252 après**, dont 108 bouches de métro écartées.
- **Une gare, une icône.** OpenStreetMap décrit une grande gare par plusieurs
  objets — un par mode, par quai ou par compagnie — et Châtelet affichait
  quatre fois la même pastille. Les arrêts de même nom et de même mode situés à
  moins de 300 mètres sont donc réunis en un seul point, le mieux classé
  représentant l'ensemble : sur la même tuile, 252 arrêts deviennent **133
  icônes**. Le mode compte dans le regroupement : un poteau de bus « Châtelet »
  et la station de métro homonyme restent distincts, puisqu'on n'y prend pas
  les mêmes lignes. La contrainte de distance l'est tout autant — « Mairie » ou
  « Église » nomment des dizaines d'arrêts sans rapport dans la région.
- **Les arrêts portent les pastilles de leurs lignes** plutôt qu'un pictogramme
  générique : une gare de banlieue s'affiche « A » en rouge RER, le poteau
  de bus voisin avec ses numéros de ligne. Trois pastilles au plus sont empilées, et
  un « + N » gris indique qu'il y en a davantage — la fiche du lieu les donne
  toutes. Libellés et couleurs viennent du référentiel officiel ; un arrêt
  annoncé par ses lignes n'affiche plus son nom, les pastilles disent déjà
  l'essentiel.

  **Les arrêts s'affichent par paliers.** Gares, stations de métro et de
  tramway apparaissent dès le zoom des POI : peu nombreuses, elles servent de
  repères. Les **arrêts de bus attendent le zoom 16**, hauteur de rue : Paris
  en compte des milliers, et les afficher en vue large noyait la carte sous les
  pastilles. Le palier allège aussi la requête, puisque les bus font 85 % du
  référentiel — une zone de dix kilomètres passe de 1,6 Mo à 200 Ko quand on
  les écarte, ce qui permet de couvrir toute la vue plutôt que ses deux
  premiers kilomètres.

  Ne sont concernés que **le réseau RATP et le Transilien SNCF** — métro,
  tramway, RER, Transilien et bus RATP ; les autres transporteurs franciliens
  gardent le pictogramme de catégorie (`IDFM_NETWORK_FILTER` dans `config.ts`).
  Deux jeux de données ouvertes, sans clé : le référentiel des lignes, réduit
  aux réseaux concernés — 306 lignes, 12 Ko une fois ramené au libellé et aux
  couleurs, gardés dans `localStorage` — et les arrêts avec leurs lignes,
  interrogés par zone. L'export accepte un filtre géographique et rend toute la
  zone visible **en une seule requête** (~15 Ko, 0,2 s), ce qui évite de
  paginer à chaque déplacement. Les pastilles arrivent après l'affichage : la
  carte ne s'interrompt pas pour les attendre.

  Le rattachement d'un arrêt de la carte à ses lignes se fait par proximité,
  **filtré par mode** : sans cela, une gare hériterait des bus qui la
  desservent — devant une gare de banlieue, les poteaux « <nom de la gare> RER »
  sont à quelques dizaines de mètres et portent presque le même nom. Le nom
  exact prime, et vaut jusqu'à 250 mètres : une grande gare d'échange s'étale,
  les quais « Châtelet » sont distants de plus de cent mètres.
- **Prochains passages en temps réel** (bus, métro, RER, tramway, Transilien).
  Cliquer un arrêt ou une gare affiche, en tête de fiche :
  - **un encart par ligne**, avec sa pastille aux couleurs officielles du
    réseau et le prochain passage — « dans 4 min », « à quai », ou « Service
    terminé » ;
  - une **seule ligne dépliée à la fois** : ouvrir le bus 46 replie le métro 9,
    sans quoi la fiche d'un arrêt bien desservi s'étalerait sur plusieurs
    écrans. Les destinations d'une même ligne, elles, s'ouvrent librement — on
    compare volontiers deux directions du même bus ;
  - **déplié, un encart par destination**, qui annonce lui aussi son prochain
    passage et se déplie à son tour sur les cinq **suivants** — pas le premier,
    déjà affiché juste au-dessus — heure et voie comprises. Un passage supprimé est barré et signalé comme tel.

  **Tous les modes se regroupent par terminus**, RER compris. Le sens de
  circulation aurait fait des encarts plus compacts, mais la source ne le donne
  pas de façon fiable : relevé à Châtelet-Les Halles, une partie des trains du
  RER A arrive avec un `DirectionRef` vide, si bien qu'un même encart réunissait
  La Défense, Marne-la-Vallée et Saint-Germain-en-Laye — deux directions
  opposées sous une seule étiquette, et deux encarts affichant « Direction
  ouest ». Le terminus, lui, est toujours renseigné et dit sans ambiguïté où va
  le train.

  Deux passages sont écartés au passage : ceux dont le terminus est la station
  elle-même — un train qui finit là ne mène nulle part, et l'encart aurait
  annoncé « Vers Denfert-Rochereau » à Denfert-Rochereau — et ceux à plus de
  deux heures, qui ne sont plus des « prochains passages ».

  **Les lignes muettes sont affichées, pas escamotées.** Le référentiel et le
  temps réel ne couvrent pas le même périmètre : à Châtelet-Les Halles, le
  premier annonce les RER A, B et D, quand le second, à certaines heures, ne
  diffuse que le A et le B — vérifié, 51 passages rendus un soir à 23 h, aucun
  pour le D, alors qu'à la même minute Gare de Lyon en rendait treize. La ligne
  sans horaire apparaît donc en retrait, « aucun passage annoncé », suivie d'un
  mot d'explication : service terminé, ou horaires non diffusés à cet arrêt.
  Sans cela, la ligne disparaissait de la fiche sans un mot et l'on croyait à un
  défaut de l'application.

  Deux sources, appelées directement depuis le navigateur — les deux autorisent
  l'origine croisée, il n'y a pas de proxy à héberger : **PRIM** au format SIRI
  Lite pour le temps réel (clé dans l'en-tête `apiKey`, API « Prochains
  passages — requête unitaire »), et le **référentiel ouvert** d'Île-de-France
  Mobilités, sans clé, pour les lignes et les arrêts.

  **La granularité interrogée dépend du mode**, et c'est essentiel : un poteau
  de bus se désigne par son *point* d'arrêt, une gare par sa *zone* d'arrêt.
  Deux poteaux du même nom appartiennent à une même zone sans y voir passer les
  mêmes lignes — à l'Hôtel de Ville, l'un dessert les 67, 72, 76, 96, N11 et
  N16, l'autre le seul 69 — si bien qu'interroger la zone rendait les cinq
  lignes mélangées sur les deux points. Une gare, à l'inverse, n'a de sens
  qu'au niveau de la zone, seule à réunir les deux sens de circulation. Les
  pastilles de la carte suivent la même règle : celles d'un poteau sont celles
  du poteau, pas de son voisin d'en face.

  Le rattachement d'un lieu de la carte à l'identifiant régional **ne passe pas
  par le tag `ref:FR:STIF`** : vérification faite sur le terrain, ce tag porte
  un identifiant de *point* d'arrêt — un quai — et non de *zone* d'arrêt, et il
  est parfois absent ou périmé (à la gare du Musée d'Orsay, il ne rend aucun
  passage). Le lieu est donc résolu contre le référentiel officiel des arrêts,
  par proximité et par nom : on interroge les arrêts situés à moins de 200 m,
  on les départage sur le nom, le mode et la distance, et on retient leur
  **zone d'arrêt** — seule à réunir les deux sens de circulation. Une seconde
  zone est ajoutée si elle porte le même nom dans un autre mode : à
  Denfert-Rochereau, la station de métro et la gare du RER sont deux zones
  distinctes, et n'en montrer qu'une cacherait la moitié des passages.

  Le quota PRIM étant de 1 000 appels par jour, il n'y a **pas de
  rafraîchissement automatique** ; chaque réponse est gardée 30 secondes, et la
  résolution d'un arrêt comme le référentiel des lignes sont mis en cache
  durablement dans `localStorage`.
- **Chercher une enseigne** : taper « Burger King », « BUT » ou « Caisse
  d'Épargne » propose, en tête des résultats, d'**afficher tous ces lieux sur
  la carte**. La saisie est reconnue au vol : « burgerk » propose « Burger
  King », « macdo » propose « McDonald's ».

  **La proposition n'apparaît que si les données confirment une enseigne**,
  sans liste tenue à la main : soit un nom qui revient plusieurs fois parmi les
  lieux déjà croisés sur la carte, soit plusieurs résultats de recherche
  portant le même nom **et** appartenant à une catégorie de commerce. Une rue
  n'appartient à aucune catégorie : chercher « rue du Bac » ou « boulevard
  Voltaire » ne propose donc plus d'« afficher tous les… », là où la version
  précédente proposait la saisie brute quelle qu'elle soit. Choisir un lieu
  dans les résultats quitte la sélection en cours : la carte revient à ses
  catégories.

  La recherche passe par **Overpass, en une seule requête** couvrant l'emprise
  visible : elle ne dépend donc pas des tuiles chargées et rend autant de lieux
  sur une carte très dézoomée que sur un quartier. C'est la deuxième version de
  ce mécanisme, et la raison du changement mérite d'être notée. Le géocodeur,
  employé d'abord pour sa vitesse, plafonne ses réponses à cinquante entrées
  quel que soit le paramètre demandé : couvrir une grande zone imposait de la
  redécouper en quadrants, jusqu'à quarante requêtes pour une seule recherche.
  Un service public gratuit ne le supporte pas — il finissait par tout refuser,
  y compris l'autocomplétion de la barre de recherche, qui en dépend aussi.
  Overpass, lui, est fait pour l'extraction en masse, son quota est distinct de
  celui du géocodeur, et ses instances sont déjà interrogées en parallèle avec
  reprise sur échec (voir « Résistance aux pannes »). En contrepartie il est
  plus lent — quelques secondes — d'où le bandeau qui tourne et annonce
  « recherche de tous les lieux… ». Au-delà de 400 résultats, il écrit
  « ou plus » ; un service injoignable s'affiche comme tel, jamais comme une
  absence de magasins. Le bouton **« Rechercher dans cette zone »** n'apparaît
  qu'une fois la carte déplacée : une liste qui se refait à chaque geste
  sauterait sans qu'on l'ait demandé.
  La correspondance se fait **mot pour mot**, mot entier contre mot entier :
  « BUT » reconnaît « But » et « BUT Cuisines », mais ni « Buttes-Chaumont », ni
  « Rambuteau », ni « SH Distribution » — la recherche par expression régulière
  les attrape, le filtrage final les écarte.

  Pendant la recherche, les catégories cochées s'effacent — la carte n'obéit
  plus qu'à l'enseigne — et **reprennent la main à la fermeture du bandeau** :
  la sélection n'est jamais modifiée, seulement mise de côté. Les résultats
  s'affichent **en rouge**, un point par emplacement, et le décombrement des
  pastilles est suspendu : utile pour les commerces du quotidien, il en
  escamotait la moitié en vue large et donnait l'impression qu'ils étaient
  regroupés. Le pictogramme de la catégorie est conservé — un fast-food reste
  reconnaissable — seule la couleur change.
- **Partager un lieu** : le bouton ouvre un menu à deux entrées — passer la
  main aux applications du téléphone (`navigator.share` : messagerie, e-mail…),
  ou **copier les coordonnées GPS** (`48.856600, 2.352200`), la forme que
  reprennent les applications de carte. Le partage système n'apparaît que là où
  il existe vraiment, c'est-à-dire essentiellement sur mobile : proposer une
  action inerte sur un navigateur de bureau vaudrait moins que ne rien
  proposer. Le partage joint un lien `openstreetmap.org` vers le point — un
  `geo:` serait plus direct mais reste inerte dans la plupart des messageries.
  Le bouton est présent sur **toute** fiche, y compris celle qui s'ouvre en
  cliquant n'importe où sur la carte — ce clic garde d'ailleurs les coordonnées
  cliquées et non le centroïde de l'adresse trouvée à proximité, pour que ce
  soit bien ce point-là qui soit partagé. `navigator.clipboard` n'existant qu'en
  contexte sécurisé (HTTPS ou localhost), un repli par champ hors écran assure
  la copie quand l'app est servie en HTTP sur le réseau local.
- **Résistance aux pannes des sources de détails** : `config.ts` liste plusieurs
  instances Overpass et l'API OpenStreetMap. Elles ne sont pas essayées en série
  — une instance saturée mettrait une minute à l'avouer — mais **ajoutées une à
  une** : la suivante démarre si les précédentes n'ont rien rendu au bout de
  `OVERPASS_HEDGE_MS`, et la première réponse gagne. L'API OSM vient en seconde
  position plutôt qu'en fin de liste : les instances publiques limitent le débit
  par adresse IP, et attendre qu'elles échouent toutes coûtait cinq secondes sur
  la fiche. Mesuré instances Overpass limitées : **90 à 185 ms** pour les
  informations d'un commerce. Un échec de toutes les sources laisse simplement
  la fiche sans horaires, jamais la carte sans commerces.
- **Pastilles de POI maison** : les pictogrammes du fond de carte sont masqués
  (couches issues de la source vectorielle `poi`) et remplacés par un marqueur
  par catégorie — disque de la couleur du groupe, cerclé de blanc, portant le
  pictogramme de la catégorie, avec le nom du lieu à partir du zoom 16. Le
  dessin est produit sur canvas (`src/utils/markerImage.ts`) à partir du champ
  `icon` de `src/filters.ts`, celui-là même que le menu de filtres affiche :
  puce du menu et pastille de la carte ne peuvent donc pas diverger.
- **Filtres par catégorie** (bouton en bas à droite, juste au-dessus de celui
  des calques), seize en tout :
  supérettes & alimentation, boulangeries & pâtisseries, fast-foods,
  restaurants & cafés, bars & vie nocturne, santé, beauté & bien-être, mode &
  accessoires, maison & bricolage, culture & musées, parcs & nature, sport &
  forme, hôtels & hébergement, transports, stationnement, et « autres commerces
  & services ».
  On coche autant de catégories que voulu, et un unique curseur bascule entre
  **tout** et **aucun** (il affiche le décompte quand la sélection est
  partielle). Chaque catégorie a sa couleur, reprise par les pastilles sur la
  carte ; la sélection est mémorisée dans `localStorage`.

  Le découpage cherche à ce qu'une catégorie dise quelque chose : un
  fourre-tout « commerces » qui rassemble la boutique de mode, le coiffeur, le
  quincaillier et l'hôtel ne permet pas de filtrer grand-chose. Mesuré sur une
  tuile parisienne dense, le fourre-tout est passé de 3 317 lieux à 976 — le
  reste s'est réparti dans mode & accessoires (1 545), culture & musées (961),
  beauté (563), bars (404), hôtels (270, qui n'étaient tout simplement pas
  affichés jusque-là), maison & bricolage (233) et boulangeries (195).
  L'ordre du tableau `FILTER_GROUPS` porte cette logique : les catégories
  précises passent avant les génériques, puisque le premier groupe qui
  reconnaît un lieu l'emporte. « Autres commerces & services » vient donc en
  dernier, et porte une couleur grise plutôt qu'une teinte propre : il ne
  décrit plus un type de commerce, mais ce que les autres n'ont pas réclamé.

  Pour ajouter ou retoucher une catégorie, il suffit d'éditer
  `src/filters.ts` : les tags OSM, les classes de tuiles, la couleur, le
  libellé et le pictogramme y sont déclarés au même endroit.
- **Horaires d'ouverture** : lecture de la balise OSM `opening_hours`,
  affichage "Ouvert · ferme à 19:00" / "Fermé · ouvre à 09:00" dans la fiche
  lieu. Le parseur (`src/utils/openingHours.ts`) couvre les syntaxes
  courantes ; les cas très complexes (jours fériés, vacances...) affichent
  simplement "horaires non disponibles" plutôt qu'une info fausse.
- **Boussole**, sous l'encart météo : l'aiguille tourne avec la carte et dit où
  est le nord ; un clic y ramène la carte (le cap seulement — en 3D,
  l'inclinaison est conservée). Elle reste visible carte au nord, simplement
  estompée, et s'efface pendant un itinéraire, où le panneau occupe le haut de
  l'écran.
- **Itinéraires** voiture ou à pied avec distance, durée et tracé sur la
  carte. Chaque mode a son propre profil OSRM : l'itinéraire à pied emprunte
  chemins et trottoirs, ignore autoroutes et voies rapides, et donne un temps
  réaliste (~4,5 km/h) — distinct du temps voiture. Le **point de départ** est
  modifiable : « Ma position » (défaut) ou une adresse recherchée. La carte se
  cadre automatiquement sur le trajet (marqueur vert = départ, rouge = arrivée).
- **Un parcours réordonnable de bout en bout.** Départ, étapes et arrivée
  forment une seule liste : **chaque** point se modifie d'un clic sur son nom,
  se retire, et se **déplace dans l'ordre** par les flèches — descendre le
  départ fait de la première étape le nouveau point de départ, et « Ma
  position » peut aussi bien être l'arrivée que le départ. L'ordre du parcours
  est celui de la liste, aucun moteur ne le réarrange.

  Le parcours accepte jusqu'à **quinze étapes** intermédiaires, ajoutées par
  « Ajouter une étape » et repérées sur la carte par des marqueurs bleus
  numérotés. Au-delà de quatre, la liste des étapes défile sur place — le
  départ et l'arrivée, eux, restent visibles.

  **Désigner un point sur la carte** : dès qu'un champ attend une adresse, la
  carte est armée (le curseur passe au viseur) et l'endroit qu'on y touche
  devient la réponse — nommé par l'adresse la plus proche, mais aux
  coordonnées exactes du clic. Cliquer un commerce le choisit lui plutôt que
  l'adresse du trottoir. C'est la voie la plus courte pour un lieu qui n'a pas
  de nom cherchable : un coin de parking, une entrée de service, un point de
  rendez-vous convenu.

  En voiture et à pied, le tout est calculé par OSRM en un seul appel. En
  transports en commun, Navitia ne sachant pas router par points de passage,
  chaque tronçon est calculé séparément et enchaîné au plus tôt : le parcours
  proposé est alors **unique** (et non un choix de trois), et le détail y
  intercale une ligne « Étape : … » à chaque arrêt demandé. Chaque étape coûtant
  un appel sur le quota quotidien, c'est ce qui fixe le plafond de quinze.
- **Itinéraires en transports en commun** (troisième bouton de mode ; clé
  Île-de-France Mobilités requise, la même que les prochains passages). Ils ne
  sont pas calculés sur la voirie mais sur les **horaires** : le moteur Navitia
  exposé par PRIM enchaîne des passages effectivement programmés depuis
  l'heure du calcul, en tenant compte du temps d'attente aux correspondances et
  du temps réel du jour quand la ligne le diffuse.

  Jusqu'à trois trajets sont proposés, du plus tôt arrivé au plus tard : durée,
  heure de départ et d'arrivée, nombre de correspondances, marche cumulée, et
  la suite des lignes empruntées sous forme de pastilles aux couleurs
  officielles. Le trajet retenu se dessine sur la carte **étape par étape** —
  chaque tronçon à la couleur de sa ligne, les portions à pied en pointillés
  ronds.

  Le trajet retenu **déplie son détail** sous le résumé, en frise verticale :
  l'heure de chaque étape, la station où **monter** et celle où **descendre**,
  la ligne et sa direction, le nombre d'arrêts et les durées de marche. Le
  trait de liaison reprend la couleur de la ligne qu'on suit et se pointille
  pendant la marche, comme sur la carte.

  Sous chaque montée, **« Départs suivants »** déplie les passages d'après de
  la même ligne, au même quai — la réponse à « et si je rate celui-là ? ». Ils
  sont demandés au dépli seulement : c'est un appel de plus sur le quota
  partagé avec les prochains passages.

  Deux limites, assumées : la couverture s'arrête à l'**Île-de-France** (hors
  région, la liste est vide et le dit), et le calcul ne se rafraîchit pas tout
  seul — le quota de la clé est de 1 000 appels par jour, tout confondu, d'où
  la mise en cache d'une minute par couple départ/arrivée.
- **Encart météo** en haut à droite : pictogramme en couleur et température,
  plus une **pastille de vigilance** quand un phénomène est en cours — à la
  couleur officielle du niveau (jaune, orange, rouge), pour qu'une alerte se
  remarque sans rien ouvrir.
  Déplié, il ajoute ce qu'on ne lit pas par la fenêtre — **qualité de l'air**
  (indice européen EAQI, avec ses couleurs officielles), **pollens** (six espèces, niveau indicatif par espèce) et, **s'il
  y en a**, le détail des **vigilances** en cours (Météo-France, par
  département) : phénomène et niveau. Sans vigilance, la section n'apparaît pas
  du tout. Air et pollens ne sont demandés qu'au dépli ; les vigilances, elles,
  sont cherchées d'emblée — c'est ce qui permet à la pastille de prévenir.

  Le lieu observé suit ce qu'on regarde : la **position** de l'utilisateur par
  défaut, ou le **lieu cherché** dès qu'une fiche est ouverte — à Paris, ouvrir
  une rue de Lille donne la météo de Lille, refermer la fiche rend celle de
  Paris. Pendant un itinéraire, l'encart s'efface. À défaut de position (la
  géolocalisation n'est demandée qu'au bouton), le centre par défaut sert de
  repli, et l'encart déplié nomme toujours l'endroit dont il parle.
- **Lieux enregistrés**, rangés par **dossiers**. Chaque fiche porte un bouton
  **Enregistrer**, placé avant *Partager* — on range un lieu bien plus souvent
  qu'on ne l'envoie. Il ouvre une fenêtre où l'on choisit un **nom** (celui du
  lieu par défaut, on peut valider sans rien écrire) et un **dossier**, qui
  peut se créer sans quitter la fenêtre. Réappuyer sur ce bouton retire
  l'enregistrement ; le bouton porte alors la couleur du dossier où le lieu est
  rangé. Tout lieu peut être enregistré, y compris un point posé au milieu de
  nulle part.

  Le bouton **signet** (colonne de droite, au-dessus des catégories) ouvre la
  liste. Chaque dossier s'y **allume** — ses points apparaissent alors sur la
  carte, à sa couleur, rouge par défaut — et se **déplie** pour retrouver un
  lieu par son nom : ce sont deux gestes distincts, on consulte souvent une
  liste sans vouloir couvrir la carte. Un dossier se **renomme** et change de
  **couleur** (palette iOS). Il se **supprime** aussi, mais après confirmation
  — la demande rappelle son nom et le nombre de lieux qui partiraient avec lui.
  Seul **« Favoris » ne se supprime pas** : il reste le point de chute de tout
  enregistrement, et la fenêtre d'enregistrement suppose au moins un dossier.
  Le tout est persisté dans `localStorage`, dossiers allumés compris.
- **Installable et rapide au retour** : un **Service Worker** précharge le
  noyau de l'application (360 Ko compressés) et le sert depuis le cache aux
  visites suivantes. Les **tuiles déjà vues** sont gardées elles aussi — fond
  vectoriel une semaine, imagerie satellite un mois, couverture Mapillary une
  semaine — ce qui rend un quartier déjà parcouru presque instantané, et
  lisible même hors ligne.

  Ce qui n'est **pas** mis en cache mérite d'être dit : horaires de transport,
  météo, qualité de l'air, vigilances, itinéraires et résultats de recherche
  passent par le réseau à chaque fois. Servir un passage de RER périmé serait
  pire que ne rien afficher, et l'application tient déjà ses propres caches,
  avec des durées choisies service par service. Le visualiseur Mapillary
  (1 Mo) n'est pas préchargé non plus : il n'est gardé que s'il a servi.

  Le manifeste rend l'application **installable** sur un écran d'accueil, sous
  son icône, en plein écran. Un Service Worker exige un site servi en
  **HTTPS** (ou `localhost`) : sur un serveur domestique en HTTP simple, le
  cache ne s'activera pas — la géolocalisation non plus, d'ailleurs.
- **Géolocalisation** (API navigateur), point bleu pulsé façon iOS.
- **Mode sombre** : choix du thème dans les **Paramètres** — le burger en haut
  à gauche découvre l'entrée « Paramètres », qui ouvre une fenêtre au centre de
  l'écran, posée sur un voile — à trois positions : Automatique, Clair, Sombre.
  « Automatique » n'est pas un troisième thème mais l'absence de choix : sur
  téléphone, l'application suit la **lumière ambiante** mesurée par le capteur
  de luminosité — sombre la nuit, clair au jour, sombre dans un tunnel puis clair
  à la sortie, après deux secondes de confirmation pour ne pas clignoter à
  l'ombre d'un pont. Sans capteur (navigateur), elle suit le thème de l'appareil.
  Choisir Clair ou Sombre mémorise la décision dans `localStorage` ; revenir à
  Automatique l'efface. L'interface **et le fond de carte** changent : le style
  sombre (`src/styles/appleDark.ts`) est dérivé du style clair OpenFreeMap
  `liberty` et recoloré façon **Apple Plans** (fond charcoal, eau bleu nuit,
  autoroutes ambrées, parcs vert sombre). Il réutilise les **mêmes tuiles
  vectorielles** — aucun service supplémentaire à héberger. Pour retoucher la
  palette, éditer la constante `C` dans `scripts/build-apple-dark-style.mjs`
  puis `npm run build:dark-style`.
- **Vue satellite** : plan / satellite depuis le menu d'affichage
  (bouton « calques », en bas à droite). Le choix est mémorisé dans
  `localStorage`.

  L'imagerie est **empilée** : le fond mondial **Esri World Imagery**
  (gratuit, sans clé), puis l'**orthophotographie de l'IGN** (BD ORTHO, 20 cm,
  servie sans clé par la Géoplateforme) par-dessus, là où elle existe, puis un
  calque de routes et de toponymes Esri pour la vue hybride.

  Le gain est réel et il est au zoom 19, là où la vue satellite sert vraiment :
  comparé sur l'Opéra et le Vieux-Port, Esri rend une image sombre où les cours
  intérieures disparaissent dans l'ombre, l'IGN une image nette où voitures,
  piétons et étals du marché se comptent. Au zoom 18 l'écart est plus mince, et
  Esri a même des verts plus francs — l'IGN est plus froid. **Ce qui n'a pas été
  mesuré, c'est la fraîcheur** : la BD ORTHO est renouvelée par campagnes
  départementales, Esri panache des prises de vue récentes ; selon l'endroit,
  l'un ou l'autre peut être le plus à jour.

  Aucune logique géographique ne départage les deux sources : celles de l'IGN
  portent leurs emprises (`SATELLITE_IGN_AREAS` — métropole, Antilles-Guyane,
  océan Indien), MapLibre ne leur demande donc rien ailleurs et l'imagerie Esri
  reste visible dessous. Ajouter un territoire (Nouvelle-Calédonie,
  Polynésie…) tient en une ligne de ce tableau.

  Tout est dans `config.ts` (`SATELLITE_*`). Les deux sources autorisent
  l'origine croisée et plafonnent au **zoom 19** (mesuré : 404 au-delà, à
  Paris, Lyon et Marseille) — côté IGN ce n'est pas arbitraire, 20 cm par pixel
  est précisément la résolution du zoom 19 sous nos latitudes. MapLibre étire
  ces tuiles ensuite.
- **Cartes hors ligne** : menu burger → **Téléchargement**. Une carte réduite
  s'ouvre avec un **carré de sélection** que l'on déplace et redimensionne par
  ses coins ; le poids estimé s'affiche pendant qu'on ajuste, et il est
  **calibré sur de vraies tuiles de la zone** — quatre échantillons donnent un
  facteur de densité, parce qu'une tuile de zoom 14 pèse 568 ko dans Paris et
  84 ko en Seine-et-Marne (mesuré).

  L'imagerie satellite est une case à part, décochée par défaut, avec un zoom maximal
  réglable — à titre d'ordre de grandeur, Paris intra-muros pèse une
  soixantaine de mégaoctets en carte et **1,1 Go** en satellite jusqu'au
  zoom 19.

  Les cartes sont enregistrées **sur l'appareil**, dans un système de fichiers
  propre à l'application (OPFS), et non dans le cache du navigateur ; elles ne
  sont jamais envoyées nulle part, chaque appareil a donc ses propres zones. Le
  navigateur ne permet pas d'en choisir l'emplacement, et « effacer les données
  du site » les supprime — seule une version installée (APK, phase 3) pourra
  écrire hors du navigateur, et l'interface `BlobStore` est le point prévu pour
  ça.

  Le téléchargement est **reprenable** : les tuiles déjà là sont sautées, on
  peut fermer l'application et reprendre. Chaque zone se supprime, avec ses
  tuiles — mais seulement celles qu'aucune autre zone ne réclame. Un bouton
  **Vérifier les mises à jour** compare le numéro de version des tuiles amont,
  ce qui ne coûte que quelques kilo-octets ; la même vérification se fait seule
  **chaque semaine**, fenêtre fermée comme ouverte, tant que l'application
  tourne — sans réseau, elle réessaie dès que la connexion revient. La fenêtre
  affiche la date de la dernière vérification, et les zones périmées se mettent
  à jour toutes seules (un bouton *Mettre à jour* reste là).

  Deux paliers : *Carte seule* (fond navigable) ou *Carte + commerces*
  (horaires, téléphone, adresse, et la recherche hors ligne).

  La zone se choisit **d'un toucher, comme dans Organic Maps** : dézoomé on
  touche un pays, en zoomant une région, puis un département. La zone touchée
  se surligne avec son contour (fourni par Nominatim, le géocodeur
  d'OpenStreetMap), et c'est **ce contour exact** qui est téléchargé — la
  Bretagne sans la Manche ni la Normandie autour. Les zones déjà présentes sur
  l'appareil apparaissent en vert. Le niveau de détail suit ce qu'on a touché :
  un pays s'arrête au zoom 11 (la France pèse 2,4 Go au zoom 12 et **51,6 Go au
  zoom 14**), une région au 13, un département au détail maximal.

  Une section **Comportement** règle le reste : téléchargement en wifi
  uniquement (dans la mesure où le navigateur sait le dire — le panneau
  l'annonce franchement), et suspendre et reprendre avec la connexion. Le lieu de stockage, lui, n'est pas choisissable : aucune
  application web ne peut en décider.

  Une case **Adresses** ajoute la recherche par numéro de rue, à partir de la
  **Base Adresse Nationale servie par la Géoplateforme de l'IGN**. Elle est
  demandée par emprise, et le panneau annonce un compte **exact** avant de
  lancer — le comptage ne coûte qu'une requête. Mesuré : Le Marais, 3 540
  adresses pour 913 ko ; Paris intra-muros, 242 153 adresses pour 62 Mo. Hors
  de France le compte tombe à zéro et le panneau le dit.

  Hors ligne, la carte, les fiches et la recherche — commerces comme adresses —
  fonctionnent dans les zones téléchargées. **Ne fonctionnent pas** hors ligne,
  et ne le peuvent pas : les itinéraires (OSRM et Navitia sont distants), les
  prochains passages et la météo, qui sont du temps réel.

- **Relief** : troisième bascule du menu d'affichage. À plat, le terrain est
  ombré et porte ses **courbes de niveau** — resserrées là où la pente est
  raide, espacées sur les replats, avec les altitudes ; en vue 3D, il sort de
  l'écran. C'est un calque et non un fond : il
  s'ajoute aussi bien au plan qu'à l'imagerie satellite. Les altitudes viennent des tuiles
  « terrarium » d'AWS, gratuites, sans clé et mondiales ; les courbes de niveau
  de la Géoplateforme de l'IGN, et ne couvrent donc que la France. Le panneau de
  téléchargement le propose sous la même forme que l'imagerie satellite — une
  case à cocher et un curseur de zoom, avec le poids affiché en direct. Compté
  au zoom 10 : 1 Mo pour Paris intra-muros, 20 Mo pour la Suisse, 258 Mo pour la
  France ; chaque cran de plus quadruple ces chiffres.

- **Photos de rue (Mapillary)** : troisième option du menu d'affichage, à côté
  du satellite et de la 3D. Allumée, la carte trace en vert les **rues
  photographiées** (les séquences) et, à partir du zoom 15, les **points de
  prise de vue**. Cliquer l'un d'eux ouvre la **photo** en bas à gauche, avec sa
  date et un lien vers Mapillary.

  La vue est celle de **`mapillary-js`**, le visualiseur officiel : on **fait
  pivoter la caméra** à la souris, on **avance et recule** le long de la rue par
  les flèches posées au sol, on **tourne aux intersections**, et les panoramas
  se déroulent — exactement les gestes du site de Mapillary.

  La carte **montre où l'on se tient** : un point vert marque la prise de vue
  affichée, prolongé d'un cône qui indique la direction du regard et **pivote
  avec la caméra**. La carte se recentre à chaque changement de photo, mais pas
  quand on tourne simplement la tête. Un bouton **plein écran** donne la vue en
  grand : toute l'interface flottante s'efface alors — menus, boutons, barre de
  recherche, encart météo. Échap réduit, puis ferme, et décocher « Photos de
  rue » dans le menu d'affichage referme la vue avec la couverture.

  Le visualiseur pèse 2,5 Mo, d'où un **chargement à la demande** : Vite en fait
  un fragment séparé (272 Ko compressés), importé à l'ouverture de la première
  photo et jamais au démarrage de la carte. Qui n'ouvre pas de photo de rue ne
  le télécharge pas.

  La couverture vient des tuiles vectorielles de Mapillary ; la photo, elle,
  est demandée à l'API Graph **au clic seulement**. Les sources ne sont ajoutées
  que lorsque l'option est allumée, et retirées sinon : une couverture invisible
  n'a pas à consommer de données. Le découpage en deux sources n'est pas
  cosmétique — mesuré sur Paris, une tuile **z14 pèse 1,5 Mo** (elle porte près
  de 40 000 points de prise de vue) contre **112 Ko en z13**, qui n'a que les
  séquences : celles-ci s'arrêtent donc à z13, et les points ne sont demandés
  qu'à hauteur de rue. Un **jeton gratuit** est nécessaire (voir
  `.env.example`) ; sans lui, l'option reste visible dans le menu et dit ce qui
  lui manque.
- **Vue 3D** : même menu que le fond de carte. La caméra s'incline à 60° et
  les bâtiments se dressent en volume à partir du zoom 14 — ils viennent des
  mêmes tuiles vectorielles (couche `building` du schéma OpenMapTiles, déjà
  extrudée par le style Liberty), donc aucun service supplémentaire. En vue
  satellite, l'imagerie raster n'a pas de bâtiments à dresser : la 3D n'y
  apporte que la perspective. **Hors 3D, la carte est réellement plate** : la
  couche d'extrusion est éteinte et le remplissage plat des bâtiments, que le
  style arrête au zoom 14 puisque l'extrusion prend le relais, est prolongé
  jusqu'au zoom maximal. Sans cela les immeubles restaient en volume même
  caméra à la verticale — la projection étant perspective, les hauts bâtiments
  penchent dès qu'ils s'éloignent du centre de l'écran. Éteindre la couche
  plutôt que d'annuler les hauteurs évite en prime de calculer des murs et des
  toits invisibles pour chaque tuile. Le réglage est appliqué dès le chargement
  du style et non à celui de la carte : autrement les bâtiments s'affichaient
  une fraction de seconde en relief, le temps que les premières tuiles soient
  peintes. L'inclinaison est de plus **verrouillée**
  (`maxPitch: 0`) pour que le geste d'inclinaison ne mette pas la carte en
  relief alors que le menu annonce le contraire. Le choix est mémorisé dans
  `localStorage`. À savoir : une caméra inclinée élargit l'emprise visible,
  donc la bbox envoyée à Overpass — c'est pourquoi la 3D est désactivée par
  défaut et plafonnée à 60°.

## Passer en hors-ligne (Phase 2)

La V1 est volontairement construite pour que ce passage ne demande **pas**
de réécriture, juste de remplacer des sources de données. Pistes, dans
l'ordre de priorité recommandé :

1. **Fond de carte** — générer un extrait [Geofabrik](https://download.geofabrik.de/)
   du pays visé, le convertir en tuiles vectorielles avec
   [Planetiler](https://github.com/onthegomap/planetiler) au format
   [PMTiles](https://protomaps.com/) (un seul fichier). PMTiles se lit
   directement en local (via `pmtiles` + le protocole `pmtiles://` de
   MapLibre), sans serveur — idéal pour être embarqué tel quel dans l'APK.
2. **Itinéraires** — lancer [OSRM](https://github.com/Project-OSRM/osrm-backend)
   en local via Docker avec le même extrait pays, **une instance par profil**
   (`car.lua`, `foot.lua`) — `osrm-extract` + `osrm-contract`, puis `osrm-routed`
   sur deux ports. Il suffit ensuite de changer les URLs dans `OSRM_ROUTING`
   (`config.ts`). Les **transports en commun** demandent autre chose : un
   moteur d'horaires. [Navitia](https://github.com/hove-io/navitia) s'héberge
   (il lit un GTFS, celui d'IDFM est en accès ouvert) et garde alors la même
   API — seule `IDFM_NAVITIA_URL` change ; [MOTIS](https://github.com/motis-project/motis)
   ou [OpenTripPlanner](https://www.opentripplanner.org/) sont plus légers,
   au prix d'une réécriture de `services/transit.ts`. Le **temps réel** (SIRI),
   lui, restera toujours en ligne : par nature, il ne s'embarque pas.
3. **Recherche** — auto-héberger [Photon](https://github.com/komoot/photon)
   (index Lucene généré depuis le même extrait), ou pré-extraire les lieux du
   `.osm.pbf` (via `osmium`/`osmconvert`) vers une base SQLite embarquée.
   Les **commerces affichés**, eux, n'ont plus rien à héberger : ils voyagent
   dans les tuiles du point 1 — Planetiler produit la couche `poi` du schéma
   OpenMapTiles, identifiants OSM compris. Restent les **horaires**, qui
   viennent aujourd'hui d'Overpass : les embarquer demande de les extraire du
   `.osm.pbf` vers la même base SQLite, en les indexant par identifiant OSM
   (`type/id`), exactement la clé que `services/tilePois.ts` tire déjà des
   tuiles.
4. **App shell** — ✅ **fait** : un Service Worker (`vite-plugin-pwa`) précharge
   le code de l'application et garde les tuiles déjà vues (voir plus bas).

## Vers l'APK (Phase 3)

[Capacitor](https://capacitorjs.com/) est recommandé : il enveloppe ce
projet web tel quel (`npx cap init`, `npx cap add android`) et donne accès
aux API natives Android (GPS, stockage de fichiers pour les PMTiles/SQLite
embarqués, notifications...). Le hook `useGeolocation.ts` est déjà isolé
pour être remplacé par `@capacitor/geolocation` sans toucher au reste du
code — même interface (`position`, `loading`, `error`, `locate()`).

## Personnaliser la zone géographique

`src/config.ts` :

```ts
DEFAULT_CENTER: { lon: 2.3522, lat: 48.8566 }, // centre initial de la carte
COUNTRY_NAME: "France",
COUNTRY_BBOX: [-5.317, 41.2, 9.66, 51.34],      // pour le futur extrait OSM
```

## Attribution des données

Les données proviennent d'OpenStreetMap (licence
[ODbL](https://www.openstreetmap.org/copyright)) : l'attribution "©
OpenFreeMap © OpenMapTiles © OpenStreetMap contributors", affichée en bas de
carte par MapLibre, doit être conservée — y compris dans la future version
hors-ligne/APK.
