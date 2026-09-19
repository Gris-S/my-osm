# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commandes

```bash
npm run dev                # Vite, http://localhost:5173 — aucune clé API requise
npm run build              # tsc -b puis vite build (le typage bloque le build)
npm run preview            # sert dist/
npm run lint               # oxlint (pas ESLint)
npm test                   # vitest : calculs de navigation, trafic, hors-ligne (tests/)
npm run build:dark-style   # régénère src/styles/appleDark.ts (voir plus bas)
npm run build:icons        # régénère les icônes de public/
npm run build:car-data     # régénère les péages et les radars (voir plus bas)
```

**Tests** : `npm test` (vitest, `tests/`, configuration `vitest.config.ts`). Ils
portent sur les **calculs purs** qui ont déjà cassé : projection sur le tracé,
avancement, contresens (`car/heading.ts`), lecture du trafic, contour des zones
en tuiles, clés et chemins du hors-ligne (le bug des polices) — et, depuis
l'audit du 15 septembre 2026, le stockage de l'appareil (adresse locale d'un
fichier, dossiers à garder, stockage plein), l'anti-clignotement du compteur
de vitesse, l'attente entre deux recalculs ratés, la date de l'historique en
français et en anglais, la queue du journal et l'horloge des transports. Ils tournent dans
Node, sans navigateur — `tests/setup.ts` fournit le minimum que la langue et
les réglages lisent au chargement. Une règle qui mérite un test gagne à être
sortie d'un hook en fonction pure, comme le contresens.

**Ces tests ne disent rien de ce que l'application fait**, et il faut le garder
en tête : ils portent sur des calculs, jamais sur un écran. L'écart entre la
durée annoncée par le panneau d'itinéraire et celle de l'écran de choix a vécu
des mois sans être vu alors que les 132 tests passaient — les deux nombres
étaient justes, chacun de son côté. Ce qui manquait était de les regarder
**ensemble**.

D'où **`outils/parcours.sh`** : un parcours qui pilote l'application sur un
téléphone branché, par le débogage de la WebView, et qui **affirme** au lieu de
capturer en espérant qu'on regarde. Un scénario = des gestes (clic sur un
sélecteur, saisie, position simulée, mode avion) et des vérifications ; en
sortie, un rapport et une capture par étape dans `parcours/` (hors du dépôt).

- `outils/parcours.sh` tout, `outils/parcours.sh coherence` un scénario,
  `--liste` pour les connaître.
- **L'APK doit être débogable** : la release ne l'est pas. Pour essayer la
  configuration de F-Droid — sans aucune clé — passer par
  `cd apk && npm run apk:nokeys`.
- **Le scénario `chevauchements` mesure les recouvrements** des éléments
  flottants (enfants positionnés de `.app-shell`) dans les états chargés :
  carte, fiche d'une grande gare, panneau des transports, guidage, bandeau le
  plus haut, fiche ouverte pendant un guidage. Ajouté le 19 septembre 2026
  après trois recouvrements que personne n'avait vus : calques et position
  sous la fiche de Gare de Lyon (la réserve de `.sheet` datait de deux
  boutons, elle en compte quatre : 332 px), les mêmes posés sur le panneau
  des transports (retirés quand il est ouvert), et la colonne de droite
  remontée sur le bandeau quand une fiche s'ouvre en guidage (masquée tant
  que la fiche est là, comme la colonne du bas). Le message d'état de la carte
  suit la même hauteur que les boutons : il passait sous la fiche.
- Le parcours **rend l'appareil à son état** en terminant : réglages, mode
  avion, position simulée effacée par le rechargement. Tout nouveau scénario
  doit respecter cette règle. Depuis le 19 septembre 2026, il relève au départ
  **tout le `localStorage`** et les trajets de l'historique, puis rend le premier
  tel quel et efface les trajets qu'il a créés : il remettait auparavant des
  valeurs par défaut, et laissait dans l'historique des « 0 min · 12 km » que
  l'utilisateur a pris pour de vrais trajets. Le relevé est aussi écrit dans
  `parcours/…/etat-initial.json` — hors du dépôt : il contient les adresses
  Maison et Travail.
- Le scénario `coherence` garde précisément le défaut d'origine : il compare la
  durée du panneau à celle de la bulle et échoue si elles s'écartent de plus
  d'une minute. **Un défaut trouvé sur l'appareil gagne son scénario**, comme un
  calcul qui casse gagne son test.
- **`scene()` marque la fenêtre d'accueil comme vue** (`osm-local:first-run-seen`).
  Sans cela, elle se poserait sur l'interface après chaque rechargement — donc
  au début de chaque scénario — et son voile avalerait tous les clics : les
  vingt-trois échoueraient d'un coup, pour une fenêtre qui fonctionne
  parfaitement. Seul `premier-lancement` efface ce drapeau, exprès.
- **Vingt-trois scénarios** au 16 septembre 2026 : après le chemin principal
  (démarrage, recherche, itinéraire, cohérence, hors-ligne, réglages, zones
  tactiles, navigation, sans-clés), tout ce qui se règle ou s'affiche à côté —
  météo, départs de transports, téléchargement hors ligne et sa reprise après
  un arrêt brutal, clés d'API, paramètres, signets, filtres, fond de carte,
  permission refusée, rotation, veille, recentrage d'ouverture. C'est là que
  vivent les défauts longtemps : **personne ne regarde deux fois un écran de
  réglages**.
- Deux défauts réels trouvés en écrivant cette deuxième vague, tous deux
  invisibles au code : le recentrage d'ouverture ne se produisait jamais (voir
  la section sur `useGeolocation`), et un refus de position ne s'affichait nulle
  part alors que le message existait, traduit, depuis toujours.

**Le parcours se trompe plus souvent que l'application, et il faut s'en
méfier.** Sept fois il a accusé à tort, presque toujours pour la même raison :
il interrogeait un écran avant que la donnée ne soit arrivée — résultats du
géocodeur, page en cours de rechargement, départs encore en « Looking up… »,
bouton de position dans les dix secondes que l'API s'autorise, quota de
stockage calculé en différé. **Avant de déclarer un défaut, vérifier qu'on a
attendu** ; `attendreQue` et `attendre` sont là pour ça, et un scénario qui
conclut après un `dodo` fixe est suspect par construction.

Le signe le plus sûr qu'on accuse à tort : **le détail imprimé à côté du `✗`
contredit le libellé**. « la place disponible est annoncée ✗ — 66 Mo used of
108,6 Go » dit exactement que tout allait bien, et que la condition avait été
lue trop tôt.

Deux autres pièges, du même genre :

- **Une assertion qui passe sans rien lire est pire qu'une absence
  d'assertion** : elle donne l'assurance. `.apikey-input` est une enveloppe, pas
  le champ — en lire le `type` rendait `""`, et « les clés sont masquées »
  passait au vert sans avoir rien vérifié. Toujours regarder le **détail**
  imprimé à côté d'un `✓`, pas seulement le `✓`.
- **Un scénario qui fait redémarrer l'application casse la redirection du
  port** : la socket de débogage porte le PID. `rediriger()` la repose à chaque
  tentative de `connecter()`, et le parcours se reconnecte au début de chaque
  scénario — sans quoi un changement de permission fait échouer tout ce qui
  suit, avec un « fetch failed » qui ressemble à une panne de l'application.
- **Voir une manœuvre exige d'avancer, et l'application ne peut pas aider.** Sa
  simulation intégrée est réservée au développement (`import.meta.env.DEV` dans
  `simulate.ts` et `carSimulate.ts`, bouton retiré du build) : dans l'APK il n'y
  a rien à actionner. Une position **fixe** laisse le guidage croire qu'on ne
  bouge pas, et il annonce l'arrivée sans qu'un virage soit passé — c'est ce qui
  a longtemps caché la pastille de virage derrière celle d'arrivée. D'où
  `positionLeLongDe()`, qui égrène un tracé. Trois pièges s'y rattachent, et
  chacun a coûté un essai :
  - **Poser le conducteur avant de lancer la navigation.** Le guidage s'abonne à
    `watchPosition` en démarrant ; remplacer la fonction après coup ne touche pas
    un abonnement déjà pris, et la position reste figée. Le conducteur s'installe
    donc immobile, et `window.__parcoursRouler()` le met en route ensuite.
  - **Faire adopter le départ par l'application.** Elle calcule l'itinéraire
    depuis la position qu'elle détient déjà, relevée au démarrage : on obtenait
    27 km contre 6,4 à la référence. Toucher `.locate-button` la lui fait
    redemander.
  - **Coller la destination en coordonnées** (`parseCoordinates`, proposée en
    `.search-result.is-brand`) : chercher « Corbeil-Essonnes » rend la commune,
    dont le centre est ailleurs.
  Et comparer la distance annoncée à celle de la référence : sans ce garde-fou,
  on conduit un tracé pendant que l'application en suit un autre, et les
  manœuvres traversées n'ont rien à voir avec les siennes. **Le tracé en cours
  n'est pas lisible du dehors** — `window.__myosm` n'expose que `journal`,
  `offlineTiles`, `offlineMisses`, `offlineStore` et `map`, et la note
  `car.route` ne garde que distance, durée et trafic.
- **Un rond-point doit être inévitable pour être éprouvé.** Du Louvre à
  l'Étoile, la référence en croisait un mais l'application passait par le tunnel
  **sous** la place. Le routage piéton n'en produit aucun de numéroté sur Paris
  (mesuré). Évry → Corbeil en traverse douze en 6,4 km, sans contournement
  possible : c'est le trajet du scénario `rond-point`.

**Git** : le projet est un dépôt git à la racine (`MY OSM/`) depuis le
14 septembre 2026. Les sauvegardes de `outils/save.sh` restent possibles mais
ne sont plus l'historique ; `saves/`, `livrables/`, les dépendances, les builds
et `.env.local` sont exclus (`.gitignore`).

## Langue

Les commentaires de code sont **en français**, et les identifiants en anglais.
Toute contribution suit cette convention. **Ce qui est public sur GitHub est en
anglais** (demande explicite) : le `README.md` racine — sa version française est
`README.fr.md`, à tenir à jour en même temps —, la description du dépôt et les
notes de release. Les autres documents (`app/README.md`, `docs/`, `notes/`)
restent en français.

L'interface, elle, est **traduite** : le français reste la langue de référence
(`src/i18n/fr.ts`), l'anglais en est la traduction (`src/i18n/en.ts`), et le
choix se fait dans les paramètres. **Aucune phrase destinée à l'utilisateur ne
s'écrit donc en dur dans un composant** — voir « Langue de l'interface » plus
bas.

**À l'écran, on dit « navigation », jamais « guidage »** (demande explicite ; en
anglais « navigation » plutôt que « guidance », sauf le terme technique « lane
guidance »). Attention à l'accord : « la navigation » est féminin — « pendant la
navigation », « une navigation ». Le code et les commentaires peuvent garder
« guidage ».

## Notes de travail (`notes/`)

Des relevés de veille, gardés hors du README parce qu'ils décrivent d'autres
logiciels et non celui-ci. À lire avant d'ouvrir le chantier correspondant, et
à traiter comme des instantanés à revérifier, pas comme une spécification.

- `notes/navigation-voiture-trafic.md` — ce que l'API Routing de TomTom apporte
  pour la navigation voiture (route la plus rapide, trafic, recalcul dynamique),
  ce qu'elle **ne** donne pas (le prix des péages : 63 occurrences de « toll »
  dans sa documentation, zéro de « price »), et les deux jeux publics français
  qui chiffrent les péages — avec leurs limites, dont la principale : seul
  APRR/AREA publie ses tarifs. Mesuré le 9 septembre 2026, appels réels à
  l'appui. **Le chantier a depuis été livré** (`src/navigation/car/`) : la
  dernière section du relevé, ajoutée le 11 septembre 2026, tranche les deux
  questions qui étaient restées ouvertes et corrige trois points du relevé
  initial — dont la méthode d'appariement des gares de péage, qui ne
  fonctionnait pas telle qu'elle y était proposée.
- `notes/edition-manuelle-carte.md` — ce qu'Alpin Quest PRO offre en matière
  d'objets dessinés par l'utilisateur (itinéraires tracés à la main, zones,
  main levée, mesure de surface, export GPX/KML/PDF), relevé le 2 septembre
  2026. Contient la distinction à ne pas confondre entre *dessiner par-dessus
  la carte* et *modifier les données OpenStreetMap*, et un ordre de priorité
  proposé si le sujet est ouvert ici.

## Architecture

Application React 19 + Vite mono-page : une carte MapLibre plein écran
(`MapView`) surmontée de panneaux flottants. `App.tsx` détient **tout** l'état
partagé (POI visibles, lieu sélectionné, itinéraire, cible de recentrage) et le
passe en props ; il n'y a ni store ni contexte.

**`src/config.ts` est le point de bascule vers l'auto-hébergement.** Toutes les
URLs de services externes y sont centralisées (OpenFreeMap, Photon, Overpass,
OSRM, Esri satellite) précisément pour que le passage hors-ligne (Phase 2) ne
demande qu'un changement de valeurs. Ne pas coder d'URL de service en dur
ailleurs.

### D'où viennent les commerces affichés

**Des tuiles vectorielles, pas du réseau.** `src/services/tilePois.ts` relit la
couche `poi` du schéma OpenMapTiles dans les tuiles que MapLibre a déjà
téléchargées pour dessiner la carte (`map.querySourceFeatures`) : ~7 ms pour
1 500 lieux, aucune requête. Overpass, qui servait à ça, demandait près de 40 s
pour la même zone et tombait régulièrement — ne pas y revenir pour peupler la
carte.

Points à connaître avant d'y toucher :

- **Le classement se fait en deux temps.** La `subclass` d'une tuile est la
  valeur brute du tag OSM, mais la tuile ne dit pas de quelle clé elle vient :
  `tilePois.ts` reconstruit la table inverse valeur → clés depuis
  `FILTER_GROUPS`, puis retombe sur la `class` de la tuile (champ `tileClasses`
  d'un groupe) pour les valeurs qu'aucun groupe n'énumère. Un POI que personne
  ne réclame n'est pas affiché — c'est ce qui écarte corbeilles, bornes et
  arceaux à vélos.
- **L'identifiant d'entité d'une tuile encode l'objet OSM** : `id OSM × 10 +
  type` (1 = nœud, 2 = chemin, 3 = relation), convention Planetiler. C'est la
  clé qui permet d'aller chercher les horaires du bon objet.
- **La densité vient du zoom des tuiles**, pas d'un filtre applicatif : avant
  z14 elles ne portent que les lieux majeurs. D'où `DEFAULT_ZOOM: 14`, pour que
  la carte s'ouvre sur une vue peuplée.
- **La couche de pastilles a trois réglages liés** (`MapView`), à ne pas
  toucher séparément : le décombrement s'arrête au zoom 15
  (`icon-allow-overlap`), les libellés n'arrivent qu'au 16 — un libellé bloque
  le placement des pastilles voisines — et `symbol-sort-key` fixe l'ordre de
  placement sur le `rank` d'OpenMapTiles, sans quoi il suivrait l'ordre
  d'arrivée dans la source, qui change à chaque relecture.
- **Les POI lus sont mémorisés** (`seen`, plafonné à 8 000, éviction LRU) et
  l'affichage est tiré de cette mémoire filtrée par l'emprise. Ne pas revenir à
  un rendu de la seule dernière lecture : au-delà du zoom 14 la relecture peut
  ne rien rendre, et les pastilles disparaissaient au moment où l'on zoomait sur
  une rue.
- **La vue satellite est du raster** : elle n'aurait aucune tuile vectorielle à
  lire. `SATELLITE_STYLE` déclare donc la source `openmaptiles` et une couche
  invisible (`poi-tiles-anchor`) — MapLibre ne télécharge que les tuiles d'une
  source qu'au moins une couche utilise. `hideBasemapPois` doit continuer de
  l'épargner, sinon la vue satellite perd ses commerces.
- **Cette couche-ancre est posée dans tous les fonds**, pas seulement le
  satellite (`installMapLayers`). Au-delà du zoom 14, MapLibre étire les tuiles
  et **ne garde que les couches de données qu'une couche du style lit** : les
  pictogrammes du fond étant masqués, `poi` disparaissait, et arriver directement
  au zoom 16 (recherche, recentrage) donnait une carte **sans aucun arrêt ni
  commerce** — mesuré : 0 lieu à Vincennes et à Boulogne, alors que la tuile z14
  porte 553 arrêts de bus. C'était la vraie cause du « la relecture peut ne rien
  rendre » ci-dessous, que le souvenir des POI ne compensait que si l'on était
  passé par le zoom 14. Ne pas retirer l'ancre.
- **L'imagerie satellite est empilée, pas choisie** : le fond mondial Esri, et
  par-dessus l'orthophotographie de l'IGN (BD ORTHO 20 cm, Géoplateforme, sans
  clé). Ne pas écrire de test « suis-je en France ? » : les sources IGN portent
  leurs emprises (`SATELLITE_IGN_AREAS`), MapLibre ne leur demande donc rien
  ailleurs et Esri reste visible dessous. Sans ces emprises, chaque déplacement
  à l'étranger demanderait des tuiles pour rien — mesuré, l'IGN rend un 404 à
  Londres, New York et Genève, mais répond à Fort-de-France, d'où les trois
  emprises et non la seule métropole. Le gain est au zoom 19 (Esri y est sombre
  et empâté) ; au 18 il est mince. Les deux sources plafonnent au zoom 19, et
  `data.geopf.fr` doit rester dans la règle de cache du Service Worker aux
  côtés d'`arcgisonline`, sinon la moitié de la vue repart sur le réseau.

### Plateforme transport (`src/transport/`)

**Chantier du 15 septembre 2026**, branche `plateforme-transport` : reproduire
l'expérience parisienne partout. Le document de référence est
`docs/ARCHITECTURE-API.md` (validé ; son §6 dit ce qui a été fait autrement que
prévu) — le lire avant d'y toucher. **L'audit est `docs/AUDIT.md`** : sept villes,
non-régression de Paris, budget, mémoire, sécurité, limites connues. Les sections
IDFM ci-dessous décrivent toujours ce qui tourne à Paris : l'adaptateur les reprend
telles quelles.
- **Le budget de requêtes est un test** (`tests/transportBudget.test.ts`, adaptateur
  et orchestrateur réels, réseau simulé) : une capacité qui demande plus que §2g le
  fait échouer.

- **Une région d'abord, ses fournisseurs ensuite** (`registry.ts`,
  `regions.json`) : seuls les fournisseurs de la région active sont chargés,
  par import dynamique ; changer de région annule les requêtes en vol, libère
  les fournisseurs (`dispose`) et oublie leur cache mémoire.
- **L'orchestrateur est seul à connaître rangs, disjoncteurs et replis**
  (`orchestrator.ts`) ; un adaptateur ne connaît que sa source et rend le
  modèle canonique (`model.ts`), où chaque objet porte `source`,
  `dataQuality`, `fetchedAt` et `attribution`.
- **Tous les chiffres sont dans `policy.ts`** (délais, reprises, disjoncteurs,
  durées de cache, budget de requêtes) et viennent du document : en changer un,
  c'est mettre le document à jour dans le même commit.
- **Les appels passent par `httpClient.ts`**, natif dans l'APK pour fixer le
  `User-Agent` (`MY-OSM/<version> (+https://github.com/Gris-S/my-osm)`, exigé
  par Transitous) : délai, taille plafonnée, 4 appels simultanés par hôte,
  demandes identiques partagées, erreurs typées (`ProviderError`).
- **Étape 2a, en place** : départs d'une station, lignes déclarées et tracé d'une
  ligne passent par l'orchestrateur (`transport/stations.ts`). L'adaptateur
  `providers/idfm.ts` **reprend `services/idfm.ts` et `idfmNetwork.ts` tels
  quels** et traduit vers le modèle canonique ; `departuresView.ts` rend à
  `TransitDepartures` exactement les formes d'avant. Ne pas « simplifier » en
  réécrivant la résolution d'arrêt IDFM dans l'adaptateur : ses règles sont
  mesurées (sections IDFM plus bas).
- **Étape 2b, en place** : les itinéraires en transports passent par
  l'orchestrateur (`transport/journeys.ts`). Le parseur Navitia de
  `services/transit.ts` n'a pas changé ; l'adaptateur IDFM traduit ses trajets
  vers le modèle canonique, et `journeyView.ts` en redéduit les formes que lisent
  le panneau et le guidage (`TransitJourney`) — l'aller-retour est vérifié sans
  perte par un test. Le recousage des parcours à étapes vit dans
  `journeyView.ts`, commun à toutes les sources.
- **« Hors zone » n'est pas une panne.** Navitia rend `no_origin` et
  `no_solution` en liste vide, et `run(…, { accept })` passe alors à la source
  suivante sans toucher au disjoncteur (issue `empty`). Sans cela, deux trajets
  demandés hors d'Île-de-France coupaient Navitia cinq minutes — le disjoncteur
  des itinéraires s'ouvre à deux échecs. Même règle pour les départs : une source
  qui ne connaît pas l'arrêt laisse la main.
- **Étape 3, en place : Transitous** (`providers/transitous.ts`) répond partout
  où aucune source officielle ne le fait, et à Paris quand la clé IDFM manque :
  départs (`/v5/stoptimes`, rayon de 60 m pour un poteau et de 250 m pour une
  gare, chiffres dans `policy.ts`), tracé d'une ligne (`/v5/trip` — MOTIS n'a
  pas de tracé par ligne, seulement par course : c'est une course lue dans la
  fiche qui sert), itinéraires (`/v5/plan`, paramètre `time` vérifié par un
  appel réel). Les tracés sont des polylignes de **précision 6**
  (`polyline.ts`) ; en 5, ils tomberaient dix fois trop loin.
- **La fiche ne teste plus la clé IDFM.** Elle ne dit « clé manquante » que si
  toutes les sources ont été sautées faute de clé (`missingKeyOnly`) ; là où
  Transitous répond, la clé absente ne se voit pas.
- **Les sorties de station sont réservées aux régions qui en déclarent une
  source** (capacité `exits` du registre, lue par `navigation/exits.ts`) : sans
  cela, le guidage enverrait à IDFM la position d'une station de Tokyo pour une
  réponse vide.
- **Ce qu'une source ne donne pas retombe sur le mode** : couleur absente (Genève)
  → `MODE_COLORS`, libellé de mode absent → `MODE_LABELS` (`journeyView.ts`),
  que le guidage lit pour reconnaître un mode fermé. Les extrémités d'un
  itinéraire MOTIS s'appellent littéralement `START` et `END` : elles sont
  rendues sans nom.
- **Étape 5, en place : dire ce que vaut un horaire.** Chaque départ porte sa
  qualité — point plein « temps réel », cercle « horaire théorique » — et « à
  quai » n'est dit que d'un départ mesuré (« départ prévu » sinon) : São Paulo ne
  publie aucun temps réel, un « dans 3 min » ne doit pas y passer pour une
  mesure. La source est écrite sous les horaires et sous les trajets
  (`transport/sources.ts`). **« Sources et licences »** (menu principal,
  `SourcesList.tsx`) porte le lien vers `transitous.org/sources` qu'exige
  Transitous et la licence ODbL d'OpenStreetMap ; ses adresses sont dans
  `CONFIG.ATTRIBUTION_LINKS`.
- **Une grande gare ne déborde plus** (demande explicite, capture de Lille
  Flandres : 16 lignes, fiche de 1 030 px pour un écran de 914, titre caché sous
  les boutons). La fiche montre **5 lignes d'emblée**
  (`CONFIG.DEPARTURES_VISIBLE_LINES`, déjà classées le lourd d'abord), puis « Voir
  les N autres lignes » ; et `.sheet` ne dépasse jamais la hauteur de l'écran
  moins la colonne de boutons de droite. **Seule la liste des passages défile**
  (`.departures`, la fiche étant une colonne flexible) : quand toute la fiche
  défilait, son bord supérieur et son titre sortaient du cadre (demande
  explicite), et un défilement posé sur `.sheet` rognerait le menu de partage,
  qui déborde au-dessus. Les marques temps réel / théorique restent sur chaque
  ligne (choix explicite) ; légende et source tiennent sur **une ligne alignée à
  gauche** (demande explicite : la source calée à droite passait seule à la
  ligne).
- **Le référentiel d'IDFM n'est interrogé que pour les arrêts de sa région**
  (`capabilityAt(…, "stationDetails")` dans `MapView`). Mesuré avant la
  correction : chaque arrêt touché à Sydney, Tokyo ou Genève envoyait sa position
  à IDFM, jusqu'à 376 ko par déplacement. Ailleurs, les pastilles d'un arrêt
  apparaissent **après l'ouverture de sa fiche**, avec les lignes que ses départs
  ont montrées (`stopLinesStore.ts`) — aucune requête de plus.
- **Les appels des adaptateurs passent par le natif**, que l'inspecteur de la
  WebView ne voit pas. Dans l'APK de travail, `window.__myosm.transportRequests`
  note les 300 derniers (hôte, chemin, durée, issue) : c'est là que se vérifie le
  budget de requêtes.
- **Étape 4, en place : arrêts hybrides.** Les arrêts des tuiles d'OSM
  s'affichent d'abord, sans attendre. Au zoom 16, là où la région a une source
  d'arrêts (capacité `stops` — **pas en Île-de-France**, où OSM et IDFM suffisent
  et où le budget de requêtes est mesuré), Transitous comble les manques
  (`transport/stops.ts`) : une requête `/v1/map/stops` par tuile z15, trois au
  plus par vue, après 400 ms sans mouvement, gardée sept jours sur l'appareil
  (`persistentCache.ts`, IndexedDB).
- **Un marqueur par station** (`stopsMerge.ts`) : les quais se réunissent sous
  leur `parentId` (14 quais à Genève Cornavin), deux stations voisines de même
  nom venues de flux différents se fondent (Amsterdam Centraal), et rien de ce
  qu'OSM a déjà ne se redessine (un arrêt d'OSM à 80 m, ou de nom voisin à
  300 m). Les noms se comparent **sans le préfixe de ville** (« Genève,
  Mercier ») : sans cela, toute station ressemblerait à la gare « Genève ».
- **La fiche d'une station de Transitous l'interroge par son `parentId`**
  (`/v5/stoptimes?stopId=`, vérifié : bus, tram et train de Cornavin ensemble).
  Son identifiant (`transitous/…`) n'est pas une référence OSM : pas de détails
  demandés à Overpass.
- **Pas de grappes d'arrêts** : ils ne sont demandés qu'à partir du zoom 16, et
  plus loin les tuiles d'OSM ne portent que ceux qui se lisent à l'échelle — il
  n'y a rien à regrouper.
- **Un fournisseur déclaré au registre sans adaptateur** est « non pris en
  charge » et sauté, sans toucher au disjoncteur.
- **Une annulation n'est pas un échec** : elle ne touche pas au disjoncteur et
  ne déclenche aucun repli (`abort.ts`). Un 429 met la source au repos pour la
  durée de `Retry-After`, sans reprise.

### Temps réel des transports (`services/idfm.ts`)

Alimenté par PRIM (Île-de-France Mobilités), format SIRI Lite `stop-monitoring`,
appelé depuis le navigateur avec la clé dans l'en-tête `apiKey` — les deux
sources autorisent l'origine croisée, il n'y a pas de proxy à prévoir. Points à
connaître :

- **La clé vient de `.env.local`** (`VITE_IDFM_API_KEY`), jamais du code. Sans
  clé, la fiche l'explique au lieu d'échouer.
- **Quota : 1 000 appels par jour.** Ne pas ajouter de rafraîchissement
  périodique ; les réponses sont mises en cache 30 secondes par arrêt.
- **La granularité dépend du mode** : un poteau de bus s'interroge par son
  `StopPoint` (arrid), une gare par sa `StopArea` (zdaid). Interroger la zone
  pour un bus mélange les lignes des poteaux voisins — vérifié à l'Hôtel de
  Ville, deux poteaux d'une même zone n'ont aucune ligne commune. Les pastilles
  de `idfmNetwork` suivent la même règle (poteau le plus proche pour le bus,
  union par nom pour le ferré).
- **Ne pas se fier au tag `ref:FR:STIF`** pour retrouver l'arrêt : mesuré, il
  porte un identifiant de *point* d'arrêt et non de *zone*, et il est parfois
  absent ou périmé. Le lieu est résolu contre le référentiel ouvert des arrêts
  (proximité 200 m, départage sur nom/mode/distance), ce qui rend une **zone
  d'arrêt** — seule à réunir les deux sens. Une seconde zone du même nom dans
  un autre mode est ajoutée (métro + RER d'une même gare).
- **Tous les modes se regroupent par terminus.** Ne pas retenter le
  regroupement par sens : `DirectionRef` est vide pour une partie des trains
  (constaté sur le RER A à Châtelet-Les Halles), ce qui mêlait deux directions
  dans un même encart, et `DirectionName` répète le terminus malgré son nom.
- **Le référentiel et le temps réel ne couvrent pas le même périmètre.** La
  fiche interroge les deux et affiche en retrait les lignes déclarées à l'arrêt
  dont la source ne dit rien (`getStopLines` + `silentLines`) : à
  Châtelet-Les Halles, le RER D est par moments absent du flux. Ne pas
  supprimer ce rapprochement — sans lui, une ligne disparaît sans explication et
  l'application paraît fautive.
- Sont écartés les passages dont le terminus est la station interrogée (un
  train qui finit là ne mène nulle part) et ceux au-delà de `MAX_HORIZON_MIN`.
- Le nom et la couleur d'une ligne viennent du référentiel ouvert d'IDFM (sans
  clé), mis en cache dans `localStorage` — il ne change pratiquement jamais.

### Itinéraires en transports en commun (`services/transit.ts`)

Le moteur est **Navitia**, exposé par PRIM : même clé et même quota que le
temps réel. Il ne route pas sur la voirie mais sur les **horaires** — le trajet
rendu enchaîne des passages programmés depuis l'heure du calcul, temps
d'attente aux correspondances compris (`data_freshness=realtime` fait préférer
l'horaire du jour quand la ligne le diffuse). Points à connaître :

- **Ne pas router les transports avec OSRM** : il ne connaît que la voirie et
  ignore les horaires. D'où `RoadMode` dans `config.ts`, qui exclut `transit`
  des modes qu'on demande à un routeur de voirie.
- **Le quota est partagé avec les prochains passages** (1 000 appels par jour) :
  pas de recalcul périodique, et un cache d'une minute par couple
  départ/arrivée — un aller-retour entre les modes ne doit rien coûter.
- **Les trajets sans transport sont écartés à la lecture.** Hors
  Île-de-France, Navitia répond quand même, par un trajet à pied faute de
  réseau connu ; le mode « À pied » le fait déjà, et mieux. Une liste vide se
  dit donc dans le panneau (« hors Île-de-France »), ce n'est pas une erreur.
- **Les sections `waiting` ne deviennent pas des étapes** : leur durée est déjà
  dans le total du trajet, et les afficher couperait en deux la lecture d'une
  correspondance. Les marches de moins de 30 secondes sont écartées de même.
- **Une station se vise par son identifiant, jamais par ses coordonnées.**
  Vers le point de la station Ranelagh, Navitia visait l'adresse la plus proche
  (« 46 Avenue Mozart »), faisait descendre à La Muette et marcher six minutes ;
  vers `stop_area:IDFM:71243`, il descend à Ranelagh et arrive cinq minutes plus
  tôt (mesuré le 19 septembre 2026). `resolveJourneyStopArea` (`idfm.ts`) tire
  la zone de correspondance du référentiel ouvert (zone d'arrêt, puis jeu
  `relations`), sans clé ni quota ; `useItinerary` passe la station en
  `fromStation`/`toStation` (`JourneyOptions`). Faute de réponse, on retombe sur
  les coordonnées.
- **« Ma position » n'est prise que fraîche** (`CONFIG.ROUTE_POSITION_MAX_AGE_MS`,
  deux minutes). `useGeolocation` garde son dernier relevé, même vieux de
  plusieurs heures et même quand le suivant échoue : un trajet de nuit partait
  ainsi d'un quartier quitté depuis des heures, et manquait le dernier RER
  qu'on pouvait encore prendre. `useItinerary` retient l'instant où
  « Ma position » entre dans le parcours, redemande un relevé s'il le faut et
  n'accepte que ceux d'après ; sans GPS, le panneau demande un départ.
- **Navitia rend l'heure locale du réseau** (`20260901T182027`, sans décalage) :
  elle est reconstruite comme une date locale, ce qui suppose un appareil à
  l'heure française — le seul cas d'usage d'un réseau francilien.

`RouteResult` porte donc **une liste de tronçons**, pas une géométrie unique :
un trajet en transports se dessine étape par étape, chacune à la couleur de sa
ligne, la marche en pointillés ronds. La marche a sa propre couche dans
`MapView` (`route-walk-layer`) : MapLibre ne sait pas faire varier
`line-dasharray` d'un objet à l'autre. Ces ronds sont des **tirets de longueur
nulle** (`line-dasharray: [0, 1.8]`) terminés par des bouts arrondis — c'est
`line-cap: round` qui les rend circulaires, ne pas le repasser à `butt`.

Le trajet retenu déplie son détail dans le panneau (`JourneyDetail`) : où
monter, quelle direction, où descendre. Sous une montée, « Départs suivants »
demande à Navitia les passages d'après (`getNextDepartures`, endpoint
`/lines/{ligne}/stop_points/{quai}/departures`). **Interroger le quai, pas la
zone d'arrêt** : un quai ne dessert qu'un sens, il n'y a donc rien à filtrer
par direction — la zone mélangerait les deux. La liste part d'une seconde
après le départ qu'on prend, sans quoi elle rappellerait celui qu'on a déjà
sous les yeux. Elle n'est demandée qu'au dépli : c'est un appel de plus sur le
quota. La liste des arrêts intermédiaires a été retirée au profit de ces
horaires — savoir quand part le suivant sert plus que réciter la desserte. Les noms d'arrêt viennent de
`stop_date_times[].stop_point.name`, nom nu, et non du `from`/`to` de la
section ; là où il faut bien s'en servir (adresse d'arrivée, terminus),
`stripCommune` retire le « (Paris) » que Navitia suffixe — la commune n'apprend
rien dans une frise et fait déborder chaque ligne. La sélection et le dépli
sont le même geste — le trajet détaillé est celui que la carte trace.

Ce détail fait dépasser le panneau de la hauteur de l'écran : c'est
**`.itinerary-panel` entier qui défile**, barre de défilement masquée
(`scrollbar-width: none`). Ne pas remettre de zone défilante autour de la liste
des trajets : deux cadres imbriqués s'y disputaient la molette. `App` tient les deux moteurs séparément (`roadRoute` d'un
côté, `journeys` + `journeyIndex` de l'autre) et en **déduit** le tracé passé à
la carte selon le mode.

### Le parcours d'un itinéraire (`stops` dans `App`)

Un parcours est **un seul tableau ordonné** (`RouteStop[]`) : départ, étapes
intermédiaires (quinze au plus, `CONFIG.MAX_WAYPOINTS`), arrivée. `App` en
**déduit** `routePoints`, que les deux moteurs reçoivent, et `stopMarkers`, que
la carte dessine. Un tableau vide veut dire « aucun itinéraire ouvert ».

**Ne pas revenir à un départ, des étapes et une arrivée tenus séparément.**
C'est ce tableau unique qui rend le parcours réordonnable d'un bout à l'autre :
descendre le départ fait de la première étape le nouveau point de départ, et
« ma position » peut être l'arrivée — rentrer chez soi après une course est un
parcours ordinaire. Trois états distincts l'interdiraient.

- **« Ma position » est un point comme un autre** (`{ kind: "current" }`), et
  non un cas particulier du départ. Elle n'a pas de coordonnées propres :
  elles sont résolues au rendu et manquent tant que la géolocalisation n'a pas
  répondu, d'où `stopCoords` qui porte des trous et `routePoints` qui vaut
  `null` tant qu'il en reste un. Un seul point peut l'être — le refus est dans
  `App` autant que dans l'interface.
- **À l'écran, les extrémités ne défilent pas.** Le tableau est unique, mais le
  panneau garde le départ et l'arrivée à leur place et ne fait défiler que les
  étapes : voir où l'on va doit rester acquis, y compris avec quinze étapes au
  milieu.
- **Le rôle d'un repère vient de son rang dans le parcours**, pas de sa place
  dans la liste des repères dessinés (`RouteStopMarker.role`) : un point dont
  la position est encore inconnue n'est pas dessiné, sans que ses voisins
  changent de couleur.
- **`stopMarkers` est mémorisé sur les seules positions.** La carte retire et
  repose tous ses repères quand la liste change d'identité ; la reconstruire à
  chaque rendu les ferait clignoter à chaque frappe dans le champ de recherche.
- **La ligne du panneau est une fonction de rendu, pas un composant**
  (`renderStop`). Déclaré dans le corps du panneau, un composant changerait
  d'identité à chaque rendu et React remonterait la ligne : le champ de
  recherche perdrait sa saisie à chaque frappe, puisque chercher provoque un
  rendu.
- **Une question ouverte arme la carte** (`editingStop`), et c'est pourquoi
  elle est tenue par `App` et non par le panneau : tant qu'un champ attend une
  adresse, un clic sur la carte **y répond** au lieu d'ouvrir une fiche. Le
  panneau la reçoit en prop (`editing` / `onEditingChange`) — deux dépositaires
  se désynchroniseraient, et la carte répondrait à une question refermée.

  Trois conséquences à ne pas défaire :

  - **Un commerce cliqué répond mieux qu'un point du fond**, d'où l'appel dans
    `handleSelectFromSearchOrMap` autant que dans `handleBackgroundClick` :
    « chez le boulanger » vaut mieux que l'adresse du trottoir d'en face.
  - **La photo de rue ne happe pas le clic** pendant qu'une question est posée
    (`picking` dans `MapView`) : on désigne un endroit, une photo n'en est pas
    une réponse. Un commerce, lui, continue de primer sur tout.
  - **La question est relue dans une ref après le géocodage inverse**
    (`editingStopRef`) : entre le clic et le nom qu'on donne à l'endroit,
    l'éditeur a pu être refermé, et on ne doit pas répondre à une question
    retirée.

  L'invitation (« Ou touchez un point sur la carte ») est en tête des
  résultats du champ, et non ailleurs : c'est là que se porte le regard une
  fois le champ ouvert. Elle n'a pas l'aspect d'un bouton — ce n'est pas elle
  qu'on clique, c'est la carte. Le viseur du curseur ne la remplace pas : il
  n'existe pas au doigt.

Points à connaître sur le calcul lui-même :

- **Les deux moteurs ne s'en accommodent pas de la même façon.** OSRM enchaîne
  les coordonnées dans une seule URL et rend un tracé unique : rien à recoudre,
  et surtout pas des trajets calculés deux à deux — le moteur tient compte du
  sens d'arrivée à chaque étape. Navitia, lui, **ne sait pas router par des
  points de passage** : `getTransitJourneys` reçoit la liste entière et
  enchaîne un appel par tronçon, chacun partant de l'arrivée du précédent, puis
  recoud le tout (`stitchJourneys`). D'où la signature commune en liste de
  points, et non en couple départ/arrivée.
- **C'est le coût en appels qui fixe le plafond**, pas une limite des moteurs :
  quinze étapes valent seize appels à Navitia sur le quota partagé de 1 000 par
  jour. Ne pas remonter `MAX_WAYPOINTS` sans reprendre ce calcul.
- **Avec étapes, les transports ne proposent qu'un parcours.** Comparer les
  combinaisons de trois propositions sur cinq tronçons n'aurait ni sens à lire
  ni un coût tenable : le meilleur de chaque tronçon est retenu. Le panneau le
  dit — laisser croire à un choix absent serait pire que l'absence de choix.
- **L'heure de départ fait partie de la clé de cache.** Chaque tronçon part de
  l'arrivée du précédent ; sans elle, deux calculs lancés à des heures
  différentes se serviraient la même réponse. Elle est arrondie à la minute,
  qui est la résolution des horaires comme celle du cache (TTL d'une minute).
- **Le recalcul suit les coordonnées, pas les lieux** (`routeKey`) : renommer
  une étape ou remplacer un lieu par un autre au même point ne doit pas coûter
  un appel.
- **`stopoverAfter` distingue une escale d'une correspondance.** Un parcours
  recousu enchaînerait sinon « Descendre à… » puis « Monter à… » sans dire
  qu'on est arrivé quelque part entre-temps ; ces indices d'étape permettent au
  panneau d'y intercaler le nom du point demandé.
- **L'ordre est un choix de l'utilisateur, jamais du moteur.** OSRM sait
  réordonner (`/trip`, le problème du voyageur de commerce) — on ne le lui
  demande pas. Le réordonnancement se fait aux flèches, et non au
  glisser-déposer : le glissement natif ne fonctionne pas au doigt.
- **Déplacer ou retirer un point touche l'éditeur ouvert**, qui désigne sa
  cible par son rang : un déplacement le referme, une suppression le referme ou
  le décale. Sans quoi on remplacerait un point en croyant en modifier un
  autre.
- **Au-delà de `WAYPOINTS_VISIBLE` (4) étapes, la liste défile sur place.**
  C'est la seule zone défilante imbriquée du panneau, et elle ne contredit pas
  la règle posée plus haut pour la liste des trajets : les deux ne sont jamais
  ouvertes au même endroit. La hauteur laisse voir un fragment de la ligne
  suivante, seul indice que la liste continue.
- **Les repères d'étape sont numérotés sur la carte** (marqueurs du DOM, comme
  le départ et l'arrivée) : deux points identiques ne diraient pas lequel vient
  d'abord, et l'ordre est précisément ce qu'on règle. Les trois rôles ont les
  couleurs du panneau — vert, bleu, rouge.
- **Un parcours garde au moins deux points.** `handleRemoveStop` refuse de
  descendre en dessous, dans `App` et pas seulement dans l'interface, pour
  qu'aucun appel ne laisse un itinéraire sans arrivée.

### Navigation guidée à pied (`src/navigation/`)

Le guidage pas à pas d'un trajet **à pied** : la manœuvre à venir et sa
distance, le temps restant, l'heure d'arrivée, et le profil du dénivelé dans le
détail. Tout tient dans `src/navigation/`, **par exigence** : la demande était
d'en faire quelque chose qu'on puisse retoucher ou retirer sans démonter
l'application. Le dossier a son propre `README.md`, qui énumère ses fichiers et
ses points de contact — le lire avant d'y toucher.

L'application n'y touche qu'en **cinq fichiers**, où chaque endroit est signalé
par un commentaire qui nomme le dossier : la ligne d'`@import` d'`App.css`,
l'appel à `useNavigation()` dans `App` (plus le rendu du panneau, le trajet
passé à la carte et les conditions qui effacent l'interface pendant le guidage),
la prop `onStartNavigation` d'`ItineraryPanel`, les props `navigation` /
`onNavigationPan` de `MapView`, et dans `AppMenu` le `<NavigationSettings />`
des paramètres avec l'entrée « Historique » et son `<HistoryPanel />`. Le module
n'ajoute rien à `types.ts`, à `config.ts` ni à `src/i18n/` — en ajouter
annulerait l'intérêt du découpage.

- **Trois guidages, trois sessions.** Le piéton avance dans l'espace, le
  voyageur dans l'horaire, le conducteur dans l'espace mais à une autre échelle
  et sous d'autres contraintes. `useNavigation`, `useTransitNavigation` et
  `useCarNavigation` ne partagent que `NavMapState` — ce que `MapView` sait
  lire — et `locateOnPath`, la projection sur le tracé, seule partie qu'il
  aurait été coûteux d'écrire deux fois. Elles ne sont jamais actives ensemble.
  Les points qui suivent décrivent le **guidage piéton** ; la voiture a sa
  section plus bas.
- **Le guidage a son propre trajet**, demandé au même OSRM avec `steps=true`.
  `services/routing.ts` ne rend qu'un tracé et une durée — tout ce qu'un panneau
  d'itinéraire montre ; le guidage a besoin des manœuvres. Et il **recalcule**
  quand on s'écarte, ce que l'itinéraire ne fait pas.
- **Le tracé est recomposé à partir des étapes**, jamais repris du champ
  `geometry`. C'est la garantie que la ligne dessinée et celle sur laquelle on
  mesure l'avancement sont la même : deux tracés voisins mais distincts
  feraient tomber la position entre les deux.
- **Toutes les étapes d'OSRM sont gardées**, y compris le `depart` d'un tronçon
  qui n'est pas le premier. Il paraît redondant avec l'arrivée au point de
  passage qui le précède — même endroit, même instant — mais il porte la
  géométrie et la durée de tout ce qui suit. Mesuré sur un parcours à une étape
  dans Fontainebleau : l'écarter amputait le tracé et le temps restant.
- **`routed-foot` ne nomme pas toujours la voie.** Mesuré : les instructions
  portent bien « Rue Grande », « Rue d'Avon » là où le piéton emprunte la
  chaussée, mais rien dans le centre de Paris, où les trottoirs sont cartographiés
  en `footway` séparés et sans nom. Ce n'est pas un défaut du moteur — `routed-car`
  nomme tout sur le même réseau, parce qu'il roule sur la voie nommée. D'où deux
  formulations par manœuvre dans `strings.ts` (« Tournez à droite sur {name} » et
  « Tournez à droite ») : ne pas en supprimer une, ni chercher à combler le nom
  manquant par un géocodage inverse — l'adresse la plus proche nomme souvent la
  rue qu'on quitte, pas celle où l'on tourne.
- **Le recalcul suit l'écart, pas le premier pas de travers** :
  `OFF_ROUTE_FIXES` relevés consécutifs au-delà de `OFF_ROUTE_METERS`. Un relevé
  GPS isolé rebondit de vingt mètres sous les arbres ; recalculer à chaque
  rebond ferait clignoter l'instruction et enchaînerait les appels. Un recalcul qui échoue **laisse en place le trajet précédent** — perdre le
  guidage parce qu'une requête a manqué serait le pire moment — et le suivant
  attend de plus en plus longtemps (`rerouteRetryDelayMs`, voir la voiture).
- **Le suivi de position est un hook à part** (`useNavPosition`, `watchPosition`).
  `useGeolocation` rend une position à la demande et son interface est promise
  telle quelle au portage Capacitor : elle ne doit pas bouger. Le portage du
  guidage se fait au même endroit et de la même façon.
- **La caméra se cale sur le tracé, pas sur le relevé brut** : le point GPS
  saute d'un mètre à l'autre et la carte tremblerait à chaque relevé. Hors
  parcours, en revanche, c'est bien la position réelle qu'il faut montrer. Et le
  cap vient de l'appareil seulement quand il marche vraiment (au-delà d'un
  mètre par seconde) : à l'arrêt, un téléphone annonce n'importe quelle
  direction, et la carte se mettrait à tourner sur elle-même.
- **Le cadrage est un réglage** (`useNavCamera.ts`, section « Navigation » de la
  fenêtre des paramètres), persisté sous `osm-local:nav-camera` selon le patron
  habituel. C'est un **magasin de module** et non un `useState` de hook, pour la
  même raison que la langue : la valeur est lue à deux endroits éloignés de
  l'arbre — la fenêtre des paramètres et la session de guidage — et `App` n'a pas
  de contexte, par choix d'architecture ; deux `useState` indépendants se
  désynchroniseraient. « Fixe » rend l'échelle constante qui précédait ce réglage.
- **En adaptatif, le zoom se déduit de la distance à la prochaine manœuvre** :
  à 300 m d'un virage la carte s'écarte assez pour montrer d'un coup où l'on est
  et où l'on tourne, à 50 m elle se resserre sur le carrefour, seule chose à
  regarder alors. La carte étant vue de dessus, la résolution du sol est la même
  partout à l'écran et **le calcul est exact** : vérifié sur la courbe, la
  manœuvre se pose entre 187 et 239 px du haut de 500 m à 120 m, sous un bandeau
  qui en occupe 148. Au-delà de 500 m le plancher de zoom prend le relais et la
  manœuvre sort du champ utile — c'est ce qu'il veut dire. `LOOK_AHEAD_SHARE`
  est le seul réglage à toucher si elle paraît trop haute ou trop basse.
- **Ces 148 px sont un réglage, pas une observation** : tout ce qui grandit le
  bandeau déplace la manœuvre sous lui. La pastille de manœuvre a justement été
  agrandie sans y toucher (demande explicite) — elle **épouse le bord gauche du
  bandeau et en touche le haut et le bas** par des marges négatives valant
  exactement son rembourrage (14 px / 16 px), et sa hauteur vient de
  `align-self: stretch`, donc de la ligne de texte. Deux conséquences à ne pas
  perdre de vue : changer le rembourrage de `.nav-banner` oblige à changer ces
  marges, et **ne pas donner de `min-height` à la pastille** — elle pousserait
  le bandeau dès que le texte serait plus court qu'elle.
- **Le numéro de sortie d'un rond-point s'inscrit dans le pictogramme**
  (demande explicite) : c'est la seule information qu'on cherche à l'approche,
  et la lire dans la phrase oblige à quitter la route des yeux plus longtemps
  que de reconnaître un chiffre. Il ne sort que pour les ronds-points —
  `roundaboutExit()` côté piéton, `carRoundaboutExit()` côté voiture, chacune
  gardant la connaissance des types de son moteur — et la pastille reste nue
  quand la source ne donne pas de sortie. Ailleurs, un chiffre dans la pastille
  ne voudrait rien dire.
- **C'est le zoom qui s'ajuste, jamais le centre.** Glisser le centre vers le
  carrefour déplacerait la flèche à l'écran, et on ne saurait plus où poser les
  yeux — le marcheur reste au même endroit de la vue, c'est l'échelle qui bouge.
- **En voiture, la flèche est grande et aimantée au trait** (demandes
  explicites, captures à l'appui : elle tremblait de part et d'autre de la
  ligne bleue). Sur le parcours elle ne suit plus le relevé brut mais le point
  du tracé (`pointAtMeters`), n'avance que vers l'avant — un recul de moins de
  `ARROW_BACKTRACK_METERS` n'est que du bruit — et prend le cap du trait sous
  elle sur ±12 m (`bearingAround`), pas le cap GPS ni celui lissé sur cent
  mètres de la caméra, qui couperait les virages. Hors parcours, elle reprend
  la vraie position, sans quoi le recalcul ne se comprendrait pas. Sa taille
  vient de `NavMapState.largeArrow` : 64 px en voiture, 40 à pied.
- **La flèche glisse d'un relevé au suivant, à la manière de Waze** (demande
  explicite ; elle avançait par sauts). `MapView` l'anime lui-même
  (`glideNavArrow`, `requestAnimationFrame`) : vitesse constante, rotation par
  le plus court chemin, et une durée égale à **l'intervalle mesuré entre les
  deux derniers relevés** (bornée à 300–1 500 ms), si bien que le glissement
  finit quand le suivant arrive et que la flèche ne s'arrête jamais — au prix
  d'un relevé de retard. **La caméra fait le même chemin, sur la même durée,
  dans la même boucle** (`navGlideStep`, par `jumpTo`) : c'est ce qui garde la
  flèche immobile à l'écran. Avec l'amorti par défaut d'`easeTo`, la carte
  rattrapait la flèche en freinant puis repartait, une saccade par relevé. Un
  écart de plus de 250 m (recalcul, retour d'arrière-plan) pose la flèche d'un
  coup. Vaut pour toutes les navigations qui ont une flèche.
- **Pendant la navigation, 60 images par seconde au plus, et une définition
  légèrement abaissée** (demandes explicites : le téléphone chauffait).
  Mesuré sur un trajet de vingt minutes : l'appli et son moteur web ont consommé
  51 minutes de processeur, soit 2,5 cœurs en continu, parce que la carte se
  redessinait sans arrêt à la fréquence de l'écran — 120 Hz sur un Pixel 8.
  - **Ne pas remettre `easeTo` sur la caméra de navigation** : il suit la
    fréquence de l'écran. La boucle saute les images de trop (`NAV_FRAME_MS`,
    avec une tolérance pour ne rien perdre sur un écran à 60 Hz).
  - **La carte est dessinée à 85 % de la densité de l'écran** tant qu'une
    flèche est suivie (`NAV_PIXEL_RATIO_SHARE`, `setPixelRatio`) : 28 % de
    pixels en moins, sans différence visible. Rendue à la fin du guidage. Ne
    pas descendre plus bas sans le vérifier sur le téléphone — la demande est
    que cela ne se voie pas.
  - Un geste sur la carte **lâche la caméra tout de suite** (`camTo = null`
    dans l'écoute du geste), sans attendre que le guidage l'apprenne.
  - **Aucun `easeTo` non plus pour les recadrages sans glissement** (saut,
    zoom, reprise du suivi, arrêt) : `easeNavCamera` passe par la même boucle,
    amortie, et **ne fait rien si la caméra est déjà à la pose demandée**
    (`samePose`). À l'arrêt, chaque relevé redemandait la même pose par un
    `easeTo` de 800 ms, soit un rendu à 120 Hz huit dixièmes de chaque seconde.
    Mesuré en navigation voiture à l'arrêt sur Pixel 8 : **2,59 cœurs et
    114 images par seconde avant, 0,24 cœur et 3 images en 20 s après**.
- **La carte reste vue de dessus** (`NAV_PITCH` à 0), et c'est le **décentrement
  du repère** qui donne la vue vers l'avant : le marcheur est assis aux deux
  tiers de la hauteur (`WALKER_AT`), par la `padding` de la caméra MapLibre.
  Centré, la moitié de l'écran montrerait le chemin déjà parcouru, celui qu'on
  ne regarde pas. Une caméra penchée dégagerait davantage de terrain, mais elle
  écrase les distances vers l'horizon — deux rues éloignées s'y confondent, et
  un plan cesse de se lire comme un plan ; le décentrement gagne la même place
  sans rien déformer, et rend exact le calcul du zoom ci-dessus. Le guidage
  **aplatit donc la carte le temps qu'il dure**, y compris en vue 3D, et rend
  l'inclinaison du menu des calques à l'arrêt.
- **La marge de caméra est retirée à l'arrêt du guidage**, sinon tous les
  recentrages suivants — un résultat de recherche, le bouton de position —
  placeraient leur cible dans le bas de l'écran.
- **Tous les menus restent ouverts pendant le guidage** — changer de fond de
  carte ou rouvrir un signet en marchant ne doit pas demander d'arrêter la
  navigation. Deux d'entre eux occupent la ligne du bandeau de manœuvre, le
  burger et la colonne météo/boussole : ils descendent dessous
  (`.app-shell.is-navigating`), d'un décalage **constant** taillé pour le
  bandeau le plus haut — un décalage suivant la hauteur réelle les ferait sauter
  chaque fois que la ligne « recalcul » apparaît. La colonne de droite remonte
  au-dessus de la barre de route par le `offsetBottom` qui existait déjà. Seule
  la **barre de recherche** ne revient pas : elle occupe exactement la ligne du
  bandeau, et chercher une adresse en marchant, c'est refaire un itinéraire.
- **Se rendre ailleurs pendant le guidage arrête le suivi**, au même titre qu'un
  geste sur la carte : sans cela, ouvrir un signet ferait revenir la carte sur
  le marcheur au relevé suivant, et le lieu qu'on voulait voir disparaîtrait
  une seconde après.
- **Le bouton de recentrage et la barre de route partagent une colonne**
  (`.nav-dock`) plutôt que d'être positionnés chacun de son côté : le bouton
  doit rester au-dessus de la barre, y compris quand le détail se déplie et la
  fait grandir de deux cents pixels. Même motif que `.map-dock` pour la météo et
  la boussole — un décalage chiffré à la main finissait par passer dessous.
- **Reprendre la carte en main arrête le suivi.** Seuls les gestes de
  l'utilisateur comptent : les événements déclenchés par notre propre `easeTo`
  n'ont pas d'`originalEvent`, ce qui les distingue. Sans cela, le recentrage
  suivant ramènerait aussitôt la vue et il serait impossible de regarder plus
  loin sur le parcours.
- **Le dénivelé vient des tuiles d'altitude déjà utilisées par l'ombrage**
  (`CONFIG.TERRAIN_TILE_URL`), pas d'un service de profil : mondiales, sans clé,
  et souvent déjà dans le cache du navigateur puisque le calque « Relief » les
  demande. Le décodage a été vérifié sur de vraies tuiles — Mont Blanc 4 784 m,
  Chamonix 1 041 m, Méditerranée 0 m — et l'origine croisée aussi : S3 ne rend
  ses en-têtes `Access-Control-*` **que si la requête porte un `Origin`**, si
  bien qu'un `curl -I` laisse croire le contraire.
- **La barre du bas porte trois chiffres nus** : le temps restant en gros avec
  son unité en dessous, l'heure d'arrivée, la distance. Pas de libellé sous
  chacun — un temps, une heure et une distance se reconnaissent à leur forme, et
  trois étiquettes mangeaient la place du seul chiffre qui compte. Les intitulés
  restent en infobulle, pour la synthèse vocale. Au-delà de l'heure, le temps
  restant s'écrit d'un bloc (`1h20`) et perd son unité.
- **Le nombre de pas estimé décrit le parcours entier**, pas ce qu'il en reste :
  c'est un ordre de grandeur qu'on regarde une fois. Il ne bouge donc pas en
  marchant, et n'est refait qu'après un recalcul, quand le parcours n'est plus
  le même. La longueur de pas retenue est celle des podomètres (0,75 m) et le
  chiffre est arrondi à la cinquantaine, pour qu'on ne le lise pas comme un
  comptage.
- **Le profil n'est calculé qu'au dépli du détail**, comme tout ce qui coûte un
  téléchargement ici, et il est refait après un recalcul : le profil d'un
  parcours qu'on ne suit plus tromperait sur ce qui reste à monter. Le zoom des
  tuiles est choisi sur le **nombre de tuiles réellement traversées** et non sur
  l'emprise : un trajet en diagonale couvre un large rectangle mais n'en touche
  qu'une poignée.
- **Le cumul du dénivelé a un seuil** (`GAIN_THRESHOLD`). Sans lui, le bruit du
  modèle d'altitude — quelques dizaines de centimètres d'un relevé au suivant —
  s'additionnerait sur deux cents points et annoncerait cent mètres de dénivelé
  sur un parcours plat.
- **Le graphe encode un état, pas une identité** : ce qui reste garde la couleur
  de l'itinéraire, ce qui est parcouru passe à l'encre grise. Une seule série,
  donc pas de légende — le titre la nomme. L'échelle verticale ne part pas de
  zéro, comme tout profil de randonnée, d'où les altitudes **écrites** sur
  l'axe : c'est ce qui empêche une échelle serrée d'exagérer une côte sans le
  dire.
- **Les phrases du guidage sont dans `src/navigation/strings.ts`**, seule
  entorse à la règle de `src/i18n/` — voir plus bas.
#### Fin de trajet et historique

Un trajet se termine de deux façons — l'arrivée, ou le bouton « Terminer » — et
les deux ouvrent la **même fiche** au centre de l'écran : temps mis contre temps
annoncé, distance, pas, vitesse et allure. Il part ensuite à l'historique, qui
s'ouvre depuis le menu principal.

- **Le temps annoncé est celui de la portion parcourue**, et non du trajet
  entier : s'arrêter à mi-chemin se compare à la moitié annoncée. Il est
  accumulé d'un recalcul à l'autre (`merge` dans `useNavigation`), comme la
  distance et le tracé — sans quoi un détour effacerait de l'historique le
  kilomètre déjà marché.
- **La fiche s'ouvre avant que tout soit connu.** Le profil du dénivelé demande
  quelques tuiles d'altitude ; il s'ajoute à la fiche et au trajet enregistré
  quand elles répondent. Faire attendre devant un écran vide au moment où l'on
  vient d'arriver serait le pire endroit pour un chargement.
- **Aucun navigateur ne donne accès au podomètre du système** : celui d'Android
  (`TYPE_STEP_COUNTER`) et celui d'iOS sont réservés aux applications natives.
  `useStepCounter.ts` compte donc lui-même, par détection de pics sur
  l'accéléromètre, et il est écrit pour être **remplacé tel quel au packaging
  APK**, comme `useGeolocation` — greffon Capacitor, permission Android `ACTIVITY_RECOGNITION` (retirée du
  manifeste tant qu'aucun greffon ne s'en sert), et `source` passant à
  `"device"`, cas que la fiche
  distingue déjà. Deux limites à ne pas cacher : le comptage s'arrête écran
  éteint, et sa justesse dépend de la façon dont le téléphone est porté. D'où
  la mention de **l'origine du chiffre** sous les pas, et le repli sur
  l'estimation par la distance dès que le capteur n'a rien rendu.
- **La demande d'accès aux capteurs se fait dans le clic de « Démarrer »**, pas
  dans un effet : iOS ne l'accorde que depuis un geste de l'utilisateur, et le
  contexte du geste est perdu dès qu'on passe par un effet. Le départ n'attend
  pas la réponse — un refus coûte le comptage, pas le guidage.
- **L'historique va dans IndexedDB** (base à part, `osm-local:navigation-history`)
  et non dans `localStorage` : un trajet porte son tracé et son profil, deux à
  dix kilo-octets, et l'écriture de `localStorage` est synchrone — elle
  bloquerait le fil principal à l'instant de l'arrivée. Rien ne quitte
  l'appareil.
- **Un trajet garde des nombres, jamais des phrases** : vitesse, allure, écart
  au temps annoncé, titre de la liste se recalculent au rendu (`trip.ts`). C'est
  la même règle que pour les relevés météo — changer de langue refait ainsi
  l'affichage d'un historique vieux de six mois.
- **« Ma position » ne va pas dans un historique.** C'est un rôle, pas un
  lieu : relu six mois plus tard il ne dit rien. `App` laisse donc l'extrémité
  **sans nom**, et le guidage lui trouve son adresse par géocodage inverse
  (Photon puis la BAN, comme le reste de l'application) au départ du trajet. Le
  parcours part sans attendre la réponse ; une extrémité qui reste sans nom
  s'affiche seule, sans flèche orpheline (`routeLabel`).
- **La liste dit la date, l'heure du départ, la durée et la distance**
  (demande explicite), en blanc pour une marche et en orange pour une course.
  La date est courte et suit la **langue**, pas la `locale` : `14/09/26` en
  français, `09/14/26` en anglais (`tripListTitle`) — la locale anglaise est
  `en-GB`, qui écrirait le jour d'abord. La destination n'est plus dans la
  ligne : elle reste en tête du détail.
- **Un trajet déplié est seul à l'écran** (demande explicite) : les autres
  lignes disparaissent, et deux flèches au bas du détail passent au trajet
  voisin dans l'ordre de la liste (← plus récent, → plus ancien ; les flèches
  du clavier aussi), avec la position « 3 sur 12 ». **Les flèches ne bougent pas d'un
  trajet à l'autre** : pendant la lecture la fenêtre prend toute la hauteur et
  la barre reste collée en bas (`is-reading`) — sinon une marche courte après
  une course longue déplaçait le bouton sous le doigt. Toucher la ligne du trajet
  le replie et rend la liste. Le détail est remonté à chaque changement — la
  carte et l'image de partage sont celles du trajet affiché.
- **Partager et supprimer sont au bas du détail, et nulle part ailleurs.** Pas
  de mode sélection ni d'actions groupées : on agit sur le trajet qu'on est en
  train de regarder, ce qui rend impossible d'effacer le mauvais. La
  confirmation se déplie à la place des boutons, jamais `window.confirm`, comme
  partout ailleurs.
- **Le partage est une image, et rien d'autre.** Elle porte tout le bloc du
  détail — parcours, quatre chiffres, carte, dénivelé — si bien qu'un texte à
  côté ne dirait rien de plus. Elle n'est pas une capture du DOM : **aucune API
  du navigateur ne sait rastériser un morceau de page**, et les bibliothèques
  qui le prétendent réinterprètent la CSS à leur façon. Le bloc est donc
  redessiné sur un canvas à partir des mêmes valeurs que l'écran
  (`tripCard.ts`), à deux fois la taille finale — à un pixel par point, une
  image partagée paraît floue en plein écran.
- **La carte, elle, est vraiment capturée** : celle du détail, déjà à l'écran.
  Elle exige `canvasContextAttributes: { preserveDrawingBuffer: true }` — sans
  quoi WebGL vide son tampon et `toBlob()` rend un carré vide — d'où une
  instance MapLibre distincte de celle de l'application, où cette option
  coûterait à chaque image.
- **L'image est préparée à l'ouverture du détail, jamais au clic**, et c'est la
  condition pour que la feuille de partage s'ouvre : les navigateurs ne
  l'accordent que sous **activation transitoire**, c'est-à-dire dans le geste
  même de l'utilisateur. Fabriquer l'image d'abord — la carte met une à
  plusieurs secondes à peindre ses tuiles — puis appeler `navigator.share`
  arrivait toujours trop tard, et le partage retombait sur l'enregistrement.
  Le bouton reste donc grisé le temps du rendu, et son gestionnaire n'a **aucun
  `await` avant `shareImage`**. Ne pas le rendre asynchrone pour « simplifier ».
- **Le chemin de sortie dépend de l'appareil, pas de ce que l'API propose**
  (`tripShare.ts`). Sur **téléphone et tablette**, la feuille de partage du
  système, qui laisse choisir l'application : c'est le geste attendu là-bas, et
  il n'a pas d'équivalent. Sur **ordinateur** — Linux, Windows, macOS
  indifféremment — le presse-papiers, puis le téléchargement s'il échoue.
  Chrome et Edge savent pourtant ouvrir une feuille de partage sous Windows et
  macOS : on ne s'en sert pas, parce que coller une image est plus direct qu'une
  boîte de dialogue système et que le geste reste alors le même sous Linux, où
  cette API n'existe dans aucun navigateur. Un seul comportement à connaître
  pour les trois systèmes.
- **La détection d'appareil** repose sur `userAgentData.mobile` quand il existe
  — les navigateurs Chromium — et sur la chaîne d'agent ailleurs, avec le cas
  particulier de **l'iPad**, qui se présente comme un Safari de bureau depuis
  iOS 13 et que seul son nombre de points de contact trahit. Vérifiée sur onze
  chaînes réelles, dont un PC Windows tactile, qui ne doit pas passer pour une
  tablette.
- **L'interface dit lequel des trois a eu lieu** : « partagé », « copié » et
  « enregistré » ne demandent pas la même chose ensuite.
- **La conservation s'applique tout de suite**, et pas seulement aux trajets à
  venir : ramener le délai à une semaine efface les trajets de l'an dernier, et
  « ne rien enregistrer » vide l'historique existant — le promettre pour l'avenir
  seulement ne répondrait pas à la demande. La purge est relancée à l'ouverture
  de l'historique **et** à la fin de chaque trajet : l'application n'a pas de
  tâche de fond, et une purge liée au seul démarrage laisserait vivre les
  trajets d'une session qu'on ne referme jamais.
- **Une simulation existe en développement seulement** : un marcheur fictif
  avance le long du tracé, à deux fois et demie l'allure réelle — elle sert à
  voir défiler les manœuvres, pas à mimer une promenade. Deux verrous plutôt qu'un — le bouton n'est pas rendu
  hors développement, et la boucle refuse de partir — parce qu'une position
  inventée affichée comme une vraie serait le pire des défauts pour un guidage.

#### Navigation voiture (`src/navigation/car/`)

Le guidage routier : un **choix d'itinéraire avant de partir**, puis
distance–action–direction en haut, les voies à emprunter quand il y en a, la
vitesse et sa limite à gauche, l'heure d'arrivée en bas. C'est la seule partie
de l'application qui fasse du bruit, et seulement pour les radars.

Tout tient dans le sous-dossier `car/`. Hors du dossier `src/navigation/`, elle
n'ajoute que **deux** points de contact aux cinq du guidage piéton :
`TOMTOM_ROUTING_URL` dans `config.ts`, et le script `build:car-data` dans
`package.json`. L'entorse à la règle « le module n'ajoute rien à `config.ts` »
est assumée : la règle inverse — aucune URL de service codée ailleurs — sert le
passage à l'auto-hébergement, et la clé TomTom comme l'URL des tuiles de trafic
y sont déjà.

- **TomTom quand `VITE_TOMTOM_KEY` existe, OSRM en repli.** Le mode voiture ne
  cesse jamais de fonctionner faute de clé, comme Mapillary et la vigilance.
  Mesuré le 11 septembre 2026, ce que TomTom donne et qu'OSRM ignore : la durée
  avec le trafic **en cours**, les sections à péage, les **vitesses limites**
  (`sectionType=speedLimit` → `maxSpeedLimitInKmh`, 41 sections sur
  Paris → Lyon) et les **voies à emprunter** (`sectionType=lanes`, chaque voie
  portant ses flèches et un marqueur `follow`). L'API **autorise l'origine
  croisée** — aucun relais à prévoir, contrairement à Bison Futé et au jeton
  Météo-France. Sans clé, une seule proposition, et l'écran de choix le dit.
- **Utiliser `instructionsType=text` sans `guidanceVersion=2`.** La version 2
  rend `maneuverPoint` et supprime `pointIndex` ; c'est `pointIndex` qui permet
  de poser la manœuvre sur **notre** tracé. La v1 donne en plus `street`,
  `roadNumbers`, `roundaboutExitNumber` et un `travelTimeInSeconds` **cumulé
  depuis le départ** — d'où un temps restant obtenu par soustraction, sans rien
  à sommer.
- **Les points des tronçons sont concaténés sans dédoublonnage.** La jonction
  entre deux tronçons est écrite par les deux (vérifié, à l'identique), et les
  index de section de l'API la comptent : l'écarter décalerait tout ce qui suit
  la première étape.
- **Les manœuvres d'OSRM sont traduites dans le vocabulaire de TomTom**, et non
  l'inverse : c'est le plus riche des deux (il distingue l'entrée d'autoroute de
  l'insertion), et aligner sur le plus pauvre appauvrirait le guidage là où la
  clé existe.
- **Trois appels pour un départ**, sur un palier de 20 000 par mois : deux pour
  comparer (sans manœuvres ni voies — les demander pour quatre itinéraires
  multiplie le poids de la réponse par cinq, mesuré 800 ko contre 160), un pour
  le guidage détaillé de celui qu'on retient. Puis **deux toutes les trois
  minutes** pendant le trajet, soit de quoi rouler environ cent vingt-cinq
  heures par mois — large pour un usage personnel.
- **Le premier de ces trois appels est fait par le panneau d'itinéraire**
  (`car/carEta.ts`, `useCarEta`), et le départ le **réutilise** : il est avancé,
  pas ajouté. Un départ coûte donc toujours trois appels.

  Pourquoi l'avancer : le panneau affichait la durée d'OSRM, qui ignore le
  trafic, et l'écran de choix celle de TomTom, qui le connaît. Mesuré le
  16 septembre 2026 sur un Louvre → Bastille de 2,8 km, un midi de semaine :

  | | durée |
  | --- | --- |
  | OSRM | 10,8 min |
  | TomTom, route vide (`noTrafficTravelTimeInSeconds`) | 9,8 min |
  | TomTom, trafic en cours (`travelTimeInSeconds`) | **24,6 min** |
  | dont retard d'incidents | 8,6 min (deux bouchons, 235 s et 283 s) |

  Les deux moteurs s'accordent sur la route vide : l'écart n'était pas une
  erreur de lecture, c'était la circulation. Mais promettre 10 min puis en
  annoncer 24 une seconde plus tard, pour le même trajet, ne se défend pas.

  Trois choses à ne pas défaire :
  - **`ETA_ALTERNATIVES` et `ALTERNATIVES` de `proposals.ts` sont la même
    valeur.** Deux valeurs différentes feraient deux clés de cache différentes,
    donc deux appels : tout le bénéfice disparaîtrait en silence. C'est ce que
    vérifie `tests/carEta.test.ts`.
  - **Le signal d'annulation de l'appelant n'est pas transmis** au calcul
    partagé : fermer le panneau ne doit pas interrompre une requête dont le
    départ, une seconde plus tard, aura besoin.
  - **`traffic=false` ne donne pas le temps sans trafic** — mesuré, TomTom rend
    alors 24,8 min, soit autant qu'avec. Le temps de route vide est
    `noTrafficTravelTimeInSeconds`, déjà reçu grâce à `computeTravelTimeFor=all`.
    Ne pas « optimiser » en basculant le drapeau.

  Le panneau dessine aussi **le tracé de TomTom** dès qu'il l'a : sur ce même
  trajet, OSRM proposait 3,87 km quand TomTom en prenait 2,76 — deux routes
  différentes, pas deux estimations de la même. Montrer l'une en annonçant la
  durée de l'autre était l'incohérence la plus gênante des deux. Sans clé, tout
  retombe sur OSRM et rien ne change.

  **Le panneau ne montre que deux chiffres — la durée et la distance — et c'est
  une demande explicite.** Une première version y ajoutait « dont 15 min de
  trafic » : ce bloc sert à *comparer des modes*, voiture contre marche contre
  transports, et une troisième valeur y encombrait la comparaison. Ce que le
  trafic coûte se dit donc au seul endroit où l'on choisit son itinéraire, la
  bulle. **Ne pas le réintroduire dans le panneau** : ce qui a changé là-bas est
  la *source* des deux chiffres, pas leur nombre.
- **L'API limite aussi le débit, pas seulement le volume.** Un banc d'essai qui
  enchaînait les appels sans pause a rendu des **429** : ce n'est pas la clé qui
  est en cause, c'est le nombre de requêtes par seconde. Deux appels toutes les
  trois minutes n'en approchent pas ; un script de mise au point, si.
- **Le choix de péage survit au recalcul** : qui est parti sans péage ne doit
  pas y être ramené parce qu'il a manqué une sortie.
- **L'itinéraire se réévalue selon le trafic, toutes les trois minutes**, et
  c'est autre chose qu'un recalcul : le recalcul répare *notre* écart, la
  réévaluation répond à la route qui se bouche devant alors qu'on n'a rien fait
  de mal.
- **Elle demande deux choses au moteur, et il en faut deux** : notre parcours
  **épinglé** (`supportingPoints` + `PIN_GAIN_SECONDS`, qui lui interdit en
  pratique de s'en écarter) — il revient **ré-horodaté avec le trafic du
  moment** — et le **meilleur parcours** depuis l'endroit où l'on est, sans
  contrainte. On adopte le second s'il gagne `TRAFFIC_GAIN_SECONDS` sur le
  premier — **deux minutes**. Le
  POST des points d'appui est autorisé en origine croisée (préflight mesuré :
  pas de relais à prévoir).

  **Ne pas revenir à un seul appel.** Une première version comparait le parcours
  rendu à `progress.remainingSeconds`, et c'était faux d'une façon qui tuait
  exactement le cas à traiter : ce temps restant se déduit des durées **figées au
  calcul du trajet**, et un bouchon qui se forme devant ne l'allonge jamais. On
  opposait donc un détour chiffré au trafic d'aujourd'hui à un trajet chiffré au
  trafic d'il y a une heure — le détour perdait toujours, et le guidage ne
  changeait jamais de route. Comparer deux mesures fraîches est la seule façon
  correcte, et cela coûte un appel de plus toutes les trois minutes.
- **L'écart donne en prime la dérive de l'heure d'arrivée.** Même sans changer de
  route, le parcours épinglé dit combien de temps le plan prend *vraiment* : la
  différence est ajoutée au temps restant affiché (`session.eta`, au-delà de
  `ETA_DRIFT_SECONDS`). **Le panneau lit `eta` et jamais
  `progress.remainingSeconds`** — celui-ci annoncerait une arrivée qu'on sait
  déjà fausse.
- **Les points d'appui sont au nombre de 300, et pas 150.** Mesuré : à un appui
  tous les 1,6 km le parcours suivi est reconstitué à la minute près, à 3,1 km il
  l'est « généralement » — un relevé a rendu 20 km et 25 minutes de plus, un
  appui isolé s'étant raccroché à la mauvaise chaussée (contre-allée, sens
  opposé). L'épinglage doit être fidèle, puisqu'il sert d'étalon.
- **Le seuil de deux minutes est un choix d'usage, pas une marge d'erreur.**
  Depuis que les deux parcours sont chiffrés au même instant, le bruit est
  mesuré à **quatorze secondes** (cinq réévaluations d'affilée sur un
  Paris → Lyon inchangé : 0,22 à 0,23 minute, d'une stabilité remarquable). Le
  seuil pourrait donc descendre bien plus bas sans faire changer de route pour
  du vent ; s'il reste à deux minutes, c'est que dérouter quelqu'un pour
  quatre-vingt-dix secondes lui impose un chemin inconnu contre un gain qu'il ne
  sentira pas. Un ralentissement de cinq minutes à demi rattrapé le franchit
  sans difficulté.
- **Un changement dû au trafic se dit, et dit ce qu'il rapporte.** Voir le tracé
  bouger tout seul sans explication passerait pour une erreur de l'application
  plutôt que pour son travail.
- **Le bandeau dit la distance, puis l'action, puis la direction** — dans cet
  ordre et sur deux lignes. La distance d'abord parce qu'elle seule dit si la
  manœuvre nous concerne maintenant ; la direction à part parce que sur
  autoroute « serrez à droite » ne veut rien dire sans « A6 », et qu'une ligne
  unique obligerait à lire jusqu'au bout pour savoir s'il faut tourner.
- **Le numéro de route est une pastille, le nom de la rue du texte**, et les
  deux ne sont pas de la même taille : 20 px contre 15. Ce n'est pas une
  coquetterie — on **repère** « A6 » sans le lire, comme sur un panneau, alors
  qu'un nom de voie se lit vraiment et seulement si l'on en a besoin. Agrandir
  les deux n'aurait fait qu'allonger la ligne. `carManeuverRoad` les sépare et
  **déduplique** : les moteurs répètent parfois le numéro dans le nom de la voie
  (mesuré : `N83` / « N83 »), et l'écrire deux fois côte à côte serait pire que
  de ne l'écrire qu'une.
- **La couleur de la pastille est celle des bornes routières françaises**
  (`roadClass`, classée sur la lettre initiale, seule partie stable) :

  | Couleur | Routes |
  | --- | --- |
  | rouge | autoroutes (`A`) et nationales (`N`) |
  | jaune | départementales (`D`) |
  | blanc | voies communales (`C`) et rurales (`R`) |
  | vert | européennes (`E`) et forestières (`F`) |
  | bleu cyan | réseaux métropolitains (`M`) |

  **Ne pas la « corriger » en raisonnant par importance.** Deux regroupements
  surprennent — l'autoroute partage le rouge avec la nationale, l'européenne
  partage le vert avec la forestière — et ils sont pourtant exacts : la pastille
  sert à reconnaître une route, pas à la hiérarchiser, et reprendre une
  convention que l'œil du conducteur connaît déjà vaut mieux que d'en fabriquer
  une. Une première version inventait ses couleurs (autoroute rouge, nationale
  verte, européenne bleue, `M` traité comme `D`) : elle a été refaite.

  Deux conséquences de mise en forme : les fonds clairs — jaune et blanc —
  portent un texte sombre, et le blanc a besoin d'un cerne intérieur pour ne pas
  disparaître sur le bandeau, lui-même clair. Le préfixe **`M`** a sa propre
  couleur et n'est pas une départementale : la métropole de Lyon a rebaptisé les
  siennes (mesuré sur un Dijon → Lyon sans péage, `M108`, `M108k` et `M996`
  côtoient `D973` et `D470`).
- **Les voies sont la seule chose du bandeau qu'on doive compter** — trouver la
  troisième file en partant de la droite — et tout y est dimensionné pour cela :
  cases de 46 × 58 px, flèches occupant toute la case. Elles ne rétrécissent
  **que si la chaussée ne tient pas** dans le bandeau (`flex: 0 1 46px`), plutôt
  que de passer à la ligne : une chaussée coupée en deux cesse de se lire comme
  une chaussée. Une règle `max-width: 420px` les passait à 36 × 50 sur tous les
  téléphones — le Pixel 8 fait 412 px — même pour deux voies : ne pas la remettre.
- **Les voies qu'on ne prend pas ne sont pas effacées**, et c'est le point le
  plus important de ce bloc. Une version les posait à 45 % d'opacité, en gris
  sur un fond clair déjà translucide : sur une quatre-voies où il faut aller à
  gauche, on ne comptait plus les trois files de droite — c'est-à-dire qu'on ne
  voyait plus qu'il fallait traverser toute la chaussée. Elles ont donc leur
  propre fond, un cerne franc et une flèche à pleine encre (`--lane-skip-*`,
  déclarées avec le thème). **Ce qui distingue la bonne voie des autres est une
  inversion — encre claire sur fond plein contre encre sombre sur fond clair —
  et non un écart d'intensité.** Ne pas y remettre d'opacité.
- **Les flèches de voie sont dessinées, pas écrites.** Elles étaient des
  caractères (`↑`, `↖`, `↰`), ce qui ne coûtait rien et avait deux défauts : un
  caractère est carré, donc impossible à allonger sans déformer sa pointe, alors
  qu'un panneau d'affectation de voies tire justement ses flèches en hauteur ; et
  son dessin dépend de la fonte de l'appareil. Les tracés sont engendrés par un
  calcul de géométrie — une hampe polygonale, et une pointe posée
  **perpendiculairement au dernier segment**, ce qui garde le chevron d'équerre
  quelle que soit l'inclinaison, demi-tours compris.
- **La boîte fait 40 × 60, et les virages partent bas sur la hampe.** Dans
  l'ancienne boîte de 28 de large, le bras de « à droite » ne dépassait la hampe
  que de 8,5 unités et son chevron revenait **derrière** elle : on voyait une
  hampe à crochet, pas une flèche (constaté sur une capture). La case de 46 px
  laissait pourtant la place, inutilisée. Les virages serrés et les demi-tours
  ont leur hampe décalée sur le côté, pour que le bras qui redescend passe loin
  d'elle ; les virages partent sous la pointe de « tout droit », pour qu'une
  voie à deux directions se lise sans que les pointes se touchent.
- **Les clés sont celles de TomTom, vérifiées sur l'API** : `STRAIGHT`,
  `SLIGHT_*`, `LEFT`/`RIGHT`, `SHARP_*`, et **`LEFT_U_TURN` / `RIGHT_U_TURN`** —
  la table attendait `UTURN`, que TomTom n'envoie pas, et une voie de demi-tour
  se dessinait tout droit. `follow` est une **direction**, pas un booléen. Toutes
  les directions d'une voie sont tracées ensemble, comme sur un panneau ; une
  direction inconnue retombe sur « tout droit ».

##### La vitesse affichée

Trois exigences, et chacune a sa réponse. Le fil commun : **un compteur auquel on
ne se fie plus ne sert à rien**, qu'il soit muet, figé ou clignotant.

- **Elle ne doit jamais s'éteindre en roulant.** `coords.speed` vient du
  récepteur GNSS, par mesure Doppler — précise, stable, et présente sur la
  plupart des téléphones. Quand elle manque, `useNavPosition` la **déduit de deux
  relevés consécutifs** plutôt que de laisser le compteur vide.
- **Une vitesse déduite est bruyante, et il faut deux filtres.** Sept mètres de
  tremblement en une seconde, ce sont vingt-cinq kilomètres-heure d'erreur.
  Mesuré en simulant un GPS de voiture à 90 km/h puis un freinage à 50 : une
  moyenne exponentielle seule oblige à choisir entre ±3,8 km/h avec quinze
  secondes de retard au freinage, et trois secondes de retard avec ±10,6 km/h.
  Une **médiane sur trois calculs** suivie de la moyenne rend ±6,6 km/h pour six
  secondes, ce qu'aucun réglage de la moyenne seule n'atteint. La vitesse du
  récepteur, elle, n'est jamais lissée — elle n'en a pas besoin.
- **Un chiffre figé ne doit pas passer pour un chiffre frais.** Sans relevé
  depuis `SPEED_STALE_MS` (4 s) — tunnel, parking couvert, application en
  veille — le compteur pâlit et le dit en infobulle. Tout le reste de l'écran est
  mû par les relevés eux-mêmes et ne saurait donc pas remarquer leur
  **absence** : un **minuteur unique, réarmé à chaque relevé**, se déclenche à
  l'instant où le dernier deviendrait périmé (`staleCheck`). Tant que le GPS
  répond, il ne part jamais. **Ne pas revenir à une horloge à la seconde** : ce
  hook vit dans `App`, et elle redessinait toute l'application une fois par
  seconde en plus du rendu de chaque relevé — le double du nécessaire, et
  l'une des causes de l'échauffement mesuré en navigation.
- **L'indicateur de dépassement ne doit pas clignoter.** Deux protections, et
  les mesures qui les justifient, à 95 km/h pour une limite de 90 :

  | | vitesse mesurée | vitesse déduite |
  | --- | --- | --- |
  | tolérance simple, sans hystérésis | 0 bascule | 21 en 60 s |
  | + hystérésis de 2 relevés | 0 | 9 |
  | + marge élargie de 7 km/h | 0 | **2** |

  L'hystérésis vaut pour les deux origines ; la marge élargie ne s'applique
  qu'aux vitesses déduites (`fix.speedDerived`) — moins sûre, donc moins prompte
  à accuser. Dans tous les cas un excès franc (115 km/h) reste signalé en deux
  secondes : **ne pas allonger l'hystérésis** pour régler le clignotement, cela
  retarderait l'avertissement pour tout le monde afin de corriger un défaut qui
  ne touche que les appareils sans mesure Doppler.
- **Toute la colonne de droite s'efface pendant un guidage voiture** — météo,
  boussole, signets, catégories, calques, bouton de position. C'est une
  **exception à la règle du guidage piéton**, qui garde ses menus : changer de
  fond de carte ou rouvrir un signet en marchant est un geste ordinaire, au
  volant c'en est un qu'on ne fait pas. Le burger reste, à gauche, parce qu'il
  porte les réglages du guidage lui-même. Le bouton de position part avec le
  reste : la barre de route a déjà son « Recentrer », et deux boutons qui
  ramènent au même endroit sur le même bord ne font qu'encombrer. La règle ne
  vaut **que** pendant le guidage, pas pendant le choix d'itinéraire, où la
  carte est justement l'outil de travail.
- **En bas, l'heure d'arrivée porte le gros chiffre**, à l'inverse du guidage
  piéton où c'est le temps restant. Sur vingt minutes on compte en minutes ; sur
  quatre heures de route, c'est « j'arrive à 17 h 40 » qu'on retient.
- **Le compteur change de fond, pas seulement de chiffre.** Un chiffre rouge sur
  fond clair se repère mal du coin de l'œil, ce qui est pourtant la seule façon
  dont on regarde son compteur. La tolérance avant de signaler un excès suit la
  pratique française (5 km/h sous 100, 5 % au-dessus) : sans elle, le relevé GPS
  ferait virer l'indicateur au rouge sans raison, et c'est alors le vrai excès
  qui passerait inaperçu.

##### Le prix des péages (`car/tolls.ts`)

**TomTom dit qu'on paie, jamais combien** : 63 occurrences de « toll » dans sa
documentation, aucune de « price » ou « currency », et une section à péage se
réduit dans la réponse à deux index de points. Deux points d'accès ont été
essayés et refusent le paramètre (`computeTollCosts`, et `computeTollCost` sur
Orbis v2) — ne pas y retourner.

Le prix vient donc de la grille publiée par **APRR et AREA**, seules sociétés
françaises à publier la leur : ni Vinci (ASF, Cofiroute, Escota), ni Sanef/SAPN,
ni ATMB, ni SFTRF. Cela couvre de l'ordre du tiers du réseau concédé.

- **Un montant n'est affiché que s'il est officiel.** Ailleurs : « tarif non
  publié ». Le choix a été posé explicitement contre une estimation
  kilométrique — dans un écran où l'on compare trois prix, un chiffre estimé est
  comparé quand même. Ne pas y revenir sans rouvrir la question.
- **Les bornes d'une section à péage ne sont pas les gares.** Mesuré sur
  Paris → Lyon : la section commence à 3,8 km de la barrière de Fleury-en-Bière
  et finit à 8,5 km de la gare la plus proche. Chercher la gare voisine de
  chaque extrémité donne donc le mauvais couple, ou aucun. On cherche à la place
  les gares que le tracé **traverse** (400 m du tracé — mesuré, les gares
  réellement franchies tombent entre 1 et 386 m) et on retient le couple le plus
  étendu que la grille connaisse : on a payé de la première barrière à la
  dernière. Vérifié : Paris → Lyon 41,30 €, Dijon → Lyon 16,00 €,
  Beaune → Besançon 5,40 €, Paris → Bordeaux non publié.
- **Un péage partiellement chiffré ne fonde jamais la proposition « moins
  cher ».** Il ne rend qu'un plancher (« au moins 4,10 € »), et le comparer au
  montant complet du plus rapide annoncerait une économie là où le reste du
  parcours est justement ce qu'on ignore. Mesuré : c'est exactement ce qui
  arrivait sur Paris → Lyon.
- **Les deux colonnes de la grille APRR ne sont pas de la même finesse** : 142
  noms d'entrée grossiers (`AUXERRE`) contre des noms de sortie précis
  (`AUXERRE NORD`, `AUXERRE SUD`), et des libellés composés pour les trajets
  inter-réseaux. Seuls les couples dont les **deux** gares sont localisables
  sont conservés — 9 278 sur 22 460.
- Les coordonnées du référentiel des gares sont en **Lambert-93 (EPSG:2154)** et
  sont reprojetées par le script d'engendrement ; l'inverse est vérifié sur un
  point de contrôle, à un mètre près.

##### Les propositions, et le choix sur la carte

**Le choix se fait sur la carte, pas dans une fenêtre.** Les parcours y sont
tracés côte à côte — celui qu'on regarde en plein bleu, les autres en gris — et
chacun porte une bulle : la durée, puis le péage. Un premier contact met un
parcours en avant, un second le retient et lance le guidage. Entre-temps la
carte reste entière : on la déplace, on zoome, on va voir par où ça passe.

Ce fonctionnement remplace une fenêtre au centre de l'écran qui listait trois
propositions, et il faut savoir pourquoi pour ne pas y revenir. Elle avait deux
défauts, du même principe : elle **masquait la carte**, alors que choisir entre
deux itinéraires c'est vouloir regarder par où ils passent — et son voile
interdisait même de déplacer la vue pour aller voir ; et elle **redisait les
mêmes choses**, un libellé « Sans péage » au-dessus d'un « Aucun péage », faute
d'avoir quelque chose à mettre dans deux lignes quand une seule a un contenu.
La bulle n'a donc qu'une ligne de péage, et elle ne nomme pas la proposition :
le parcours gratuit se reconnaît à ce qu'il annonce, et les payants se
départagent par leurs chiffres, qui sont côte à côte.

**Cette ligne porte aussi ce que le trafic coûte** (`choiceDetail`,
`carLabels.ts`) : « Sans péage · +9 min de trafic ». Elle est *étendue*, pas
doublée — la bulle a deux lignes, la première est la durée, et une troisième
n'aurait pas sa place. Sans cette mention, la durée paraissait fausse à qui la
comparait à une estimation sur route vide : le chiffre était juste, mais rien ne
l'expliquait, et un nombre qu'on ne s'explique pas est un nombre auquel on ne se
fie pas. En deçà d'une minute on se tait, et avec OSRM aussi — son
`trafficDelaySeconds` vaut `null`, et annoncer zéro se lirait « route dégagée ».

- **Il faut deux contacts pour partir**, et c'est délibéré : au doigt il n'y a
  pas de survol, et partir sur un itinéraire qu'on voulait seulement regarder
  serait le plus désagréable des raccourcis.
- **La bulle se pose là où le parcours s'écarte le plus des autres**
  (`bubbleAnchors`). Au milieu de chaque tracé, elles s'empileraient là où les
  parcours sont encore confondus : sur Paris → Lyon, les trois sortent par la
  même porte et ne se séparent que quarante kilomètres plus loin. Mesuré, les
  bulles retombent à 13 km les unes des autres au plus serré. Quand deux
  parcours ne diffèrent que par une bretelle et n'ont aucun endroit propre, on
  étage les bulles le long des tracés : elles ne diront pas *où* ça diverge,
  mais elles resteront lisibles.
- **Le cadrage n'est rejoué qu'au changement de propositions**, jamais quand on
  en met une en avant : la carte se recadrerait à chaque contact et l'on perdrait
  l'endroit qu'on regardait.
- **Pendant le choix, la carte ne trace que les propositions.** `App` passe à
  `MapView` `carNav.mapRoute`, nul tant qu'on choisit ; il ne doit **pas**
  retomber alors sur l'itinéraire du panneau. Celui-ci vient d'OSRM et non de
  TomTom : les deux parcours, du même bleu, se superposaient et semblaient n'en
  faire qu'un, fourchu, avec des tronçons qui ne suivaient pas la proposition
  (constaté sur une capture). D'où le `carNav.active ? null : route`.
- **La barre du bas se centre par ses marges, pas par `left: 50%`.** Un élément
  absolu posé à `left: 50%` avec une translation, sans largeur, ne peut pas
  dépasser la moitié de l'écran : la barre « Touchez l'itinéraire pour partir »
  y était plafonnée, son `max-width` ne jouait jamais, et le texte se cassait
  sur quatre lignes (constaté sur une capture). Elle est donc tendue entre
  `left` et `right` avec `width: fit-content` et `margin-inline: auto`. Même
  piège à éviter pour toute pastille flottante centrée.

##### Le recalcul et le sens de marche

**Chaque calcul transmet le sens où l'on roule** (`CarRouteOptions.heading` →
`vehicleHeading` chez TomTom, `bearings` chez OSRM) : départ, recalcul et
réévaluation (demande explicite). Sans lui, le moteur part d'un point sans
savoir de quel côté on va. Deux défauts constatés en venaient : après une sortie
manquée, un recalcul qui ramenait par un demi-tour vers elle — ce qui passait
pour « rejoindre le parcours de base », alors que la demande ne contient que la
position et la destination — et, au départ, **quarante-cinq secondes** pour
admettre qu'on partait à droite, chaque recalcul redessinant la route derrière
soi. Vérifié sur TomTom : même départ sur les Champs-Élysées, le trajet part
vers l'ouest cap à l'ouest, vers l'est cap à l'est.

- **Le sens de marche** (`headingRef`) est le cap GPS au-delà de 2 m/s, sinon
  la direction entre deux relevés distants d'au moins 12 m **et** de leur
  incertitude moyenne ; valable 20 s. À l'arrêt, `null` : un téléphone immobile
  annonce n'importe quel cap. Ne pas y substituer la boussole — dans un
  support de voiture, elle est faussée et ne dit rien du sens du véhicule.
- **Le suivi de position démarre dès l'écran de choix** (`useNavPosition(active
  && !simulating)`) : au toucher de la bulle, la position et le sens sont
  connus, et le départ part de la position **du moment** (`fixRef`), pas de
  celle de l'écran de choix.
- **Le contresens se détecte au cap, pas à l'écart** : deux relevés à plus de
  120° du tracé local (`bearingAround`), sans avancer de plus de 5 m sur le
  tracé pendant ce temps, déclenchent le recalcul — sans attendre les 50 m de
  `CAR_OFF_ROUTE_METERS`, qui reste la règle pour tout le reste. La condition
  d'avancement est ce qui protège les ronds-points et les lacets, où le cap
  s'écarte du tracé alors qu'on le suit.
- **La réévaluation ne tourne pas hors parcours**, et part de la **vraie**
  position (premier point d'appui compris), plus de son projeté sur le tracé :
  depuis le tracé qu'on vient de quitter, elle pouvait adopter un trajet qui
  repart de la sortie manquée.

- **Un recalcul raté attend avant de retenter** (`rerouteRetryDelayMs` :
  5 s, 10, 20, 40, puis une minute au plus), en voiture comme à pied. Sans
  cette attente, hors réseau ou quand TomTom refuse les appels (429), un
  nouveau recalcul repartait tous les deux relevés, indéfiniment — des appels
  pour rien et un journal rempli en moins d'une heure. Un recalcul réussi remet
  le compte à zéro.

##### Le journal de navigation (`navigation/journal.ts`)

**Un trajet laisse désormais une trace** (demande explicite). Avant, rien : le
journal d'Android ne garde qu'une minute environ, et l'application n'écrivait
rien — constaté en voulant analyser une navigation voiture « bizarre ».

- **Ce qui est noté** (`note(kind, détail)`) : lancement de l'application,
  passages en arrière-plan et retours (`app.hidden` / `app.visible` — l'écran
  éteint interrompt le guidage, c'est souvent l'explication), perte et retour
  du réseau ; en voiture, choix et propositions, départ (cap, précision),
  chaque calcul et recalcul **avec sa raison** (`offRoute` ou `wrongWay`), un
  relevé GPS résumé toutes les 5 s (précision, vitesse, cap, écart au tracé,
  avancement), réévaluations du trafic, erreurs, arrivée, arrêt (avec l'origine
  des tuiles : zone, réseau, vide).
- **Sur l'appareil seulement** (`localStorage`, 5 000 entrées au plus), écrit
  **par lots** toutes les 5 s et dès que l'application passe derrière : une
  écriture par relevé ferait travailler le stockage chaque seconde. `note` ne
  lève jamais — le journal ne doit rien pouvoir casser.
- **Il se relit par le câble** : `outils/journal.sh` (ou `outils/journal.sh
  vider`), qui interroge `window.__myosm.journal` par le débogage de la WebView.
  L'application doit être ouverte.
- **Il est inerte dans la version à partager** (audit du 16 septembre 2026).
  `window.__myosm` n'existe pas en release (`__DIAGNOSTICS__`) : le journal y
  écrivait donc des relevés GPS — une trace des déplacements, résumée toutes les
  cinq secondes — que **personne ne pouvait ni consulter ni effacer**, et qui
  échappait au réglage de conservation de l'historique. `note()` rend la main
  tout de suite quand `__DIAGNOSTICS__` est faux, et le premier lancement d'une
  release efface ce qu'une version de travail aurait laissé. Ne pas le
  rallumer en release sans lui donner d'abord un écran pour le lire et un bouton
  pour l'effacer.

##### Le trafic sur le parcours (`car/carTraffic.ts`)

**Ralentissements, bouchons, travaux, fermetures et accidents viennent de
l'itinéraire lui-même** (`sectionType=traffic`), pas d'une API d'incidents à
part (demande explicite : « sur mon trajet »). C'est gratuit en appels — chaque
calcul et chaque réévaluation les rapporte — et c'est ce qui les tient à jour
toutes les trois minutes. Constaté le jour de la demande : TomTom connaissait
les travaux de la D86 trouvés sur la route, et l'application ne les demandait
pas ; le calque « Trafic » ne les aurait pas montrés non plus (Bison Futé ne
couvre que le réseau national, et les tuiles TomTom ne portent que le débit).

- **Au choix de l'itinéraire, toutes les propositions sont colorées** (demande
  explicite), plus discrètes sur celles en gris : on compare d'un coup d'œil
  où ça bouche. **Pendant la navigation**, le parcours suivi l'est aussi, et
  les incidents y portent un repère (cône, barre de fermeture, triangle).
- **Couleurs** : ampleur 1 → orange (ralenti), 2 et 3 → rouge (bouchon) ; un
  `JAM` d'ampleur inconnue reste orange. Une fermeture ne colore rien — on n'y
  passe pas — et des travaux sans retard (ampleur 4) ne posent qu'un repère.
- **Un bouchon peut avoir des travaux pour cause** (`tec.causes` `[1, 3]`,
  relevé sur la D86) : il porte alors la couleur **et** le repère.
- **Les repères de même nature à moins de 150 m fusionnent** : un chantier que
  la source découpe ne doit pas aligner trois cônes.
- **Le trafic du parcours suivi est remplacé à chaque réévaluation** par celui du
  parcours épinglé (`setLiveTraffic(trafficOverlay(pinned))`), qui repart de la
  position courante. Ne pas le lire dans `route` seul : il y serait figé au
  départ.
- La couche (`route-traffic`) est **reposée par `installMapLayers`** comme les
  propositions : un changement de fond de carte détruit toutes les sources.
- **`NavMapState` porte les propositions** (`choices`), plutôt qu'une prop de
  plus sur `MapView` — et chaque proposition porte **son propre rappel**. La
  carte n'a ainsi rien à savoir de ce qu'est un itinéraire voiture : elle dessine
  ce qu'on lui donne et appelle ce qu'on y a joint. Les bulles sont des
  **éléments du DOM**, comme les repères d'étape : elles doivent être cliquables
  et porter deux tailles de texte, ce qu'une couche de symboles rend mal.

Le nombre de propositions, lui, **s'adapte au trajet**. La troisième se cherche parmi les itinéraires de rechange de TomTom
et nulle part ailleurs : `routeType=shortest` et `routeType=eco` ont été essayés
pour la fabriquer, tous deux rendent le même trajet et le même prix que
`fastest`. Mesuré sur cinq trajets : 3 choix de Dijon à Lyon et de Lyon à
Grenoble, 2 de Paris à Lyon et à Bordeaux, 1 de Paris à La Défense — où il n'y a
pas un mètre de péage, et où offrir « sans péage » et « le plus rapide » côte à
côte ferait un choix sans objet.

##### Les radars (`car/radars.ts`)

**Le seul son de l'application, et c'est délibéré.** Une application qui parle à
chaque virage finit qu'on la coupe, et le seul moment où l'on veut être prévenu
sans regarder l'écran passe alors inaperçu.

- La source est la liste officielle du **ministère de l'Intérieur** (décembre
  2025, 3 309 radars, position, famille et vitesse autorisée). Ne pas reprendre
  le jeu « Radars automatiques » que l'on trouve en premier : ses données
  datent de 2018.
- **La sortie audio se prépare dans le clic de « Démarrer »**, jamais dans un
  effet : les navigateurs ne créent ni ne réveillent un contexte audio hors d'un
  geste de l'utilisateur. Même endroit et même raison que la demande d'accès aux
  capteurs de mouvement du guidage piéton.
- Le son est **deux notes synthétisées** et non un fichier : rien à charger,
  rien à mettre en cache, et le module reste supprimable sans laisser d'actif.
  L'enveloppe n'est pas une coquetterie — une onde démarrée net produit un
  claquement qui s'entend plus que la note.
- La recherche des radars du parcours passe par une **grille du tracé** : trois
  mille radars contre cinq mille points feraient seize millions de projections.
  Mesuré : 10 ms sur Paris → Lyon, 23 radars.
- Un radar n'est annoncé **qu'une fois**, à 300 m — une dizaine de secondes à
  110 km/h, le temps de lever le pied sans freiner brusquement.

##### Les deux jeux engendrés (`car/data/`)

`npm run build:car-data` réécrit `car/data/tolls.ts` et `car/data/radars.ts`
depuis data.gouv.fr — **ne pas les éditer à la main**. Les trois sources
autorisent l'origine croisée, mais elles sont engendrées plutôt que téléchargées
au vol : 1,5 Mo bruts, une reprojection Lambert-93 et des défauts de forme qu'il
vaut mieux traiter une fois ici que dans chaque navigateur.

Ils sont chargés par **import dynamique** au premier itinéraire voiture — Vite
en fait deux fragments séparés (40 et 28 ko compressés) et le démarrage de la
carte n'en porte rien. Ils sont en revanche **préchargés par le Service
Worker**, contrairement au fragment Mapillary : la règle qui exclut ce dernier
tient à son poids (un mégaoctet), et soixante-dix kilo-octets qui préviennent
d'un radar dans une zone sans réseau ne se traitent pas de la même façon.

À relancer quand une source est republiée — les tarifs bougent chaque février,
les radars deux fois l'an.

#### Guidage en transports en commun

Le trajet retenu se suit pas à pas : le geste à faire en haut, la suite du
trajet en bas. C'est une **session à part** (`useTransitNavigation`), et non une
variante du guidage piéton : un piéton avance dans l'espace, un voyageur avance
dans **l'horaire**, et sous terre — l'essentiel d'un trajet francilien — il n'y
a pas de position à suivre.

- **Un trajet se découpe en actions, pas en étapes** (`transitSteps.ts`). Une
  étape en transport en demande deux : monter, puis descendre. C'est cette
  distinction qui fait tout le comportement demandé — dans le véhicule, c'est la
  station de descente qu'on affiche, pas la ligne qu'on vient de prendre.
- **Chaque action porte l'instant où elle *devient* courante**, pas celui où
  elle finit : la marche quand on se met à marcher, la montée quand on arrive à
  l'arrêt, la descente **au départ du véhicule**, l'arrivée à la fin. Le guidage
  n'a plus qu'à chercher la dernière action dont l'heure est passée.
- **Une marche qui mène à un arrêt annonce déjà la ligne.** Mesuré sur un trajet
  réel Nation → La Défense : Navitia fait arriver la marche à la seconde même du
  départ du RER, si bien que l'action « monter » ne dure rien. Sans cette
  annonce anticipée, le bandeau passerait de « marcher » à « descendre » sans
  qu'on ait jamais lu quelle ligne prendre.
- **Trois sources d'avancement, dans cet ordre de confiance** : l'horaire de
  Navitia ; le GPS quand il revient, qui **confirme** un arrêt et ne fait jamais
  reculer de plus d'une action — deux stations proches se confondraient sur une
  ligne qui revient sur ses pas ; et l'utilisateur, par deux flèches. Le geste
  manuel se garde sous la forme d'un **décalage en nombre d'actions**, non d'une
  action figée : le trajet continue d'avancer seul, avec une action d'avance ou
  de retard, ce qui est exactement ce qu'on constate quand une ligne prend du
  retard. Le décalage est affiché — un guidage volontairement décalé passerait
  sinon pour une erreur de calcul.
- **La liste du bas ne montre que ce qui reste.** Une action franchie disparaît :
  ce qui est encore écrit est ce qu'il reste à faire, lisible d'un coup d'œil
  dans une rame bondée.
- **La carte cadre le tronçon en cours**, elle ne suit pas la position : sous
  terre elle resterait figée là où le signal s'est perdu. `NavMapState` porte
  donc une **emprise** en plus d'une caméra, et les deux guidages la remplissent
  différemment — le piéton conduit la caméra relevé par relevé, les transports
  cadrent d'un bloc. Le cadrage n'est rejoué qu'au changement de jeton, sans
  quoi la carte relancerait son animation à chaque battement d'horloge.
- **Les sorties de station viennent du jeu ouvert « acces » d'IDFM**
  (`exits.ts`) : 2 523 accès, chacun avec son numéro, la rue qu'il dessert et
  ses coordonnées, sans clé et en origine croisée autorisée — mesuré. La sortie
  retenue est **celle qui rapproche le plus de la suite du trajet**, et non la
  plus proche du quai : à Gare de Lyon, « r. de Chalon » et « Ministère de
  l'Économie » sont à trois cents mètres l'une de l'autre, se tromper coûte plus
  que de n'avoir rien dit. Vérifié : deux directions opposées donnent bien deux
  sorties opposées.
- **Pas de sortie pour une correspondance souterraine** (`exitWanted`, testé
  dans `tests/transitExit.test.ts`). Descendre du RER A à Auber pour prendre le
  9 à Havre-Caumartin se fait par les couloirs : annoncer « Sortie 1 — r. du
  Havre » y envoyait dehors (capture du 18 septembre 2026). Règle générale :
  sortie vers un bus, un tram ou l'arrivée ; pas de sortie vers un métro, un
  RER ou un train, **sauf** si la marche passe par la rue — Navitia la calcule
  alors sur la voirie (`street_network`, `TransitLeg.connection === false`) au
  lieu d'une correspondance déclarée (`transfer`). Ni la zone de
  correspondance d'IDFM (Auber et Havre-Caumartin sont dans deux zones) ni le
  type Navitia ne disent « couloir » à coup sûr : Javel (RER C ↔ métro 10)
  traverse une rue en `transfer`. La sortie cède alors la place à « Suivre
  « Correspondance » Métro 9 » (`connectionTo`, demande explicite) : c'est le
  fléchage de la station qui guide, jusqu'à l'autre quai.
- **L'heure écrite dans « La suite » est celle du geste** (`clockOf`) :
  l'arrivée pour « Descendre à… », le départ pour « Prendre… ». L'instant où
  l'action devient courante (`at`) n'est pas une heure à lire.
- **La fiche d'un arrêt de bus ouverte en route montre la ligne à prendre**
  (`setJourneyStopHints`) : un arrêt peut avoir deux poteaux à 60 m, chacun pour
  une ligne ; la fiche du plus proche annonçait celle qu'on ne prenait pas.
- **La recherche est réservée aux modes fermés** (métro, RER, train). Mesuré :
  un arrêt de bus quelconque de Paris a presque toujours une bouche de métro à
  moins de 350 m, et proposer « sortie 4 » à quelqu'un qui descend d'un bus
  l'enverrait sous terre alors qu'il est déjà dehors. Elle n'est faite qu'au
  moment où l'indication va servir, jamais pour tout le trajet d'avance.
- **La simulation accélère l'horloge**, et non une position : c'est le temps qui
  fait avancer un trajet en transports. Vingt fois la vitesse réelle — un trajet
  de vingt minutes se déroule en une minute. Comme pour la marche, elle n'existe
  qu'en développement.
- **Les arrêts desservis sont conservés par le parseur** (`stops` dans
  `TransitLeg`) : Navitia les envoie de toute façon, avec leurs coordonnées et
  leurs horaires. Les garder ne coûte rien et donne le décompte des arrêts
  restants comme le recalage par le GPS.
- **Rien n'est enregistré** : un trajet en transports ne produit ni fiche de fin
  ni entrée d'historique, à la différence de la marche. C'est un choix, pas un
  oubli.

#### Mode course (`src/navigation/running/`)

Un bouton orange sous le burger lance une course : la position et la vitesse
sont capturées, puis une fiche de fin — durée, distance, allure, dénivelé et
**graphe de l'allure** — et l'enregistrement dans l'historique, tracé et textes
en orange.

- **Pas de service Android, l'écran reste allumé** (demande explicite, en
  prenant Colota pour modèle de capture) : `useWakeLock` pendant toute la
  course, et le même `watchPosition` que la marche. Écran éteint ou autre
  application au premier plan, la capture s'interrompt et reprend au retour.
- **Capture façon traceur GPS** (`run.ts`) : un relevé toutes les **2 s** au
  plus, relevés de plus de **30 m** d'incertitude écartés, et la distance ne
  compte qu'au-delà de **la moitié de l'incertitude (2 m au moins)** depuis le
  dernier point compté (`minStepFor`). Un seuil fixe de 2 m ne suffisait pas :
  immobile en intérieur sur Pixel 8, 53 s de course comptaient 44 m de dérive.
- **Le temps de course exclut les pauses.** Chaque reprise ouvre un tronçon
  (`s` dans `RunSample`) : aucune allure n'est calculée à cheval sur une pause,
  et la distance ne saute pas entre le lieu de la pause et celui de la reprise.
- **La fenêtre « Modes » du menu burger** (`ModesSettings.tsx`, réglages dans
  `settings.ts`) coupe le bouton de course, et la fiche de fin de la marche comme
  celle de la course, séparément. **Sans fiche, le trajet s'enregistre quand
  même** (demande explicite) : la marche se ferme aussitôt, la course efface son
  tracé, et `addProfile` reçoit un rappel vide pour que l'arrivée du dénivelé ne
  rouvre pas la fiche.
- **Le lancement demande confirmation** (demande explicite) : le bouton rond
  ouvre une petite fenêtre dans le voile commun (`.modal-backdrop`) — un bouton
  de 44 px n'a pas de place où déplier la confirmation sur place.
- **Arrêter moins de 45 s après le lancement n'ouvre pas de fiche et
  n'enregistre rien** (`MIN_RUN_MS`, mesuré en temps réel depuis le lancement,
  pauses comprises) : c'est un départ par erreur.
- **Une course est un `Trip` de `kind: "run"`**, dans la même base que les
  marches (champs `samples` et `pausedSeconds` en plus) : un trajet sans `kind`
  est une marche, ce qui garde lisibles les historiques existants. Le titre et
  le libellé en tiennent compte (`tripListTitle`, `routeLabel`).
- **Le tracé en direct passe par `NavMapState.trace`, pas par la prop `route`** :
  chaque changement d'itinéraire recadre la carte, et un tracé qui s'allonge
  toutes les deux secondes la ferait sauter d'autant. `MapView` lui donne sa
  propre source, reposée après chaque changement de style.
- **Le graphe de l'allure a l'axe vertical inversé** (le plus rapide en haut),
  la moyenne en pointillés, un domaine bâti du 5ᵉ au 95ᵉ centile pour qu'un
  arrêt au feu n'écrase pas tout, et un verdict de régularité (écart-type
  rapporté à la moyenne : 4 %, 8 %, 15 %).
- **La carte suit le coureur au nord** (la flèche pivote, pas la carte) ; un
  geste sur la carte arrête le suivi, « Recentrer » le rend.

#### Musique en cours pendant le guidage (`src/navigation/music/`)

Un encart au-dessus de la barre du bas, dans les trois guidages : pochette,
titre, artiste, et pause / précédent / suivant.

- **Il n'existe que s'il y a de la musique.** Pas de bouton pour l'ouvrir, pas
  de place réservée : une musique lancée en route le fait apparaître, un lecteur
  fermé ou arrêté le fait disparaître. En pause, il reste. C'était la demande
  explicite — ne pas y ajouter d'interrupteur.
- **Sans l'accès, un message remplace l'encart** : il renvoie à Paramètres ›
  Navigation, et une croix le masque pour le reste de la navigation (il revient
  à la suivante, le panneau étant remonté à chaque départ). Sans lui, l'encart
  n'apparaîtrait jamais et rien ne dirait pourquoi. Le greffon envoie donc
  `permission` avec chaque état, et le magasin le tient à côté du morceau.
- **La colonne de droite se range au-dessus de ce que la colonne du bas occupe
  vraiment.** Son décalage pendant la navigation était un nombre fixe (96 px),
  pensé pour la barre seule : sur Pixel 8, le bouton de position mordait déjà de
  12 px sur la barre, et l'encart de musique l'a recouvert. Chaque panneau pose
  désormais `useNavDockRef()` sur sa `.nav-dock`, qui publie la hauteur jusqu'au
  haut de l'encart (ou de la barre) ; `App` la lit par `useNavDockClearance()`.
  C'est un point de contact de plus avec le module, dans `App` — ne pas revenir
  à un nombre écrit à la main.
- **Le texte des paramètres dit à quoi sert l'accès et qu'aucune donnée n'est
  collectée** — demande explicite, en réponse à l'avertissement d'Android qui
  énumère tout ce que cet accès permettrait en théorie.
- **Tout lecteur, sans en connaître aucun** : le greffon natif `NowPlaying`
  (`apk/android/.../NowPlayingPlugin.java`) lit les sessions média d'Android
  (`MediaSessionManager`), ce qui couvre YouTube Music, Qobuz, Spotify ou un
  podcast. Il montre le lecteur qui joue, sinon le plus récent en pause.
- **Android exige « l'accès aux notifications »** pour voir ces sessions, même
  si aucune notification n'est lue : d'où le service vide
  `MediaNotificationListener` au manifeste, et la ligne « Musique pendant le
  guidage » des paramètres qui ouvre la bonne page des réglages et relit l'état
  au retour (`visibilitychange`). Sans cet accès, l'encart n'apparaît jamais.
- **L'écoute ne tourne que pendant un guidage** : `nowPlaying.ts` est un magasin
  de module qui démarre le greffon au premier abonné (l'encart, monté par les
  panneaux de guidage) et l'arrête au dernier. Le greffon la coupe aussi en
  arrière-plan.
- **Playlists et titres récents ne sont pas faits, et savoir pourquoi évite d'y
  perdre du temps** : aucune API Android commune ne les donne. YouTube Music n'a
  pas d'API publique et refuse les clients tiers de sa bibliothèque média
  (réservée à Android Auto) ; l'API de Qobuz est réservée aux partenaires.
  Spotify serait la seule voie propre (App Remote + Web API).
- **La pochette ouvre le lecteur** (demande explicite) : c'est le geste qu'on
  fait spontanément, et l'encart ne montre ni liste ni barre de progression —
  pour tout le reste, il faut l'application d'origine. Rien ne signale que c'est
  un bouton : la pochette est sa propre affordance, et un liseré de plus
  encombrerait un encart déjà dense.
- **Le greffon publie le nom de paquet en plus du libellé**, et c'est lui qui
  compte : « YouTube Music » ne désigne rien pour le système, seul
  `com.google.android.apps.youtube.music` permet de demander une intention de
  lancement (`getLaunchIntentForPackage`). `sameTrack` le compare donc aussi —
  deux lecteurs peuvent porter le même nom affichable, et c'est le paquet qui
  décide de ce qu'ouvre la pochette.
- **Un lecteur sans écran à ouvrir laisse le doigt sans effet**, plutôt que de
  faire échouer l'appel : certains services de fond n'ont pas d'intention de
  lancement. `openPlayer` rend alors `{ opened: false }` et la pochette reste ce
  qu'elle était. Une erreur à l'écran, au volant, coûterait plus que le geste
  perdu.

### Pastilles de ligne sur les arrêts (`services/idfmNetwork.ts`)

Les arrêts du réseau RATP et du Transilien affichent les pastilles de leurs
lignes (trois au plus, puis « + N ») au lieu du pictogramme de catégorie. Deux
jeux ouverts, sans clé : le référentiel des lignes réduit aux réseaux concernés
(cache `localStorage`) et `arrets-lignes` interrogé par zone via l'export, qui
accepte un filtre géographique et évite toute pagination.

- **« Transports » ne contient que des points de montée** : ni bouches de métro
  (redondantes avec leur station), ni stationnement (catégorie à part), ni
  services de mobilité (partis dans le fourre-tout). `isTransitStop` s'appuie
  dessus, donc la fiche des prochains passages ne s'ouvre que là où elle a un
  sens.
- **`mergeNearbyStops` (dans `tilePois.ts`) réunit les arrêts de même nom et de
  même mode à moins de 300 m** : une grande gare est décrite par plusieurs
  objets OSM. Garder la contrainte de mode (un bus n'est pas un métro) et celle
  de distance (« Mairie » nomme des dizaines d'arrêts).
- **Les arrêts de bus n'apparaissent qu'à partir de `MIN_ZOOM_FOR_BUS_STOPS`**
  (14, le zoom d'ouverture, depuis le 19 septembre 2026 — demande explicite :
  la carte s'ouvrait sur la position sans une pastille). Ils sont des milliers à
  Paris : interroger leurs lignes sur toute la vue coûtait 400 Ko au zoom 14. Le
  ferré est donc lu sur 10 km, les bus **à part**, sur
  `IDFM_BUS_LINES_MAX_RADIUS` (1,5 km, 110 Ko à Châtelet) : un poteau plus
  lointain garde son pictogramme jusqu'à ce qu'on s'en approche.
- **Le rattachement est filtré par mode** (`MODES_BY_FAMILY`) : sans ce filtre
  une gare hérite des bus voisins, qui portent presque le même nom à quelques
  dizaines de mètres. Le nom exact prime et porte jusqu'à 250 m — une gare
  d'échange s'étale — le reste se limite à 90 m.
- **Les images sont fabriquées à la demande** et nommées d'après les lignes
  (`lineMarkerImageId`) : deux arrêts aux mêmes lignes partagent une image.
  `hasImage` suffit à les réinstaller après un changement de style.
- L'enrichissement est **asynchrone et facultatif** : la carte s'affiche avec
  les pictogrammes de catégorie, les pastilles s'y substituent à l'arrivée de
  la réponse. Ne pas faire attendre le rendu pour ça.

Le dépli d'une ligne remonte jusqu'à `App` (`focusedLine`) puis à `MapView`,
qui trace la ligne sur la carte à sa couleur. Le tracé vient d'un troisième jeu
ouvert (`getLineShape`), demandé à la volée et gardé en mémoire pour huit
lignes : un tracé de RER approche les six cents kilo-octets, il n'a rien à faire
dans `localStorage` ni dans un préchargement.

### Encart météo (`services/weather.ts`)

Trois sources derrière un même encart, en haut à droite :

- **Open-Meteo** pour le relevé du moment et pour la qualité de l'air et les
  pollens (données européennes CAMS) : gratuit, sans clé, origine croisée
  autorisée. Rien à prévoir de plus.
- **la BAN** (déjà utilisée par le géocodage) pour nommer l'endroit et en tirer
  le **département** : le code INSEE de la commune commence par lui (`75104` →
  `75`, `97411` → `974`), et c'est la maille de la vigilance.
- **Météo-France** (`portail-api.meteofrance.fr`) pour les vigilances, derrière
  une clé gratuite et facultative. Ne pas chercher à la remplacer par
  **MeteoAlarm** : ses flux européens n'envoient aucun en-tête d'origine
  croisée — mesuré — et sont donc hors de portée d'un navigateur.

  La forme de la réponse a été **vérifiée sur un relevé réel** (1er septembre
  2026) : `product.periods[]` porte deux échéances (« J », « J1 »), et
  `timelaps.domain_ids[]` une centaine de domaines. Trois choses à en retenir :
  la couleur **1 est le vert**, c'est-à-dire l'absence de vigilance et non une
  alerte de plus ; le domaine `FRA` est le résumé national, à ne pas confondre
  avec un département ; et un département côtier est décrit par **deux**
  domaines, le sien et une bande littorale numérotée `<département>10`
  (`3410` pour l'Hérault) qui porte seule les vagues-submersion — les deux sont
  lus et la couleur la plus forte l'emporte.

  **Une clé API seulement** (en-tête `apikey`). L'identifiant et le secret
  d'application, avec leur jeton `client_credentials`, ont été **retirés le
  17 septembre 2026, à la demande de l'utilisateur** : trois champs pour un
  service embrouillaient l'écran des clés. Ne pas les réintroduire. Leur point
  d'authentification (`portail-api.meteofrance.fr/token`) répond au préflight
  sans en-tête d'origine croisée — mesuré — et demandait un relais ;
  l'endpoint de vigilance, lui, accepte `apikey` depuis n'importe quelle
  origine et s'appelle directement.

  **La section vigilance n'apparaît que s'il y a une vigilance en cours.**
  Silence de la source, absence de clé, lieu hors de France et beau temps se
  disent donc de la même façon : rien. Ne pas y remettre de phrase de repli
  (« aucune vigilance », « ajoutez une clé… ») — l'encart parle du temps qu'il
  fait, pas de sa propre configuration, et ces lignes occupaient la place sans
  rien apprendre.

Points à connaître :

- **Les vigilances font exception à la règle du dépli** : elles sont cherchées
  avec le relevé, parce que la pastille de l'encart replié doit prévenir sans
  qu'on ouvre quoi que ce soit — une alerte qu'il faut aller chercher ne sert à
  rien. Elle prend la couleur officielle du niveau le plus grave, les
  vigilances arrivant triées par gravité.
- **Le reste de ce qui coûte un appel n'est demandé qu'au dépli** : l'encart
  replié ne connaît que la température, le code temps et les vigilances. Le panneau est un composant à
  part (`WeatherPanel`), monté à l'ouverture et **remonté quand le lieu
  change** grâce à sa clé — les relevés d'un lieu ne s'affichent ainsi jamais
  sous le nom d'un autre.
- **Le lieu observé est décidé par `App`** : le lieu sélectionné s'il y en a
  un, sinon la position, sinon le centre par défaut. C'est ce qui fait
  qu'ouvrir une rue de Lille depuis Paris donne la météo de Lille, et que
  refermer la fiche rend celle de Paris. L'encart déplié nomme toujours
  l'endroit, faute de quoi ce repli serait trompeur.
- **Les relevés sont mis en cache par lieu arrondi à deux décimales et par
  tranche de dix minutes** : la météo ne change pas d'un pâté de maisons à
  l'autre, et l'encart se rouvre bien plus souvent que le temps ne tourne.
- **Les seuils de pollen sont indicatifs et propres à chaque espèce** (quelques
  grains d'ambroisie pèsent plus que la même quantité de bouleau) ; les espèces
  à zéro sont tues, sans quoi la liste afficherait six lignes vides en hiver.
- Les couleurs de l'indice européen (EAQI) sont **les couleurs officielles** :
  elles permettent de comparer deux villes d'un coup d'œil, ne pas les
  remplacer par la palette de l'application.

### Boussole (`CompassButton`, sous l'encart météo)

Une aiguille qui **dit** où est le nord et qu'un clic **y ramène**. Les deux
usages tiennent dans le même objet, et c'est ce qui justifie qu'elle reste
visible carte au nord : un bouton qui n'apparaîtrait qu'une fois la carte
tournée ne se laisse pas chercher, et l'aiguille reste utile en 3D, où
l'inclinaison brouille les repères. Carte déjà au nord, elle s'efface un peu
(`is-aligned`) sans disparaître.

- **L'encart météo et la boussole partagent une colonne** (`.map-dock`), au
  lieu d'être positionnés chacun de son côté : la boussole doit rester *sous*
  la météo, y compris quand celle-ci se déplie et pousse tout vers le bas.
  `.weather` a donc perdu son positionnement absolu au profit du conteneur.
- **La colonne entière s'efface pendant un itinéraire**, comme le faisait déjà
  la météo seule : sur un téléphone, le panneau d'itinéraire s'étend jusqu'au
  bord droit et son bouton de fermeture se trouve exactement là.
- **Le cap est tenu par `App`, pas par `MapView`** : c'est la boussole qui le
  montre. Il remonte par `onBearingChange`, **arrondi au degré** et seulement
  quand il change — chaque valeur distincte coûte un rendu de l'application
  pendant tout le geste de rotation.
- **La remise au nord suit le patron de `flyTo`** : `northRequest` est une
  valeur dont chaque changement déclenche l'effet, et non un appel impératif —
  la carte est créée une fois, les props pilotent des effets.
- **Seul le cap est remis, pas l'inclinaison.** En 3D, se réorienter ne veut
  pas dire renoncer au relief qu'on est en train de regarder.
- L'aiguille est un dessin à deux pans, pas un triangle : une flèche simple se
  lirait comme une direction de déplacement — celle du curseur de position,
  déjà présente sur la carte.

### Géocodage : Photon, puis la BAN

`searchPlaces` et `reverseGeocode` basculent sur la Base Adresse Nationale
(service public français, sans clé) quand Photon échoue — l'instance publique de
Photon est tombée pendant le développement et emportait toute la recherche. La
BAN ne connaît que les adresses, voies et communes : c'est un filet, pas un
remplacement, et ses identifiants (`ban/…`) ne sont pas des références OSM, donc
aucune fiche n'ira y chercher d'horaires.

**Une réponse ne vaut que pour la saisie qui l'a demandée** (`usePlaceSearch`).
Chaque frappe interrompt la recherche de la précédente (`AbortController`,
passé jusqu'à `searchPlaces`) : une réponse lente à « gare de ly » arrivait
sinon après celle à « gare de lyon » et l'écrasait. Les résultats précédents
restent affichés pendant qu'on tape, pour que la liste ne clignote pas.

### Recherche sur le web (`services/webSearch.ts`, `services/webPlace.ts`)

**OSM n'a pas tout** — le McDonald's ouvert le mois dernier. La barre de
recherche propose donc toujours, **en dernier et dès deux lettres**, « Chercher
… sur le web » (demande explicite). Mesuré avant de choisir : les services de
lieux gratuits sans carte bancaire (Stadia/Foursquare) ne retrouvaient qu'un
tiers des McDonald's absents d'OSM ; HERE exige une carte. Le web trouve tout.

- **Dans l'APK, un navigateur intégré** : greffon natif `WebSearch`
  (`apk/android/.../WebSearchPlugin.java`), une fenêtre plein écran et un
  bandeau en bas. Dans un navigateur, un simple onglet.
- **Les réglages de confidentialité de DuckDuckGo sont passés dans l'adresse**
  (`DUCKDUCKGO_PRIVACY`, demande explicite : « tous les paramètres de
  confidentialité », pas de localisation), à chaque ouverture puisque les
  cookies sont effacés. Relevés sur la page des réglages (la documentation n'en
  liste qu'une partie) : `kat` emplacement, `kac` suggestions de saisie, `kbg`
  Duck.ai, `kbe` Search Assist, `kbn` aperçu vidéo, `k1` publicités, `kak` `kax`
  `kaq` `kap` `kao` `kau` `kpsb` promotions et demandes d'avis — tous coupés ;
  `kg=p` (POST), `kd=1` (redirection), `k5=-1`, `kbj=1`. **`kz` (réponses
  instantanées) reste allumé** : la fiche du lieu en est une. **`kbk=waze`** :
  le lien Waze de « Itinéraires » n'est jamais ouvert et porte les coordonnées,
  sans le choix intermédiaire « Google Maps / Waze ». La **mesure d'audience**
  (`improving.duckduckgo.com`, 24 envois par page de résultats) ne dépend
  d'aucun réglage : elle est bloquée avec les hôtes Google (`WEB_BLOCKED_HOSTS`).
- **Un lieu retrouvé change le bandeau de couleur** (demande explicite : noir
  sur noir avec un bouton bleu, il ne se repérait pas) : fond de la couleur
  d'accent, 📍, texte blanc, bouton « Voir sur la carte » blanc, et une montée
  de 220 ms à l'apparition seulement. Sans lieu, un gris à peine relevé
  (`raised`) le sépare de la page sans attirer l'œil.
- **Retrouver le lieu sans copier-coller**, trois voies, par ordre de
  confiance : ce que la page déclare (schema.org, balises de position, un
  **unique** lien de carte, une **unique** adresse — une page qui en décrit
  plusieurs ne propose rien) ; un lien « Itinéraire » **touché** vers Google
  Maps, Plans, Waze, OSM, Bing ou HERE, qui n'est **pas ouvert** — sa position
  est lue dans son texte ; une adresse **sélectionnée**, géocodée (`geocodeAddress`). Un geste de l'utilisateur l'emporte sur ce que la page déclare.
  « Voir sur la carte » rend le lieu à `handleSelect` de la barre : fiche,
  historique, ou réponse à « Maison ».
- **La décision se prend côté web** (`webPlace.ts`, fonctions pures testées
  dans `tests/webPlace.test.ts`) ; le greffon affiche et transmet. Le script
  injecté ne fait que relever. Les motifs de liens et d'hôtes bloqués sont
  **définis en TypeScript et passés au greffon** : une seule liste.
- **Rien pour Google, et rien de l'utilisateur** : aucune requête vers un hôte
  Google, page ou ressource (`WEB_BLOCKED_HOSTS` — polices, statistiques,
  cartes et vidéos intégrées ; une page qui en dépend s'affiche moins bien) ;
  géolocalisation, caméra et micro refusés aux pages ; pas de cookies tiers ;
  aucun schéma autre que http(s) ; Safe Browsing coupé ; cookies effacés et
  stockage des sites supprimé (sauf `localhost`, l'application) à la
  fermeture. **L'adresse sélectionnée est géocodée sans la position de
  l'appareil** (`DEFAULT_CENTER`) : une adresse de page porte sa ville.
  Ce qui part : la recherche tapée (DuckDuckGo), les pages ouvertes (leurs
  sites), l'adresse retenue (Photon ou BAN).
- **Une adresse de page se nettoie, et la BAN prend le relais quand Photon ne
  rend rien** (`cleanAddress`, `geocodeAddress`) — pas seulement quand il
  échoue. Vérifié sur le téléphone : la fiche DuckDuckGo du McDonald's de
  Montussan (absent d'OSM) mène, par « Itinéraires » → Google Maps, à
  `google.com/maps/dir/?api=1&destination=3 Rte de Lalande Nationale 89,
  Montussan, FR 33450` ; le lien n'est pas ouvert, mais Photon ne trouvait rien
  à cette adresse brute. Nettoyée, Photon la trouve ; la BAN, elle, rend le bon
  numéro dès l'adresse brute (score 0,52, seuil `BAN_MIN_SCORE` 0,4).
- **La fiche DuckDuckGo d'un lieu unique est lue** (`card` dans le script,
  `cardCandidate`) : `article[data-testid="maps-vertical-detail"]`, son titre et
  ses `dd`. L'adresse y est reconnue à sa forme (chiffres, lettres, virgule), pas
  à son libellé, qui suit la langue. Le lieu est donc proposé **dès la page de
  résultats**, sans geste, avec son nom ; et un lien « Itinéraire » ou une
  adresse sélectionnée sur la même page **reprennent ce nom** (`pageName`) — le
  lien d'itinéraire ne porte que l'adresse. Coût : quelques lectures du DOM, trois
  fois par page, dans le script qui tournait déjà.
- **Un lien Google raccourci** (`maps.app.goo.gl`) n'est pas lisible sans
  interroger Google : il est refusé et le bandeau dit de sélectionner
  l'adresse. Ne pas le « résoudre ».
- **La barre reconnaît aussi un lien de carte ou des coordonnées collés**
  (`pointFromText`) : ligne « Point collé », sans aucune requête.
- **Un lieu du web a un identifiant `web/lat,lon`** : ce n'est pas une
  référence OSM, la fiche ne cherche ni horaires ni détails ; téléphone et site
  viennent de la page quand elle les déclare.
- **Limites connues** : le stockage des sites est supprimé par
  `WebStorage.deleteOrigin`, dont Android ne garantit pas qu'il couvre tout
  (IndexedDB) ; le cache HTTP n'est pas vidé, il est commun avec la carte.

### Liens reçus d'une autre application (`services/incoming.ts`)

**Toucher « Itinéraire » ailleurs ouvre MY OSM** (demande explicite) : sur un
site, dans un message, un contact, une réponse de moteur de recherche, Android
propose MY OSM, et « Toujours » en fait l'application par défaut.

- **Ce qui est déclaré au manifeste** : les liens `geo:` (montrer un lieu) et
  `google.navigation:` (l'intention « naviguer » que beaucoup d'applications
  lancent), les liens web de Google Maps, Plans, OSM, et le **partage de texte**
  (`text/plain`).
- **Les liens web ne s'ouvrent pas seuls** : Android réserve un domaine à
  l'application vérifiée pour lui (Google Maps pour `google.com`), et n'en confie
  un à une application non vérifiée que si l'utilisateur l'autorise dans
  « Ouvrir par défaut ». Les liens `geo:` et `google.navigation:`, eux, passent
  par le choix d'application ordinaire.
- **Un seul chemin** : `MainActivity` réécrit un partage (`ACTION_SEND`, que le
  greffon `App` ne relaie pas) en `myosm-share:?text=…`, et tout arrive par
  `appUrlOpen` / `getLaunchUrl`. Capacitor émet l'intention de départ **par les
  deux** : `useIncomingLinks` ignore une même adresse reçue deux fois en
  5 secondes. L'adresse d'ouverture ne change pas la page chargée (vérifié dans
  `Bridge.java` : seul `startPath` le fait).
- **Ce qu'on en fait** : une position se lit dans le lien, une adresse se
  géocode sans la position de l'appareil (`geocodeAddress`) ; un lien qui
  demande un itinéraire (`isNavigationLink` : `google.navigation:`, `/maps/dir/`,
  `daddr`, `destination`, `navigate=yes`) ouvre l'itinéraire depuis la position,
  un autre ouvre la fiche. Un texte partagé : lien lisible d'abord, sinon première
  ligne = nom et reste = adresse ; un texte qu'on ne sait pas placer part en
  **recherche sur le web**. Un lien Google raccourci est ignoré, le texte qui
  l'accompagne sert à sa place.

### Détails d'un lieu (horaires, téléphone, adresse)

Absents des tuiles, ils sont demandés à l'ouverture d'une fiche et pour ce seul
lieu (`services/overpass.ts`, malgré son nom : une instance Overpass, puis l'API
OSM, puis les autres instances — les deux sources rendent le même JSON). Les
sources ne sont pas essayées en série mais **ajoutées une à une** : la suivante
démarre si les précédentes n'ont rien rendu au bout de `OVERPASS_HEDGE_MS`, la
première réponse gagne, les perdantes sont abandonnées. Les réponses sont mises
en cache.

La clé est l'identifiant `type/id` : les POI de tuile la tirent de l'entité, et
`geocode.ts` la reconstruit depuis les initiales de Photon (`N`/`W`/`R`) — sans
quoi les résultats de recherche n'auraient jamais de détails.

**La fiche s'ouvre partout, mais son contenu se règle sur le lieu.** Un clic
dans le vide fabrique bien un lieu à partir du point cliqué
(`handleBackgroundClick` + géocodage inverse pour le nommer) — c'est ce qui
permet de partager un point ou d'y tracer un itinéraire. En revanche
l'**encart d'horaires est réservé aux lieux classés** (`place.group !== null`,
voir `showHours` dans `PlaceSheet`) : une rue ou un point au hasard n'ouvre ni
ne ferme, et « horaires non renseignés » y était du bruit. La réserve saute si
OSM connaît malgré tout des horaires pour cet objet.

`App` retient l'état avec la réponse (`loading` / `done` / `error`) : la fiche
distingue une recherche en cours, un lieu sans horaires dans OSM et une source
injoignable. Ne pas retomber sur un simple booléen — « non renseigné » et
« indisponible » ne veulent pas dire la même chose à l'utilisateur. Un échec est
retenté si l'utilisateur rouvre la fiche.

**La poignée de la fiche la referme d'un glissement vers le bas**
(`.sheet-grab`, `handleGrab*` dans `PlaceSheet`). La fiche suit le doigt par un
`transform` écrit directement sur l'élément — pas d'état React, un rendu par
mouvement ferait saccader le geste — et se ferme au lâcher au-delà d'un tiers de
sa hauteur (120 px au plus) ou d'un geste vif ; sinon elle remonte. La zone de
prise dépasse largement la barre dessinée (36 × 5 px ne se visent pas au doigt)
et porte `touch-action: none`, sans quoi la WebView prend le geste pour un
défilement. Un `pointercancel` ne ferme jamais.

### Lieux enregistrés (`hooks/useBookmarks.ts`)

Même patron que les autres réglages persistés : clés `osm-local:bookmarks` et
`osm-local:bookmarks-visible`, lecture tolérante aux pannes, et **filtrage de
ce qui est relu** — un dossier sans identifiant ou un lieu sans coordonnées est
écarté plutôt que de faire échouer toute la relecture. Points à connaître :

- **Deux états, tous deux persistés** : les dossiers, et ceux qui sont allumés.
  Allumer un dossier est ce qui pose ses points sur la carte ; le déplier ne
  fait que montrer sa liste. Ne pas confondre les deux gestes, ils répondent à
  des besoins différents.
- **Un lieu n'appartient qu'à un dossier** : `savePlace` le retire des autres,
  sans quoi il apparaîtrait deux fois sur la carte. C'est ce qui permet à la
  fenêtre d'enregistrement de servir aussi à déplacer un lieu.
- **Enregistrer un lieu allume son dossier** : un signet qu'on vient de poser
  doit se voir.
- **Un dossier « Favoris » existe d'office** (`DEFAULT_FOLDER_ID`) et
  `deleteFolder` refuse de le supprimer : enregistrer ne doit jamais commencer
  par une corvée, et la fenêtre d'enregistrement suppose au moins un dossier.
  Le refus est dans le hook, pas seulement dans l'interface, pour qu'aucun
  appel ne puisse contourner la règle. La suppression des autres dossiers
  **passe par une confirmation** qui nomme le dossier et compte ses lieux : ce
  qu'il contient représente parfois des mois de repérages.
- Les points enregistrés sont dessinés par des **marqueurs du DOM**
  (`MapView`), comme le départ et l'arrivée d'un itinéraire, et non par une
  couche de plus : ils sont quelques dizaines au plus, et survivent ainsi aux
  changements de style sans réinstallation. Leur clic **arrête la propagation**,
  sinon la carte le prend pour un clic dans le vide et referme la fiche qui
  vient de s'ouvrir.

### filters.ts, source unique des catégories

Un `FilterGroup` déclare au même endroit : les tags OSM (pour la requête
Overpass), la fonction `match` (pour le classement côté client), la couleur et
le pictogramme. **L'ordre de `FILTER_GROUPS` compte** : `groupFromTags` retient
le premier groupe qui correspond, donc les groupes spécifiques doivent précéder
le fourre-tout `shop`. Les icônes sont des `IconNode` au format Lucide recopiés
dans le fichier (et non importés de `lucide-react`) parce qu'ils sont rendus des
deux côtés : en React dans `FilterMenu`, et redessinés sur canvas via `Path2D`
dans `utils/markerImage.ts` pour les pastilles de la carte. Ajouter ou modifier
une catégorie ne touche que ce fichier. Deux règles à respecter en y touchant :
les groupes précis passent avant les génériques (le premier qui reconnaît un
lieu l'emporte), et « Autres commerces & services » — qui accepte n'importe
quel `shop` — reste en dernier.

### MapView et les changements de style

`MapView` est le seul pont impératif vers MapLibre : la carte est créée une
fois, les props suivantes pilotent des effets. Points de vigilance :

- `map.setStyle(..., { diff: false })` **détruit sources, couches et images**.
  `installMapLayers()` doit donc être rappelé sur `style.load` après chaque
  bascule thème/satellite, et il réinstalle aussi les images de marqueurs.
- Les pictogrammes du fond de carte sont masqués par `source-layer === "poi"`
  (repérage par source-layer, pas par identifiant, pour survivre à une
  régénération du style).
- Les handlers et données lues dans les callbacks MapLibre passent par des refs
  (`placesRef`, `onSelectRef`…) : les listeners sont installés une seule fois.
- Les POI de la carte sont tenus par `MapView` (une ref, pas un état) : la carte
  est leur source. Ils sont relus sur `moveend` et sur `sourcedata` de la source
  vectorielle, avec un regroupement de 120 ms.
- La vue 3D est une inclinaison de caméra *plus* le relief des bâtiments : les
  extrusions sont déjà dans le style (couche `building-3d`). Hors 3D,
  `applyBuildingRelief` **éteint** cette couche (une extrusion reste visible en
  volume à pitch 0, projection perspective) et prolonge le remplissage plat
  au-delà du zoom 14, où le style le coupe. Ne pas revenir à une hauteur nulle :
  la couche continuerait de faire calculer murs et toits pour chaque tuile.
- **Tout ce qui touche au style s'applique sur `style.load`, jamais sur `load`** :
  `load` n'arrive qu'après la peinture des premières tuiles, ce qui laissait voir
  les bâtiments en relief au rechargement de la page. Un seul gestionnaire
  `style.load` sert au démarrage et à chaque changement de fond de carte.
- Hors 3D, `maxPitch` est aussi remis à 0 pour que le geste d'inclinaison ne
  contredise pas le menu.

### Relief (`hooks/useRelief.ts`, `applyRelief` dans `MapView`)

Une **seule source d'altitude** sert les deux usages : la couche `hillshade`
l'ombre à plat, `setTerrain` la met en volume quand la 3D est allumée. Ce sont
les tuiles « terrarium » d'AWS — gratuites, sans clé, mondiales, origine croisée
autorisée (mesuré). L'IGN publie bien un ombrage plus fin sur la France, mais
c'est une **image** : elle ne peut donner aucune altitude, donc aucun volume, et
s'arrête aux frontières. Une source qui fait tout vaut mieux que deux qui se
partagent le travail.

- **Le relief est un calque, pas un fond de carte** : il s'ajoute au plan comme
  à l'imagerie, et se combine à la 3D. Il a donc sa bascule propre dans le menu
  des calques, à côté de la 3D et non parmi les fonds.
- **La source est ajoutée et retirée avec la couche**, jamais simplement
  masquée : MapLibre télécharge les tuiles d'une source dès qu'une couche s'en
  sert, et celles-ci pèsent de 55 à 155 ko pièce — plus qu'une tuile
  vectorielle.
- **Éteindre le terrain avant de retirer la source.** Dans l'autre ordre,
  MapLibre continue de réclamer des tuiles à une source disparue et lève à
  chaque déplacement.
- **L'ombrage ne se pose ni tout en bas ni tout en haut de la pile**, et c'est
  le piège de cette couche. La première couche d'un style OpenMapTiles est un
  `background` **opaque** : un ombrage inséré avant elle est intégralement
  masqué, et la bascule paraît ne rien faire. Tout en haut, il salirait routes
  et libellés. `reliefAnchor()` cherche donc la première couche de voirie ou
  d'hydrographie — `waterway_tunnel`, index 14 dans Liberty comme dans le style
  sombre — ce qui pose l'ombrage **au-dessus des aplats de terrain et sous
  l'eau, les voies et les étiquettes**. Sur la vue satellite, l'ancre est
  `satellite-labels`.
- **Le volume suit le relief, pas la vue 3D.** Allumer le relief donne déjà une
  légère profondeur (`TERRAIN_EXAGGERATION_FLAT`) ; la 3D ne fait qu'accentuer
  le geste en inclinant la caméra. Deux réglages distincts, parce qu'une
  exagération pensée pour une caméra inclinée fait paraître la carte gondolée
  vue de dessus.
- **Les courbes de niveau viennent de l'IGN, pas d'un calcul local.** Elles
  disent la raideur d'une pente — serrées, ça grimpe — et sont servies déjà
  dessinées par la Géoplateforme, en PNG transparent (le JPEG est refusé par le
  service). L'autre voie était de les calculer dans le navigateur depuis le
  modèle d'altitude (`maplibre-contour`) : mondial, et sans un octet de
  téléchargement en plus puisque le MNT est déjà là. Elle a été écartée parce
  qu'il aurait fallu livrer une dépendance en version 0.1.0, un worker et un
  protocole **sans jamais les avoir vus tourner** — l'environnement de
  développement n'a pas de navigateur. Une couche raster dont on a regardé une
  tuile vaut mieux qu'une bibliothèque supposée. Elles sont donc **françaises
  seulement**, sur les mêmes emprises que l'orthophotographie, et le panneau de
  téléchargement le dit.
- **Les courbes et l'ombrage n'ont pas la même ancre, et c'est nécessaire.**
  L'ombrage décrit le sol : il va **sous** les voies (`reliefAnchor`, au-dessus
  des aplats). Les courbes sont un tracé qui doit se lire d'un trait : posées
  sous les rues, chaque voie croisée les hache et les deux dessins se disputent
  la lecture. Elles vont donc **au-dessus de toute la géométrie et sous les
  étiquettes** (`contourAnchor`).

  Viser la première couche `symbol` ne suffit pas : dans Liberty, **23 couches
  de ponts sont dessinées après elle** — les flèches de sens unique arrivent
  avant les ponts. `contourAnchor` cherche donc la dernière couche de géométrie
  (`boundary_disputed`, index 87) et se pose juste après ; vérifié sur le style
  clair comme sur le sombre, plus aucune géométrie ne passe au-dessus.
- Elles ne s'allument qu'à partir de `CONTOUR_MIN_ZOOM` — en vue large, les
  courbes d'un massif se touchent et noircissent la carte.
- **`LAYER` distingue deux couches servies par la même URL.** L'orthophoto et
  les courbes passent toutes deux par `data.geopf.fr/wmts` : sans ce test dans
  `tileRefFromUrl`, les unes seraient rangées hors ligne sous la clé des
  autres, et la vue satellite afficherait des courbes de niveau.
- **L'encodage a été vérifié sur de vraies tuiles** : altitude =
  `(R × 256 + G + B / 256) − 32768`. Relevé au Mont Blanc 4 779 m, à Chamonix
  1 041 m, en Méditerranée 0 m.
- Au téléchargement, le relief a la **même forme que le satellite** : une case
  à cocher et un curseur de zoom, et un plafond par zone (`reliefMaxZoom`)
  plutôt qu'une constante. La plage est resserrée (8 à 12) et le défaut bas,
  parce que **chaque cran quadruple le poids** : mesuré sur la France, 258 Mo
  au zoom 10, 997 au 11, 4,1 Go au 12 — soit, au 11, autant que la carte
  elle-même pour un simple ombrage.

### Calque « Trafic » (`services/traffic.ts`)

Le trafic routier français en direct, dans le menu des calques à côté du relief.
**Deux sources**, l'une publique et suffisante, l'autre facultative :

- **Bison Futé**, via le Point d'Accès National (`transport.data.gouv.fr`), au
  format DATEX II : les événements du réseau routier national — bouchons,
  accidents, chantiers, fermetures — avec leur gravité et leur description en
  français. Gratuit, sans clé, national, officiel, republié en continu.
- **TomTom** (facultatif, `VITE_TOMTOM_KEY`) : la couleur du débit sur les
  routes, en tuiles prêtes à poser. C'est ce qu'on imagine en disant « trafic »,
  et **aucune source publique française ne le rend** — voir plus bas. Le point
  d'accès est `traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png` (vérifié : il
  répond 401 sans clé, et non 404) ; son palier gratuit est de 200 000 tuiles
  par mois, sans carte bancaire.

Ce qui a été mesuré, et qu'il ne sert à rien de remesurer :

- **Un seul fichier agrège tout le pays** (`…/Evenementiel-DIR/grt/RRN/content.xml`) :
  11 564 enregistrements dont 2 576 localisés, soit 777 événements affichables ;
  4,3 Mo bruts mais **198 Ko compressés**. Rien à paginer, rien à filtrer côté
  serveur — on lit tout, l'emprise visible fait le tri à l'affichage.
- **Le flux n'envoie aucun en-tête d'origine croisée**, bien qu'il soit servi en
  HTTPS. Il est donc relayé par le serveur de développement (`vite.config.ts`,
  chemin `/api/traffic/events`) et `TRAFFIC_EVENTS_URL` est **relatif** — même
  piège que le jeton Météo-France : en absolu, cela fonctionne en ligne de
  commande et échoue silencieusement dans le navigateur. En production web, il
  faudrait un relais équivalent, une règle de reverse proxy d'une ligne. **Dans
  l'APK**, `relayedFetch` appelle le flux par le natif (`CapacitorHttp`,
  d'après `CONFIG.RELAY_TARGETS`) : vérifié sur le téléphone, 200 et les 4,8 Mo
  de XML, là où l'adresse relative rendait la page de l'application. Le greffon
  n'est **pas** activé pour tout `fetch` — les tuiles passeraient par le pont
  natif.
- **TRAFICOLOR a été écarté**, et il faut savoir pourquoi pour ne pas y revenir :
  c'est l'autre flux de Bison Futé, l'état coloré du trafic autour de seize
  agglomérations, rafraîchi toutes les trois minutes. Il désigne ses points de
  mesure par identifiant (`measurementSiteReference`) et **ne publie pas leur
  géométrie** — le référentiel n'est pas dans le dossier. Il n'y a donc rien à
  tracer.
- **Le jeu parisien « comptages-routiers-permanents » a été écarté aussi** :
  origine croisée autorisée et géométrie par tronçon, tout ce qu'il faut — mais
  mesuré, sa donnée la plus fraîche avait **dix-sept heures de retard**. Ce
  n'est pas du direct.
- **Le XML porte un préfixe de namespace** (`ns2:`) dans l'agrégat, absent des
  fichiers isolés. La lecture passe donc par `getElementsByTagNameNS("*", …)` et
  ne doit jamais chercher un nom de balise nu.
- **La description utile est celle dont le `commentType` vaut `description`.**
  Mesuré : 336 descriptions pour 2 200 `locationDescriptor` — « situé 6920 m à
  l'ouest de Le Sauze », qui redit ce que la carte montre. Prendre le texte le
  plus long, réflexe naturel, revient à afficher l'adresse à la place de
  l'événement.
- **Les numéros de route sont remplis de zéros** (`A0033`, `N0004`) : ils sont
  ramenés à la forme des panneaux.
- Les familles d'événements sont déduites des types DATEX II **réellement
  rencontrés** : `MaintenanceWorks` 225, `RoadOrCarriagewayOrLaneManagement` 171,
  `ReroutingManagement` 127, `VehicleObstruction` 61, `AbnormalTraffic` 30,
  `Accident` 8.

Points de conception :

- **Les sources sont ajoutées et retirées avec les couches**, jamais simplement
  masquées — même règle que le relief et Mapillary : MapLibre télécharge les
  tuiles d'une source dès qu'une couche s'en sert, et les tuiles de débit se
  renouvellent en permanence.
- **Un événement donne deux objets** : le point où il commence, et le tronçon
  qu'il affecte quand la source donne les deux bouts. Le tronçon dit à lui seul
  si le bouchon fait deux cents mètres ou six kilomètres.
- **Le débit se glisse sous les étiquettes** : il colore la chaussée, il ne doit
  pas recouvrir les noms de rue.
- **Le flux est relu toutes les trois minutes**, la cadence à laquelle la source
  republie ; le cache de `services/traffic.ts` partage la requête entre appels
  concurrents. Éteindre le calque arrête la relecture.
- **Rien de tout cela n'est mis en cache par le Service Worker**, conformément à
  la règle du projet : un bouchon périmé servi sans que rien ne le signale est
  pire que pas de trafic du tout.

### Photos de rue (Mapillary)

La carte ne porte que la **couverture** — couche `sequence` (lignes) et couche
`image` (points, à partir de `MAPILLARY_MIN_ZOOM_FOR_IMAGES`) des tuiles
vectorielles de Mapillary. La photo elle-même est demandée à l'API Graph par
son identifiant, **au clic**, et affichée par `StreetPhoto`. Points à
connaître :

- **Les sources sont ajoutées et retirées avec les couches**, jamais simplement
  masquées (`applyMapillary`) : MapLibre télécharge les tuiles d'une source dès
  qu'une couche s'en sert, et une couverture éteinte n'a pas à coûter de
  données. Elles sont réinstallées par `installMapLayers` après chaque
  changement de style, comme les autres couches applicatives.
- **Deux sources sur les mêmes tuiles, et c'est délibéré.** Mesuré sur Paris :
  une tuile **z14 pèse 1,5 Mo** sur le réseau (elle porte près de 40 000 points
  de prise de vue) contre **112 Ko en z13**, qui n'a que les séquences. Les
  séquences s'arrêtent donc à `MAPILLARY_SEQUENCE_MAX_ZOOM` (13) et MapLibre
  étire cette tuile au-delà ; les points ont leur propre source, bornée à z14,
  qu'une couche à `minzoom` 15 ne réclame qu'une fois entré dans la rue. Ne pas
  refondre les deux en une seule source : allumer la couverture coûterait alors
  un mégaoctet et demi par tuile dès le zoom 14.
- **La forme des données est vérifiée** sur une vraie tuile : couches
  `sequence` et `image`, et la propriété `id` d'un point est bien celle que
  l'API Graph attend (`captured_at` y est un horodatage en millisecondes,
  `thumb_1024_url` l'adresse de la vignette). Tuiles et API Graph autorisent
  toutes deux l'origine croisée.
- **Le clic suit un ordre** : un commerce d'abord, un point de prise de vue
  ensuite, le fond de carte en dernier. La carte se lit avant les photos.
- **La vue de rue est celle de `mapillary-js`**, le visualiseur officiel : rien
  d'autre ne donne la rotation de la caméra, les flèches de déplacement au sol,
  les virages aux intersections et les panoramas. Il pèse 2,5 Mo, d'où un
  **import dynamique** (module *et* feuille de style) à l'ouverture de la
  première photo : Vite en tire un fragment séparé, et le démarrage de la carte
  n'en porte rien. Ne pas le remonter en import statique.
- **Le visualiseur traverse le double montage de `StrictMode`, il ne le
  rejoue pas.** C'est le piège de ce composant, et il a coûté trois
  diagnostics : en développement React monte les effets deux fois, si bien
  qu'un démontage fait dans le nettoyage détruit une vue qui vient d'être
  construite. Elle continue de recevoir ses images — la trace le montrait — mais
  dans un conteneur vidé : **cadre noir**, puis **blanc** selon l'ordre des
  deux montages. D'où le montage : une ref garde le visualiseur, un garde
  (`buildingRef`) empêche d'en construire deux pendant que l'import est en
  vol, et le **démontage est différé d'un tour de boucle**, annulé si l'effet
  repart aussitôt. Ne pas « simplifier » cela en un nettoyage direct.
- **La feuille de style de la bibliothèque écrase la nôtre.** `mapillary-js`
  ajoute la classe `mapillary-viewer` **au conteneur qu'on lui passe**, et sa
  CSS — importée dynamiquement, donc injectée après `App.css` — y impose
  `position: relative`. À spécificité égale, elle gagnait : le conteneur
  perdait son calage absolu, repliait sa hauteur sur son contenu (zéro) et la
  vue se dessinait dans le vide, alors même que les images arrivaient. D'où le
  sélecteur `.street-photo .street-photo-viewer`, volontairement plus précis,
  qui redonne le calage **et** les dimensions. Ne pas le raccourcir.
- **Des traces de mise au point** (`trace`, actives en développement seulement)
  jalonnent le cycle : module chargé, taille du conteneur, visualiseur
  construit, image reçue. Une vue vide ne dit rien d'elle-même ; ces lignes
  disent où l'on s'arrête et ont permis de trouver ce qui précède.
- **Le visualiseur est créé une fois et déplacé ensuite** (`moveTo`) : le
  reconstruire à chaque point cliqué rejouerait le chargement WebGL. Il faut en
  revanche l'avertir des changements de taille (`resize()` au passage en plein
  écran), sinon il continue de dessiner à la taille du bandeau réduit. Son
  conteneur doit avoir une **hauteur explicite** : sans elle, il ne s'affiche
  pas du tout.
- **Le plein écran efface l'interface** : `App` tient `photoExpanded` et cesse
  de rendre menus, boutons, barre de recherche et fiche.
- **Le repère sur la carte suit la caméra, pas seulement la photo.** Le
  visualiseur émet `bearing` à chaque mouvement de souris et `image` à chaque
  changement de prise de vue : `App` ne **recentre** la carte que sur le second
  (recentrer à chaque degré la rendrait inutilisable) mais fait **pivoter** le
  cône sur le premier. Le marqueur est créé une fois puis déplacé, et son
  alignement est `map` — le cône appartient au sol, il doit suivre la rotation
  et l'inclinaison de la carte.
- **Le jeton est facultatif** (`VITE_MAPILLARY_TOKEN`) : sans lui l'option
  reste visible dans le menu d'affichage, mais inerte et expliquée — et
  `useMapillary` refuse de se rallumer au démarrage, un choix mémorisé du temps
  où le jeton existait n'ayant plus rien à afficher.

### Style sombre

`src/styles/appleDark.ts` est **généré, ne pas l'éditer à la main** (6000 lignes).
Il dérive du style OpenFreeMap Liberty en n'en recolorant que les couleurs, et
réutilise les mêmes tuiles vectorielles que le mode clair. Pour retoucher la
palette : constante `C` dans `scripts/build-apple-dark-style.mjs`, puis
`npm run build:dark-style` (le script télécharge Liberty, donc réseau requis).

### Icônes de l'application

**La source unique est `scripts/icon-source.png`**, une image fournie (demande
explicite du 16 septembre 2026), et `npm run build:icons` en tire *tout* :
le favicon, les icônes du manifeste web, les quinze fichiers du lanceur Android
et celle de la fiche F-Droid. Ne retoucher aucun de ces fichiers à la main —
le prochain passage du script les écraserait. ImageMagick (« magick ») est
requis et n'est pas une dépendance npm.

Le script couvre désormais le lanceur Android, que l'on éditait auparavant à
part : c'est ce qui garantit qu'une seule image vaut pour l'onglet du
navigateur comme pour l'écran d'accueil.

Deux choses ont changé de nature avec l'image, et il faut les connaître avant
d'y revenir :

- **Il n'y a plus de `favicon.svg`.** Le dessin d'avant était décrit en SVG dans
  ce même script — une maison aux proportions du logo Home Assistant, une carte
  aux couleurs de Plans, le dard de Mapillary — et une image matricielle n'a pas
  d'équivalent vectoriel. `index.html` pointe donc un PNG de 256 px, et le
  manifeste aussi. Le script supprime l'ancien SVG s'il le trouve : un fichier
  que plus rien ne régénère n'a pas à traîner.
- **La palette de 256 couleurs ne s'applique plus qu'aux petites.** Elle rendait
  les aplats d'avant à l'identique ; cette image-ci a des dégradés. Mesuré sur
  le 512 : la quantification divise le poids par cinq pour 2,2 % d'écart
  quadratique, et agrandie trois fois elle se voit — le ciel se marche en
  paliers, la route rose se mouchette, le bord du pont se déchire. D'où un
  partage : **couleurs pleines** pour ce qu'on regarde en grand (favicon,
  `icon-512`, `maskable`, et la copie F-Droid qui sert aussi de logo au README),
  **palette** pour les quinze rasters du lanceur Android, que le système dessine
  de 48 à 192 px et jamais au-delà — à cette taille, les deux sont
  indiscernables. Sans ce partage, les icônes pesaient 1,24 Mo à elles seules.

Le reste tient à la transparence : l'image a de **vrais coins transparents**.
Elle est donc aplatie sur du blanc partout où la transparence n'est pas admise
— écran d'accueil iOS, gabarits du lanceur — et gardée telle quelle pour
l'icône héritée d'Android, dont les coins arrondis sont bienvenus. La variante
`maskable` et le premier plan adaptatif occupent **85 % du gabarit**
(`ZONE_SURE`), centrés sur du blanc. Ce chiffre a été choisi en regardant les
deux extrêmes côte à côte : pleine bord, le cercle du lanceur ne laissait de la
carte que des éclats et frôlait la pointe du toit ; replié dans la zone sûre des
66,7 %, tout survivait mais petit et cerné de blanc. À 85 %, la découpe mord
dans la carte et pas dans le sujet. **Ne pas remettre ces deux-là pleine bord**
sans refaire la comparaison. Les deux icônes héritées, elles, ne changent pas :
le carré garde ses propres coins arrondis, et la ronde taille son cercle dans
l'image entière — l'y replier ajouterait la marge blanche qu'on a écartée.

Le dessin superpose une **maison** aux proportions du logo Home Assistant
(l'autohébergement), une **carte aux couleurs de Plans** et le **dard de
Mapillary** (tracé officiel, constante `MAPILLARY`). Quatre choses à ne pas
défaire en y touchant :

- **La carte est découpée par la maison, pas posée derrière elle**
  (`clipPath` sur `HOUSE`). C'est tout le propos : la carte est hébergée ici.
  Les tracés du fond débordent donc volontairement du cadre — c'est la
  silhouette qui les arrête, et non leurs extrémités.
- **La flèche sort de la maison par la droite.** La photo de rue déborde du
  cadre de la carte ; c'est pour lui laisser la place que la maison n'est pas
  centrée. Ne pas la faire rentrer dans la silhouette.
- **Le fond ne porte pas de curseur de position** : l'icône montre un
  territoire, pas un utilisateur. Et ses couleurs sont franches, pas pastel.
- **Le trait ardoise et la réserve blanche de la flèche sont structurels.** Le
  premier tient la silhouette à 16 pixels, où le détail intérieur se brouille ;
  la seconde — le tracé peint deux fois, contour blanc puis rouge — empêche
  cette forme ajourée de se confondre avec l'axe ocre et le toit qu'elle
  traverse.

Trois découpes sont produites : le carré arrondi (favicon, `icon-512`), le
carré pleine bord (iOS, dont le masque a le même rayon que le nôtre — le dessin
y tient tel quel) et la variante `maskable`. Cette dernière est nécessaire,
sans quoi le lanceur Android encadre l'icône de blanc, et elle **doit** être
réduite (72 %) : le dessin déborde largement de la zone sûre des 80 %. Les PNG
sont réduits à une palette de 256 couleurs — le dessin est en aplats, l'écart
est de 0,6 % pour un quart du poids.

### Cartes hors ligne (`services/offline/`, menu burger → « Téléchargement »)

Une zone téléchargée, c'est trois choses de natures différentes, et elles ne
vont pas au même endroit : les **tuiles** dans le Cache Storage, les **détails
de lieux** et l'**index de recherche** dans IndexedDB. Les premières sont
demandées par une URL, les seconds par du texte.

- **Les tuiles vectorielles s'arrêtent au zoom 14** (relevé dans le TileJSON
  d'OpenFreeMap) : au-delà, MapLibre étire les mêmes tuiles. Télécharger une
  ville, c'est donc aller jusqu'au 14 et pas jusqu'au 18 — c'est ce qui fait
  tenir Paris intra-muros dans une soixantaine de mégaoctets. Ne pas « corriger »
  ce plafond en le montant : il n'y a rien au-dessus.
- **Les tuiles sont rangées sous une clé normalisée**, sans le numéro de
  version daté que porte l'URL d'OpenFreeMap (`…/planet/20260830_080001_pt/…`).
  Sans cette normalisation (`services/offline/keys.ts`), une republication
  amont rendrait d'un coup toutes les zones invisibles. Corollaire à ne pas
  manquer : **la mise à jour d'une zone doit passer `refresh`** à
  `downloadRegion`, sinon chaque tuile est jugée déjà présente et la mise à
  jour ne change rien.
- **Les tuiles vivent dans OPFS, pas dans le Cache Storage**
  (`services/offline/blobStore.ts`) : un système de fichiers privé à l'origine,
  rangé en `kind/z/x/y` — une arborescence, parce qu'un dossier de plusieurs
  centaines de milliers d'entrées devient lent à parcourir. Le Cache Storage
  reste le **repli** des navigateurs sans OPFS, et `readAnywhere` consulte les
  deux : une zone prise avant la bascule ne doit pas devenir invisible du jour
  au lendemain.

  Ce que cela **ne fait pas**, et qu'aucune API web ne fait : survivre à un
  « effacer les données du site ». OPFS, Cache Storage et IndexedDB sont vidés
  ensemble. Ne pas laisser entendre le contraire dans l'interface. `BlobStore`
  est précisément le point où brancher `@capacitor/filesystem` lors du
  packaging APK — même patron que `useGeolocation`, et c'est la seule voie vers
  un vrai stockage d'appareil.
- **Dans l'APK, la carte lit elle-même les zones** (`services/offline/
  nativeTiles.ts`) : l'APK n'a pas de Service Worker (voir `vite.config.ts`), et
  vérifié sur le téléphone, rien ne lisait les zones sans réseau. MapLibre
  **refuse les protocoles personnalisés pour `https:`** (relevé dans sa source,
  `makeRequest`) : `transformRequest` réécrit donc les adresses que `keys.ts`
  reconnaît en `zone://`, et le protocole les sert zone d'abord, réseau ensuite,
  vide hors ligne. Quatre pièges, tous constatés en mode avion, cache HTTP de la
  WebView vidé (sans ce vidage, le test ment : le cache sert ce qu'on a déjà vu) :
  - **Le zoom** : une région s'arrête au 13, la carte demande du 14 — toutes ses
    tuiles manquaient. Hors ligne, le TileJSON annonce le zoom le plus bas des
    zones, et la carte le relit à chaque changement de connexion
    (`followConnectivity`, `setUrl`, API publique).
  - **Les polices** : MapLibre les demande avec des espaces nus, le
    téléchargement les écrivait encodés — `assetPath` normalise l'adresse
    (`new URL().href`) avant de l'échapper. Sans cela, aucun nom sur la carte.
  - **Les pictogrammes** : le téléchargement prenait `@2x.png` sans `@2x.json`.
    Le JSON manquant remonte en erreur (« Failed to fetch » sur la carte). Les
    zones prises avant la correction le récupèrent à leur mise à jour.
  - **La lecture des zones est partagée** (`hasZones`) : notée avant la réponse
    d'IndexedDB, elle faisait aller au réseau les requêtes parties en même temps.
  Diagnostic par le câble : `window.__myosm.offlineTiles` (zone, réseau, vide) et
  `offlineMisses` (ce qui n'a pu être servi).

- **Dans l'APK, les tuiles vivent dans le stockage de l'application**
  (`services/offline/deviceStore.ts`, par `@capacitor/filesystem`), et plus
  dans la WebView. Mesuré sur le Pixel 8 : `navigator.storage.persisted()` rend
  **faux** et la demande de persistance est refusée — OPFS, Cache Storage et
  IndexedDB y sont « best-effort », et le système peut les vider quand la place
  manque. Le stockage interne de l'application ne part qu'à la désinstallation
  ou par « Effacer les données ».
  - **Écriture** en base64 (seule forme binaire que le greffon accepte sur
    Android) ; **lecture** par l'adresse locale de Capacitor
    (`convertFileSrc`, `/_capacitor_file_/…`), un `fetch` ordinaire qui ne fait
    pas passer les octets par le pont — un fichier absent y rend un 404
    immédiat. **Chaque segment de chemin est ré-échappé** (`deviceFileUrl`) :
    l'habillage est rangé sous son URL échappée, et le serveur décode l'adresse
    avant d'ouvrir le fichier.
  - **Suppression par dossiers entiers** (`keptAncestors`) : on ne descend que
    dans les dossiers qui mènent à une tuile gardée, tout autre dossier part en
    un appel.
  - **La liste des zones est recopiée à côté** (`zones-regions.json`) : si la
    WebView est vidée, IndexedDB part avec elle et les tuiles deviendraient
    invisibles. Au lancement (`prepareDeviceStorage`), une liste vide et une
    copie pleine font revenir les zones, tenues pour périmées pour refaire leurs
    détails et leur index.
  - **Au premier lancement de cette version, pas de recopie** (choix explicite) :
    les tuiles rangées dans la WebView sont effacées et chaque zone passe
    « à retélécharger » (`failure: "moved"`).
  - La carte relit la liste des zones **dès qu'elle change**
    (`regionsRevisionNumber`) : une zone qu'on vient de télécharger servait
    sinon jusqu'à trente secondes plus tard.
  - Vérifié sur le téléphone : zone de test de 18 tuiles écrite en 3,4 s,
    tuile et police (nom échappé) relues en 200, fichier absent en 404,
    suppression qui retire le zoom 14 et garde l'habillage commun.
- **Une écriture refusée arrête la zone et dit pourquoi**
  (`StorageWriteError`, `failure` dans la zone). Avant, l'échec était avalé
  tuile par tuile et une zone « prête » pouvait être trouée en silence. Le
  greffon Android ne distingue pas le disque plein : c'est la **place libre
  mesurée** (greffon `DeviceStorage`, `StatFs`) qui tranche
  (`classifyWriteFailure`). La fenêtre prévient aussi **avant** de lancer une
  zone plus lourde que la place libre — un avertissement avec « Télécharger
  quand même », pas un refus : l'estimation pèche volontairement par excès.

  Rien ne quitte l'appareil : les listes de zones diffèrent donc d'un appareil à
  l'autre par construction, il n'y a aucune synchronisation à prévoir.
- **Le Service Worker est écrit à la main** (`injectManifest`, `src/sw.ts`) et
  non plus généré, et c'est cette fonction qui l'impose : une zone téléchargée
  rangée dans un cache d'exécution de Workbox se ferait effacer par son plafond
  d'entrées et son expiration. **Ne pas ajouter d'écouteur `fetch` à côté du
  routeur de Workbox** : les deux appelleraient `respondWith` sur les mêmes
  URLs et le second lèverait. Les deux logiques sont *composées* — la route
  regarde la zone, puis délègue à la stratégie.
- **L'estimation de poids est calibrée sur de vraies tuiles.** Les médianes de
  `config.ts` ne sont qu'un ordre de grandeur : mesuré, une tuile de zoom 14
  pèse 568 ko dans Paris et 84 ko en Seine-et-Marne. `calibrate()` échantillonne
  quatre tuiles de la zone choisie et en tire un facteur de densité (mesuré :
  ×1,53 sur Paris, ×0,30 en rural). Le serveur n'expose pas `Content-Range` en
  origine croisée — il n'y a pas moyen de peser une tuile sans la télécharger.
- **Le téléchargement vit dans l'onglet, pas dans le Service Worker**, et il est
  donc reprenable : les tuiles déjà présentes sont sautées et l'avancement est
  écrit toutes les 40 tuiles. Fermer l'application au milieu de 250 Mo ne coûte
  que ce qui était en vol.
- **Supprimer une zone ne doit pas crever ses voisines** : deux zones qui se
  touchent partagent leurs tuiles de zoom faible (au zoom 0 il n'y en a qu'une
  pour la planète). `removeRegion` établit d'abord les clés que les autres zones
  réclament, et ne retire que le reste.
- **Une zone téléchargée passe devant le réseau**, pas seulement quand il
  manque : `getPlaceDetails` la consulte en premier, et la fiche s'ouvre sans
  attendre Overpass.
- **La fraîcheur se vérifie sans rien retélécharger** : le numéro de version du
  TileJSON suffit. **Chaque semaine, sans réglage** (demande explicite — le
  choix semaine/mois/jamais a été retiré), et manuellement par le bouton ; la
  fenêtre dit la date de la dernière vérification (le plus récent `checkedAt`).
- **La vérification vit au niveau de l'application** (`hooks/useFreshness.ts`,
  monté dans `App`), pas dans la fenêtre « Téléchargement » : elle n'avait
  sinon lieu que fenêtre ouverte. Déclencheurs : le lancement, l'événement
  `online` et une horloge d'une heure, chacun ne vérifiant **que si la semaine
  est écoulée**. Hors ligne, `checkFreshness` ne date rien : la vérification
  reste due et repart au retour du réseau. Rien ne tourne application fermée
  (il faudrait un service Android, écarté).
- **La mise à jour des zones périmées est toujours automatique** (demande
  explicite : plus de case « sans demander »), sous réserve du réglage wifi.
  Elle part de la fenêtre, pas du fond : les
  téléchargements s'arrêtent à la fermeture de la fenêtre. Une zone rafraîchie
  après la vérification (`updatedAt` > `checkedAt` du résultat) sort de la
  liste des périmées sans attendre la vérification suivante.

**Les adresses viennent de la BAN servie en WFS par la Géoplateforme**
(`BAN-PLUS:adresse`, sur `data.geopf.fr` — le même hôte que
l'orthophotographie). Deux sources ont été écartées, mesures à l'appui : le
fichier de la BAN, dont le serveur (`adresse.data.gouv.fr/data/…`) accepte la
connexion puis ne répond jamais, en HTTP/2 comme en HTTP/1.1, sur le plus petit
département comme sur le plus gros ; et BANO, le repli d'OpenStreetMap France,
**incomplète** — 158 186 adresses sur Paris intra-muros contre 242 153 pour la
BAN, et pas de 12 rue de Rivoli. Quatre choses à savoir :

- **`CRS:84` dans le paramètre `BBOX` n'est pas optionnel.** Sans code de
  référentiel explicite, le WFS rend **zéro objet au lieu d'une erreur** —
  silencieusement. L'`EPSG:4326` par défaut d'un WFS 2.0 est en ordre
  latitude/longitude, et l'emprise atterrit au milieu de l'océan Indien.
- **`PROPERTYNAME` fait un quart du poids.** Sans lui, chaque adresse traîne
  deux identifiants longs et un champ `position` : 340 octets contre 258
  (mesuré). Le champ de géométrie s'appelle `geom`, pas `geometrie` — se
  tromper rend une exception XML au lieu du JSON attendu.
- **Le comptage est gratuit** (`RESULTTYPE=hits`, une requête). C'est ce qui
  permet d'annoncer un poids **exact** avant de télécharger, là où les tuiles
  se contentent d'une estimation calibrée.
- **La demande se fait par emprise**, et c'est l'avantage décisif sur un
  fichier par département : Le Marais coûte 913 ko (3 540 adresses) là où BANO
  aurait imposé les 13,9 Mo du fichier de Paris. Paris intra-muros entier :
  62 Mo en 121 requêtes.

Les adresses sont **indexées par voie, pas une par une** : une ligne d'index par
numéro ferait exploser les écritures et le stockage, pour une recherche qui
commence de toute façon par reconnaître une rue. Le numéro tapé est retrouvé
dans la liste que porte la voie ; s'il manque, on rend le milieu de la voie
plutôt que rien. Et **`addresses` (booléen) est distinct de `addressDepts`** :
au moment où l'on lance, le comptage peut ne pas avoir abouti, et zéro ne doit
pas se confondre avec un refus.

**Une zone se choisit d'un toucher, comme dans Organic Maps** (demande
explicite ; le carré à tracer a été retiré, comme avant lui la liste des pays et
`src/data/countries.ts`). Le zoom de la carte réduite dit ce qu'on vise — pays
sous `PICK_REGION_ZOOM`, région jusqu'à `PICK_DEPARTMENT_ZOOM`, département
au-delà — et la zone touchée se surligne. Les zones déjà téléchargées sont en
vert. Cinq choses à savoir :

- **Les contours viennent de Nominatim au toucher** (`services/offline/
  boundaries.ts`, demande explicite plutôt que des contours embarqués) :
  `/reverse` avec `zoom` 3, 5 ou 8 et `polygon_geojson`. Une requête par
  seconde au plus, règle du service public, appliquée par le module. En mer,
  il répond `Unable to geocode` (→ « aucune zone ici ») ; au zoom 8, Paris rend
  la ville, qui est aussi son département. Mesuré : la France pèse 77 ko
  (3 000 points) à la tolérance 0,01°.
- **Une zone suit son contour exact, pas son rectangle** (`OfflineRegion.area`,
  `services/offline/area.ts`) : tuiles, calibrage et mailles d'Overpass ne
  prennent que ce qui touche la zone, et les adresses — que le WFS ne sert que
  par rectangle — sont triées à la lecture. Les zones d'avant, tracées au
  carré, n'ont pas d'`area` et suivent leur `bbox` : tout passe par
  `footprintTiles` / `Footprint`, jamais par `tilesForRange(region.bbox)`.
- **Le parcours des tuiles est hiérarchique** : on ne descend que dans les
  tuiles que le contour traverse ; une tuile sans bord est pleine ou vide, et
  une pleine compte ses descendantes par arithmétique. Au-delà du zoom 12, les
  **comptes** sont majorés (une tuile du bord vaut toutes ses descendantes) pour
  que l'estimation du satellite reste instantanée ; le téléchargement, lui,
  énumère exactement. La marge autour des tuiles est la tolérance de
  simplification demandée à Nominatim.
- **Les morceaux lointains sont écartés** (`TRIM_FAR_PARTS_DEG`, 4°) : toucher
  la métropole rend la France avec la Corse, sans l'outre-mer — la règle de
  l'ancienne liste des pays.
- **Plus de curseur de détail** : le zoom maximal vient du niveau touché
  (`LEVEL_VECTOR_ZOOM` : pays 11, région 13, département 14). Mesuré sur la
  France : 2,4 Go au zoom 12, 7,1 au 13 et **51,6 au 14**. Ne pas remonter le
  zoom d'un pays sans refaire la mesure. Le champ `countryCode` reste lisible
  dans les zones prises avec l'ancienne liste.

**Les réglages de comportement** (`hooks/useOfflinePrefs.ts`) suivent le patron
des autres réglages persistés. Deux points de vigilance :

- **`isMetered()` ne bloque que sur une certitude.** L'API `NetworkInformation`
  n'existe que sur Chrome, et son champ `type` — le seul qui distingue le wifi
  de la 4G — n'est renseigné que sur Android. Un « je ne sais pas » doit valoir
  « laisse passer », sans quoi « wifi uniquement » deviendrait « ne jamais
  télécharger » sur la moitié des navigateurs, sans explication. Le panneau dit
  ce que le navigateur sait réellement.
- **Seules les pauses décidées par l'application se reprennent seules**
  (`pausedBy`). Une interruption demandée par l'utilisateur doit le rester,
  sinon le bouton « interrompre » cesserait de servir dès le retour du wifi.

**Le lieu de stockage n'est pas choisissable** : aucune application web ne peut
en décider, c'est le navigateur qui place son Cache Storage et son IndexedDB.
Ce qui est possible et fait : demander la persistance
(`navigator.storage.persist()`) et afficher la place occupée. Ne pas promettre
davantage dans l'interface. Dans l'APK, la question ne se pose plus : les
cartes sont dans le stockage de l'application, et la place affichée est le
poids écrit des zones sur la place libre du disque.

**Les confirmations sont dans l'application, jamais `window.confirm`.**
Suppression d'une zone comme téléchargement volumineux : le bloc se déplie à la
place de ce qu'il remplace, sur le motif des dossiers de signets. Une fenêtre
système sort du cadre de l'interface, ne suit pas le thème, et certains
navigateurs mobiles l'escamotent purement et simplement.

### Service Worker (`vite-plugin-pwa`)

Le noyau de l'application est préchargé (13 entrées, 360 Ko compressés) et les
tuiles déjà vues sont gardées par des règles d'exécution : fond OpenFreeMap une
semaine, imagerie Esri un mois, couverture Mapillary une semaine. Deux
décisions à ne pas défaire :

- **Le fragment `mapillary*` est exclu du préchargement** (`globIgnores`) : un
  mégaoctet que la plupart des visites n'ouvrent jamais, et le précharger
  annulerait le chargement à la demande construit exprès. Il est mis en cache
  s'il sert, pas avant.
- **Aucune API de données n'est mise en cache par le Service Worker** —
  transports, météo, qualité de l'air, vigilance, itinéraires, géocodage. Ces
  réponses ont une durée de validité qui leur est propre, déjà gérée service
  par service dans `src/services`. Un cache d'infrastructure par-dessus
  servirait un horaire périmé sans que rien ne le signale.

`registerType: "autoUpdate"` : la nouvelle version prend la main au chargement
suivant, sans demander. L'application n'a pas d'état à préserver en cours de
route — tout est dans `localStorage` ou dans l'URL des services.

### Langue de l'interface (`src/i18n/`)

Deux dictionnaires plats, `fr.ts` et `en.ts`, et un magasin minuscule lu par
`useSyncExternalStore`. Ce n'est **pas** un hook persisté comme les autres, et
c'est délibéré : la langue est lue par une quarantaine de composants, dont
certains très loin d'`App`. La descendre en prop traverserait toute
l'application pour une valeur qui change une fois par an, et `App` n'a pas de
contexte, par choix d'architecture. Le réglage lui-même suit en revanche le
patron habituel : clé `osm-local:lang`, lecture tolérante aux pannes.

**L'anglais est servi par défaut, y compris sur un téléphone en français**
(demande explicite, 16 septembre 2026). L'application est publiée pour un
public international — descriptions, captures et notes de version sont en
anglais — et c'est dans cette langue qu'elle doit se présenter à qui l'installe
sans rien savoir d'elle. Le francophone la repasse en français en deux touches.
`systemLang()` retombe donc sur `en`, et non plus sur `fr`, pour toute langue
qui n'est ni l'un ni l'autre.

**« Système » s'écrit désormais dans la clé (`"system"`), il ne se déduit plus
d'une absence.** Tant que l'absence signifiait « suivre l'appareil », les deux
se confondaient sans dommage ; depuis que l'absence signifie « anglais », les
distinguer est vital. **Ne pas revenir à `removeItem`** pour ce choix : choisir
« Système » puis rouvrir l'application rendrait l'anglais, et l'option ne
marcherait tout simplement pas. C'est la seule différence de patron avec le
thème, dont « Automatique » efface bien sa clé.

Points à connaître avant d'y toucher :

- **`fr` est la référence.** Ses clés définissent le type `Dict` et `en` est
  typé dessus : une traduction manquante ou en trop **casse le build** au lieu
  d'afficher une clé nue. Ajouter une phrase, c'est ajouter la clé des deux
  côtés.
- **Un composant qui affiche du texte appelle `useI18n()`**, même s'il ne se
  sert que de `t` : c'est l'abonnement qui le redessine au changement de
  langue. Les services et utilitaires, eux, importent `t` directement — elle
  lit la langue en vigueur à l'appel.
- **Ce qui est mis en cache porte des clés, pas des phrases** : les relevés
  météo (indice de l'air, pollens, vigilance) vivent dix minutes en cache et
  les catégories de `filters.ts` sont des tables constantes. Elles portent donc
  des `TranslationKey`, traduites au rendu — sans quoi un changement de langue
  laisserait la moitié de l'écran dans l'ancienne.
- **Une phrase qui entoure un élément JSX reste une seule clé** : `tParts()`
  la coupe sur sa propre variable (`{file}`, `{name}`). La découper en deux
  clés interdirait au traducteur de déplacer la variable dans sa phrase.
- **Les pluriels ont deux clés** (`…_one`, `…_other`) choisies par `tp()` : le
  français dit « 0 lieu » là où l'anglais dit « 0 places ». Le type `PluralKey`
  n'accepte que les clés qui ont bien la paire.
- **Les dates et les nombres suivent `locale`** (`fr-FR`, `en-GB`), pas la
  langue : `en-GB` pour garder les heures de 0 à 24, l'application décrivant un
  territoire qui les compte ainsi.

**Une exception, et une seule** : les phrases de la navigation guidée vivent
dans `src/navigation/strings.ts` et non ici. C'est le prix de ce qui a été
demandé pour ce module — pouvoir le retirer en supprimant un dossier — puisqu'une
clé posée dans `fr.ts` doit l'être aussi dans `en.ts`. Le patron y est repris à
l'identique (français de référence, anglais typé dessus, une traduction
manquante casse le build) et la langue en vigueur est lue **dans ce magasin-ci**,
si bien que le guidage suit le réglage des paramètres comme le reste. Ne pas
généraliser ce découpage : c'est une entorse justifiée par une contrainte
explicite, pas un second dictionnaire.

Deux textes ne changent de langue qu'au prochain passage : les **mentions
d'attribution** des sources (`MapView`), posées en même temps que les sources
et donc reprises au changement de fond de carte, et l'**écran de repli**
(`ErrorBoundary`), un composant de classe sans abonnement — il ne survit pas au
rechargement qu'il propose.

Ce qui n'est **pas** traduit, et pourquoi : les **libellés de la carte
elle-même** (ils viennent des tuiles, c'est-à-dire d'OpenStreetMap, et disent
les noms locaux), les **résultats de recherche et les noms d'arrêts** (données,
pas interface), le **manifeste PWA** et la description de `index.html` (une
seule valeur, lue à l'installation), et les **traces de console**, qui
s'adressent au développeur.

### Aucune donnée pour Google

**C'est le but de l'application** (demande explicite) : ce qu'elle garde sur le
téléphone — clés d'API saisies, historique des trajets avec leurs tracés,
adresses Maison et Travail, journal, cartes hors ligne — n'en sort pas vers
Google. Ne jamais ajouter de service Google (Firebase, Analytics, Maps…) ni
réactiver ce qui suit.

- **Ni sauvegarde, ni transfert** : `android:allowBackup="false"` et
  `res/xml/data_extraction_rules.xml`, qui exclut tous les domaines de la
  sauvegarde cloud **et** du transfert d'appareil à appareil — à partir
  d'Android 12, `allowBackup` seul n'empêche plus ce dernier. Vérifié :
  `dumpsys package` ne porte plus `ALLOW_BACKUP`.
- **La WebView n'envoie rien** : `android.webkit.WebView.MetricsOptOut`
  (statistiques d'usage et de plantage) et
  `android.webkit.WebView.EnableSafeBrowsing` à faux dans le manifeste.
- **Pas de permission inutile** : `ACTIVITY_RECOGNITION` a été retirée — le
  compteur de pas lit l'accéléromètre de la page, pas le podomètre du système.

### Sécurité (audit du 15 septembre 2026)

Un audit a relu code, configuration, APK et dépendances, et vérifié sur le
Pixel 8. Ce qui en est sorti, et les règles à tenir.

- **Deux APK, deux usages.** `npm run apk` → `livrables/MY-OSM-debug.apk`, pour
  travailler : débogable, débogage de la WebView, objet `window.__myosm`
  (`outils/journal.sh`, mesures par le câble). `npm run apk:release` →
  `livrables/MY-OSM.apk`, **à partager** : non débogable (`run-as` refusé),
  sans débogage de la WebView, sans objet de diagnostic. Vérifié : aucune prise
  de débogage ouverte, `run-as` refusé, application fonctionnelle.
  - **Ne pas remettre `webContentsDebuggingEnabled` dans `capacitor.config.json`** :
    sans réglage, Capacitor le suit sur le drapeau « débogable » (`CapConfig`),
    ce qui donne exactement la répartition voulue. Forcé à vrai, il ouvrait les
    DevTools — stockage lisible, JavaScript exécuté avec le pont natif — à tout
    PC autorisé, en release aussi.
  - **`__DIAGNOSTICS__`** (défini dans `vite.config.ts`) est faux quand
    `MYOSM_DIAGNOSTICS=0`, ce que passe seul `apk:release` : les expositions de
    `window.__myosm` (carte, zones, journal) disparaissent du code livré.
  - La release est **signée pour l'instant avec la clé de débogage** de la
    machine : même signature que la debug, les deux s'installent l'une sur
    l'autre sans perdre les données. La vraie clé viendra avec la sortie
    officielle.
- **Une politique de sécurité du contenu (CSP)** (`src/security.ts`) : scripts
  de l'application seulement — ni script en ligne, ni `eval`, ni autre
  domaine ; réseau et images ouverts à `https:`. **Posée par le code au
  démarrage, en production**, et pas dans `index.html` : sur une WebView sans
  `DOCUMENT_START_SCRIPT`, Capacitor injecte son pont par un `<script>` en
  ligne (`JSInjector`, lu dans `Bridge.java`), qu'une balise dans le HTML
  bloquerait. Vérifié sur le téléphone, **tous les calques allumés** (satellite,
  IGN, relief, photos de rue, trafic, 3D) : pont natif, recherche et fiche,
  module des photos, **zéro violation** ; un gestionnaire d'événement injecté
  et `eval` sont bloqués. Aucune bibliothèque du bundle n'utilise `eval`,
  `new Function` ni WebAssembly. **Une dépendance ajoutée qui en aurait besoin
  cassera** : le message « Refused to… » est dans la console ; ne pas ajouter
  `'unsafe-eval'` ou `'unsafe-inline'` aux scripts sans rouvrir la question.
- **Rien de venu d'ailleurs n'entre dans un lien ou du HTML sans garde-fou**
  (`utils/safe.ts`) : `safeWebLink` pour un lien tiré des données (site d'un
  lieu OSM : seul `http(s)` passe, une adresse sans schéma reçoit `https://`),
  `safeColor` pour une couleur relue du stockage avant `innerHTML` (repères de
  la carte). React 19 bloque `javascript:`, pas `intent:` ni `data:`.
- **Ce qui est solide, et vérifié** : aucun secret dans l'historique git ; tout
  en HTTPS ; relais natif limité à `RELAY_TARGETS` ; requêtes Overpass
  échappées ; crédits de carte réduits à du texte et des liens `http(s)` ;
  seul `MainActivity` est exporté sans permission ; navigateur intégré sans
  pont Capacitor, sans accès aux fichiers ni contenu mixte.
- **Les clés d'API ne partent plus dans la version à partager** (corrigé le
  16 septembre 2026 ; c'était auparavant un risque accepté). Tout ce qui
  s'appelle `VITE_*` est **compilé dans le programme** : un `unzip` de
  `livrables/MY-OSM.apk` rendait en clair le jeton Mapillary, la clé TomTom et
  la clé IDFM personnelles — dans la version précisément destinée au partage.
  Deux protections, et il faut les deux :
  - `apk/package.json` passe ces six variables **à vide** sur la ligne de
    commande pour `apk:release` (une valeur du shell l'emporte sur `.env.local`,
    vérifié) ;
  - `vite.config.ts` **casse le build** si l'une d'elles arrive tout de même
    renseignée, en la lisant par `loadEnv` — c'est-à-dire exactement comme Vite
    la compilerait, là où `process.env` ne verrait pas `.env.local`.

  L'APK de travail (`npm run apk`), lui, garde les clés : il ne se partage pas,
  et les saisir à la main à chaque essai n'aurait aucun intérêt. **Ajouter une
  septième clé, c'est l'ajouter à `API_KEY_VARS` et au script de release.**
- **La version à partager se signe avec une vraie clé.** La clé de débogage
  d'Android est publique et identique sur toutes les machines : un APK signé
  avec elle peut être remplacé par une mise à jour que n'importe qui aura
  forgée. `apk/android/app/build.gradle` lit donc `MYOSM_KEYSTORE` (et ses trois
  mots de passe) dans l'environnement ou dans `~/.gradle/gradle.properties` ;
  sans elle, il retombe sur la clé de débogage **en l'écrivant dans les
  journaux de build**. Ne pas publier un APK construit sans `MYOSM_KEYSTORE`.
- **Risques acceptés, en connaissance de cause** :
  - données en clair dans le stockage de l'application (clés saisies, Maison et
    Travail, trajets) : protégées par le cloisonnement d'Android et
    `allowBackup=false`, plus par le débogage désormais coupé en release ;
  - une page ouverte dans le navigateur intégré peut appeler `MyOsmWeb` et
    proposer un faux lieu — montré, nom et adresse, avant tout appui ;
  - un lien reçu d'une autre application ouvre une fiche ou un itinéraire sans
    confirmation — jamais un guidage ;
  - `@capacitor/cli` : 3 vulnérabilités modérées (`uuid` via `xcode`, outillage
    iOS), non embarquées ; le seul correctif proposé est un retour à 8.4.3 ;
  - `res/xml/config.xml` porte `<access origin="*"/>`, régénéré par `cap sync`
    et sans effet (aucun greffon Cordova).
- **Performances inchangées** (Pixel 8, avant → après, trois mesures) :
  lancement à froid 442 → 299–389 ms, page chargée 273 → 196–303 ms,
  processeur au repos 6 → 8–22 ticks sur 20 s — l'écart suit les chargements de
  fond (tuiles, météo) et reste sous 1 % d'un cœur ; une CSP ne tourne pas au
  repos.

### Clés d'API (`services/apiKeys.ts`, fenêtre « API » du menu burger)

Les clés venaient de `.env.local` seulement, c'est-à-dire d'un fichier qu'il faut
éditer **puis recompiler**. Elles se saisissent désormais dans l'application, ce
qui est la seule façon d'en changer une fois l'application empaquetée en APK —
ce fichier n'y existe plus. `.env.local` ne fournit plus qu'une valeur par
défaut.

- **Les clés ont leur propre entrée « API » dans le menu burger**, plus une
  section au bas des paramètres (demande explicite) : longue et rarement
  ouverte, elle y noyait le thème et la langue.

- **`CONFIG` expose les clés en accesseurs, plus en constantes.** C'est ce qui a
  permis de ne toucher aucun des dix-huit points d'usage : `CONFIG.TOMTOM_KEY`
  lit le magasin à chaque appel. Corollaire à ne pas oublier : **ne pas
  déstructurer une clé au chargement d'un module** (`const { TOMTOM_KEY } =
  CONFIG`), la valeur serait figée à l'import et changer la clé dans les
  paramètres n'aurait plus d'effet.
- **Trois états par emplacement, et le troisième est celui qui compte** : rien
  de stocké (la valeur compilée sert), une valeur stockée (elle l'emporte), ou
  **une chaîne vide stockée** — aucune clé, et la valeur compilée est ignorée.
  Sans ce troisième état, « Supprimer » ferait réapparaître la clé du fichier et
  l'on ne pourrait jamais faire taire une clé compilée dans le programme.
  `restoreBuiltIn` est l'inverse exact, et n'apparaît que s'il y a une valeur
  compilée à rétablir.
- **L'interface dit d'où vient la clé employée.** Sans cette ligne, une
  suppression suivie du retour de la clé du fichier passerait pour un bogue. Et
  elle dit aussi ce qu'elle ne peut pas faire : la valeur compilée reste dans le
  code envoyé au navigateur, l'application ne peut que cesser de s'en servir.
- **L'état d'une clé est établi par un appel réel au service**
  (`services/apiKeyCheck.ts`), le plus léger qu'il accepte. Compter les
  caractères dirait « valide » d'une clé révoquée, expirée, ou souscrite à une
  autre API. Les codes ont été mesurés, vraie clé contre clé inventée, depuis
  une origine d'application empaquetée (`https://localhost`) :

  | Service | Vérification | Valide / refusée | Origine croisée |
  | --- | --- | --- | --- |
  | TomTom | `calculateRoute`, deux points voisins | 200 / 401 | origine renvoyée |
  | PRIM (IDFM) | `stop-monitoring`, en-tête `apiKey` | 200 / 401 | `*` |
  | Mapillary | `graph`, `fields=id&limit=1` | 200 / 400 | `*` |
  | Météo-France (clé API) | vigilance, en-tête `apikey` | 200 / 401 | `*` |

- **Plusieurs états d'affichage, et pas deux.** « Refusée » accuse la clé,
  « service injoignable » avoue qu'on ne sait pas : un 429 ou un 500 ne sont pas
  un verdict et ne doivent pas être présentés comme tels. Seuls 400, 401 et 403
  concluent. (L'état « non vérifiable » a disparu avec l'identifiant et le
  secret Météo-France, le 17 septembre 2026 : toutes les clés restantes se
  vérifient.)
- **Attention au débit, pas seulement au quota.** Un banc d'essai enchaînant les
  vérifications a rendu des **429** chez TomTom. La section n'en déclenche qu'une
  par emplacement à l'ouverture, ce qui est sans danger ; un script de mise au
  point, non.

### Hooks persistés

`useTheme`, `useBasemap` et `usePlaceFilters` suivent le même patron : clé
`osm-local:*` dans `localStorage`, lecture tolérante aux pannes
(`try/catch` — mode privé), valeurs inconnues filtrées à la relecture.
`useTheme` reflète le thème sur `<html data-theme>`, base de tout le CSS. Tant
que l'utilisateur n'a pas choisi, le thème est **« Automatique »** : y revenir
**efface** la clé de `localStorage` plutôt que d'y écrire un troisième thème.

- **Automatique suit la lumière ambiante** sur téléphone : sombre la nuit, clair
  au jour, sombre de nouveau dans un tunnel. Le capteur est lu par un **greffon
  natif propre à l'application** (`apk/android/.../AmbientLightPlugin.java`,
  enregistré dans `MainActivity`) : aucune API web ne le donne dans une WebView
  Android — `AmbientLightSensor` n'y existe pas, vérifié sur Pixel 8. La page
  l'atteint par `window.Capacitor.Plugins`, sans dépendance à `@capacitor/core`.
  Sans greffon ni capteur (navigateur), Automatique suit `prefers-color-scheme`,
  et le panneau le dit (`autoSource`).
- **La décision clair/sombre se prend côté web** (`services/ambientLight.ts`),
  avec deux protections contre le clignotement : **deux seuils écartés**
  (sombre sous 5 lux, clair au-dessus de 15, rien entre les deux) et **deux
  secondes de confirmation** — l'ombre d'un pont ne doit pas repeindre la carte,
  un tunnel si. Les relevés de la **première seconde et demie** s'appliquent
  sans délai (`SETTLE_MS`), pas seulement le tout premier : Android envoie
  parfois à l'inscription une valeur périmée ou nulle, qui mettait une pièce
  éclairée en sombre, et la zone neutre l'y laissait. Chaque bascule
  recharge le style de carte (`setStyle`), ce qui est une raison de plus de ne
  pas raccourcir ce délai.
- **Les seuils sont très bas** (demande explicite, **deux fois** : le thème
  restait sombre dans une pièce éclairée). Sur Pixel 8, le capteur de façade lit
  110 à 200 lux dans une pièce éclairée, parfois 60, et bien moins téléphone
  incliné loin de la lampe. Les seuils 50/150, puis 15/40, ne suffisaient pas :
  le sombre est désormais réservé au noir (pièce éteinte, habitacle de nuit).
  Contrepartie connue : sous un éclairage public franc, la nuit, la carte peut
  passer en clair. **Ne jamais remonter les seuils** sans refaire la mesure sur
  l'appareil (`adb shell dumpsys sensorservice`, section « Ambient Light: last
  50 events »).
- **C'est un magasin de module**, lu par `useSyncExternalStore` : `App` et
  l'historique des trajets lisent tous deux le thème, et deux `useState`
  démarreraient deux capteurs. Le capteur n'écoute que tant qu'un composant est
  abonné et que le réglage est Automatique ; le greffon le coupe aussi quand
  l'application passe en arrière-plan.

**La version s'affiche au bas du menu principal**, sous les crédits (demande
explicite). Une seule source, `version` dans `package.json`, au format
`0.1.0-alpha.N` pendant l'alpha, **N montant à chaque modification** :
`vite.config.ts` l'injecte (`__APP_VERSION__`, déclaré dans `vite-env.d.ts`) et
`apk/android/app/build.gradle` la relit pour `versionName` et `versionCode`
(0.1.0-alpha.3 → 1000003 ; une version finale passe devant ses alphas).

**Transports est en tête du menu des filtres** (demande explicite). L'ordre du
menu est `MENU_GROUPS` dans `FilterMenu.tsx`, **pas** celui de `FILTER_GROUPS` :
ce dernier décide du classement des lieux (`groupFromTags` retient le premier
groupe qui correspond), et le réordonner pour l'affichage changerait la
catégorie de certains lieux.

**Maison et travail sont aussi dans la barre de recherche** (demande
explicite), plus seulement dans les champs d'itinéraire : en tête de la liste
dès qu'on l'ouvre, et **reconnus dès la première lettre** — « t », « tr »,
« tra » trouvent Travail. Les mots reconnus dépassent le libellé affiché
(`ROLE_WORDS` : « domicile », « chez moi », « boulot », « bureau », et leurs
équivalents anglais), et la comparaison ignore accents et casse
(`normalizeBrand`). **La barre n'affiche que le nom**, pas l'adresse (demande
explicite). Un appui **lance l'itinéraire** depuis la position
(`handleRouteTo`), comme les applications de navigation. Un rôle non défini
apparaît grisé : l'appui arme la barre, et le lieu suivant qu'on choisit
devient l'adresse.

**L'adresse se voit et se change dans les paramètres** (« Maison et travail »,
`components/HomeWorkSettings.tsx`) : Modifier déplie la recherche sur place,
Retirer oublie l'adresse ; Échap annule la saisie sans refermer la fenêtre.
**Les deux adresses sont un magasin de module** (`hooks/useHomeWork.ts`,
`useSyncExternalStore`) : lues par `App` et modifiées par `AppMenu`, deux
`useState` se désynchroniseraient. Le libellé français est « Maison » (et non
plus « Domicile »), partout où il apparaît.

**`MapView` est découpé** (demande explicite ; il faisait 2 400 lignes). Le
composant et ses effets restent dans `components/MapView.tsx` (≈1 240 lignes) ;
ce qui n'a pas d'état en est sorti, sans rien changer : `components/map/layers.ts`
(identifiants de couches, styles, conversions GeoJSON, pose et retrait des
calques), `map/markers.ts` (épingles, bulles des propositions, repères
d'incident, flèche de navigation) et `map/navGlide.ts` (durées du glissement,
plafond de 60 images, part de définition). Une fonction de pose de calque
s'ajoute dans `layers.ts`, pas dans le composant.

**`App` délègue à trois hooks** (demande explicite ; il faisait près de mille
lignes) : `hooks/useItinerary.ts` (points du parcours, mode, calcul OSRM ou
Navitia, étapes et leurs repères, réponse à la question « quel point ? »),
`hooks/useBrandSearch.ts` (« afficher tous les … ») et `hooks/useStreetPhoto.ts`
(photo de rue, plein écran, carte qui suit). `App` en reprend **les mêmes noms**
par décomposition : le JSX n'a pas changé. La position de l'appareil est passée
d'en haut (`useItinerary(geolocation.position, geolocation.locate)`).

**La navigation voiture est découpée de même** : `car/carCamera.ts` (zoom selon
la manœuvre, place du conducteur, zone morte, recul de la flèche),
`car/carLabels.ts` (lignes des bulles), `car/useTravelHeading.ts` (sens de
marche envoyé aux moteurs), `car/useSpeedState.ts` (compteur : tolérance,
anti-clignotement, relevé périmé) et `car/heading.ts` (règle du contresens).
`useCarNavigation` garde la session, le calcul, l'avancement, la réévaluation
du trafic et l'état de carte ; `SpeedState` y reste réexporté pour le bandeau.

**`Uncaught TypeError … 'triggerEvent'` au lancement n'est pas un bogue de
l'application** : c'est le pont de Capacitor (`Bridge.java`) qui exécute
`window.Capacitor.triggerEvent(…)` — à la reprise de l'activité notamment —
avant que la page ait fini de charger. Aucun code du projet ne l'appelle.
Inoffensif ; ne pas le chercher dans `app/`.

**`Error injecting safe area CSS` au lancement ne vient pas non plus de
l'application** : le greffon `SystemBars` de Capacitor injecte ses variables CSS
de zone de sécurité avant que la page existe (`document.documentElement` est
encore nul). L'application ne s'en sert pas — elle lit `env(safe-area-inset-*)`.
Ne pas couper le greffon (`insetsHandling: "disable"`) pour faire taire le
message : sous Android 15 et plus, il règle aussi les marges de la vue quand le
clavier s'ouvre.

**Les écussons de route du style Liberty** écrivaient
`Expected value to be of type number, but found null instead` : leurs filtres
testent `ref_length <= 6` sur des routes qui n'ont pas cette propriété.
`guardShieldFilters` (`map/layers.ts`) ajoute « la propriété existe » en tête du
filtre à chaque chargement de style : même rendu, plus d'avertissement.

**Aucune animation CSS infinie ne doit rester visible en continu.** La
pulsation du point de position l'était : mesuré sur Pixel 8, carte au repos,
**1,30 cœur et 123 images par seconde** pour un cercle qui grossit, contre
**0,01 cœur et 0 image** une fois coupée — la WebView recompose l'écran à 120 Hz
tant qu'elle tourne. Elle joue désormais trois fois puis s'arrête ; la pastille
de vigilance, le point « en course » et l'invite du menu des catégories
aussi. Les indicateurs de chargement (`nav-spin`, `map-status-spin`,
`pulse-scale`) restent infinis : ils ne durent que le temps d'une attente.

### Performances

Mesures sur Pixel 8, par le câble (`/proc/<pid>/stat` pour le processeur de
l'application et de son moteur web, `dumpsys gfxinfo` pour les images). Une
**navigation voiture en mouvement se simule sans bouger** : la position de la
WebView est remplacée par une fausse, qui avance le long du tracé lu sur la
carte (`window.__myosm.map`, exposé pour cela). Référence du 14 septembre 2026,
trajet vers Travail à 50 km/h : **3,46 cœurs et 104 images par seconde** avant
les règles ci-dessous, **2,02 cœurs et 61 images** après, puis **1,87 cœur et
62 images** le 15 septembre 2026, après la mise à jour de MapLibre (6.9.1) et
le nettoyage du rendu — le fondu des libellés reste coupé avec cette version. Chacune a coûté
une mesure ; ne pas en défaire une sans la refaire.

- **Pendant la navigation voiture, aucun calque** (demande explicite) : ni POI
  (commerces, parkings, transports…), ni signets, ni relief, Mapillary, trafic
  du calque, ligne surlignée, résultats d'enseigne ou cône de photo. `App`
  passe à `MapView` des valeurs vides tant que `carGuiding` est vrai ; les
  réglages ne changent pas, et tout revient à l'arrêt. L'écran de choix garde
  les calques : on y regarde la carte.
- **`jumpTo` émet `moveend` à chaque appel**, donc 60 fois par seconde pendant
  le glissement de la caméra. La relecture des POI qui y était branchée tournait
  à 60 par seconde (mesuré : 60 `querySourceFeatures` par seconde). Pendant le
  glissement, elle ne part plus qu'une fois par seconde (`NAV_POI_REFRESH_MS`),
  et `refreshPois` ne renvoie rien à MapLibre si la liste n'a pas changé
  (`poiDrawnRef`) — `setLayoutProperty` relance le placement de tous les
  pictogrammes et `setData` le découpage, même à l'identique.
- **Un écouteur de carte qui remonte un état à `App` compare avant d'écrire.**
  Les crédits partaient à chaque `sourcedata` — c'est-à-dire à chaque tuile —
  sous forme d'un nouveau tableau, et redessinaient toute l'application.
- **Une valeur passée à `MapView` et suivie par un effet doit être stable.**
  `bookmarks.visiblePlaces` était recalculé à chaque rendu : l'effet des
  signets retirait et reposait tous leurs repères à chaque relevé GPS.
- **Aucune horloge au niveau d'`App`.** Le chronomètre de course bat dans
  `RunPanel` ; celle des transports bat chaque seconde mais ne redessine que si
  l'action prévue ou le nombre d'arrêts restants change ; le compteur de pas ne
  publie rien en cours de route (il est lu à la fin). Même règle que pour le
  compteur de vitesse.
- **Les composants qui restent à l'écran pendant une navigation sont protégés
  par `memo`** (`AppMenu`, `WeatherCard`, `CompassButton`, `FilterMenu`,
  `BookmarksMenu`), et leurs props sont rendues stables dans `App`
  (`weatherCoords` mémorisé, rappels par `useCallback`). Une prop recréée à
  chaque rendu annule `memo` sans rien dire.
- **Pas de fondu des libellés tant qu'une flèche est suivie**
  (`_fadeDuration` à 0, rendu à l'arrêt). Carte en mouvement, chaque image
  replace les libellés et chaque placement relance 300 ms de fondu : MapLibre
  se redessinait à la fréquence de l'écran (178 rendus par seconde, dont 175
  relancés par le placement) au lieu de suivre la boucle de 60. Sans fondu :
  61 rendus, 62 images par seconde, et 2,02 cœurs au lieu de 2,46. L'option
  publique `fadeDuration` ne se règle qu'à la création de la carte, d'où le
  champ interne ; s'il disparaît, rien ne casse, le fondu revient.
- **La boucle de glissement dessine la carte elle-même** (`map.redraw()` juste
  après `jumpTo`), dans la même image que la flèche. Sans cela, la flèche
  bougeait sur une image et la carte sur la suivante : 107 images par seconde
  et 2,52 cœurs, contre 63 et 1,93 avec. Les ~480 demandes d'image par seconde
  qui restent viennent des repères du DOM, recalés à chaque mouvement : elles
  ne produisent aucune image.
- **Une boucle d'images qui ne dessine rien ne coûte rien** — vérifié : 656
  demandes en 10 s, aucune image produite. Ce n'est pas elle qu'il faut
  chercher quand l'écran tourne à 120 Hz.
- **Les panneaux de navigation ont un fond plein, sans flou**
  (`backdrop-filter`) : le flou se recalcule à chaque image de la carte qui
  défile dessous.
- **Le journal écrit une queue de 500 entrées au plus**, versée dans l'archive
  quand elle déborde, au lieu de relire et réécrire les 5 000 entrées toutes
  les 5 s pendant la navigation.

- **Le linter ne rend aucun avertissement, et doit le rester** (il en rendait 65).
  Trois règles en découlent, à suivre dans tout nouveau code :
  - **Aucune ref écrite pendant le rendu.** Une valeur relue par un rappel,
    une horloge ou un abonnement passe par `useLatest` (`hooks/useLatest.ts`),
    qui l'écrit juste après le rendu : un rendu que React rejoue ne laisse rien.
  - **Ce qui dépend de la valeur précédente se met à jour pendant le rendu, en
    comparant à ce qui a déjà été compté** (patron « valeur du rendu précédent »
    de React), jamais dans un `useMemo` qui écrit des refs. C'était le cas de
    l'anti-clignotement du compteur de vitesse et de l'anti-recul de la flèche :
    un rendu rejoué les faisait avancer deux fois. La règle du compteur est une
    fonction pure testée (`nextOverSpeed`).
  - **Pas de `setState` au début d'un effet.** Une valeur « en cours » se
    déduit : un recalcul est en cours tant que la requête courante n'a pas
    abouti ; radars, trafic et profil sont rangés avec le trajet qu'ils
    décrivent ; une position ou un silence de capteur porte le numéro du suivi
    qui l'a produit (`hooks/useActivation.ts`), et un ancien numéro n'est plus
    rendu.

**Les fenêtres du menu sont chargées à la demande** (`lazy` + `Suspense`) :
Téléchargement (`AppMenu`) et Historique (`navigation/index.ts`, qui exporte
directement le composant différé — l'application continue de n'importer la
navigation que par cet index). Mesuré : le fichier de démarrage passe de 323 à
304 Ko compressés ; les deux fenêtres pèsent 6 et 5 Ko, lus à leur première
ouverture (vérifié sur le téléphone). Le gros du démarrage est MapLibre
(444 Ko bruts) et React DOM (174 Ko), incompressibles. Le style sombre (40 Ko)
n'est **pas** différé : le thème automatique le demande souvent dès
l'ouverture, et le charger après ferait passer la carte du clair au sombre.

`useSearchHistory` suit le même patron (clé `osm-local:search-history`) pour
l'historique de la barre de recherche. Deux décisions à ne pas défaire :

- **Une entrée de lieu garde le lieu**, coordonnées comprises : la rejouer
  rouvre sa fiche et recentre la carte, sans repasser par le géocodage —
  retrouver un endroit où l'on est déjà allé ne doit rien coûter ni rien faire
  attendre. Une entrée d'enseigne n'a rien à garder : c'est un nom qu'on repose
  sur la zone visible, laquelle a changé depuis. D'où les deux genres
  (`place` / `brand`), qui disent ce qu'on rejoue. Corollaire : un lieu relu du
  stockage sans coordonnées est écarté, il ne se rouvrirait nulle part.
- **Le nombre d'entrées proposées dépend de la saisie** (`matchHistory`) :
  deux champ vide — au premier clic, la liste n'est que cela — puis **une
  seule** dès la première lettre, la plus récente qui commence par ce qui est
  tapé. Le champ propose alors une suite ; en aligner plusieurs repousserait
  les résultats de la recherche en cours hors de l'écran.

Le panneau des calques se déploie **sur** le bouton des catégories, posé juste
au-dessus de lui dans la colonne : l'ouverture du premier est donc tenue par
`App` (`mapOptionsOpen`) et passée au second (`covered`), qui s'efface le temps
que dure le dépli. Sans cela le bouton flottait par-dessus le panneau. Le cas
inverse ne se pose pas — le panneau des catégories monte au-dessus de tout le
monde.

Les trois menus se répartissent les réglages selon ce qu'ils touchent, et il
vaut mieux s'y tenir : le **burger en haut à gauche** (`AppMenu`) règle
l'application elle-même (« Paramètres » : le thème), le **bouton des calques**
en bas à droite règle le rendu de la carte (fond, 3D), et le **menu des
catégories**, juste au-dessus de lui, règle ce qu'elle montre.

Le premier fonctionne en deux temps : le burger découvre une courte liste
d'entrées — « Paramètres », « Téléchargement », « Historique », « Modes » et
« API » — et l'entrée choisie ouvre une **fenêtre au centre de l'écran**
(`.modal-backdrop` + `.settings-dialog`).
**Toute fenêtre, actuelle ou future, passe par ce voile** : c'est lui qui la
tient à l'écart du poinçon de la caméra frontale et de la barre de gestes. Sa
marge suit les `safe-area-inset-*` et la fenêtre se borne à **sa** hauteur
(`max-height: 100%`), jamais à `100dvh` — constaté sur Pixel 8, les paramètres
passaient sous la caméra. Même règle pour tout élément posé contre un bord de
l'écran : `max(16px, env(safe-area-inset-…))`, comme la barre de recherche. Le
menu reste ainsi une table des matières, que d'autres entrées pourront
rejoindre, et les réglages ne s'ajustent pas du coin de l'œil en regardant la
carte. Le menu se ferme au clic à l'extérieur ; la fenêtre, elle, laisse ce
soin au voile — il couvre tout, il n'y a pas de gestionnaire à poser sur le
document, seulement l'écoute d'Échap de part et d'autre.

`useGeolocation` est délibérément isolé derrière l'interface
`{ position, loading, error, locate() }` — **préserver cette interface**, c'est
elle qui permettrait d'en changer l'implantation sans toucher au reste.

**Il n'y a pas de greffon derrière, et c'est suffisant.** `@capacitor/geolocation`
était installé, lié par Gradle et enregistré au manifeste des greffons **sans
jamais être appelé** : les deux hooks (`useGeolocation`, `useNavPosition`)
utilisent `navigator.geolocation`, et Capacitor intercepte la demande de la page
(`BridgeWebChromeClient.onGeolocationPermissionsShowPrompt`, lu dans sa source)
pour réclamer lui-même `ACCESS_FINE_LOCATION` et `ACCESS_COARSE_LOCATION` à
l'exécution. La dépendance a donc été retirée le 16 septembre 2026, et
`apk/README.md` corrigé — il affirmait le contraire depuis le début.

Ce qui manque encore, et qu'un greffon apporterait : distinguer un refus
ponctuel d'un « ne plus demander », et ouvrir les réglages d'Android pour le
corriger. Le jour où l'on en aura besoin, c'est ici que le greffon se rebranche.

**Rien ne se localise au lancement tant que l'autorisation n'est pas déjà
accordée** (`App`) : appeler `locate()` d'emblée faisait surgir la boîte de
dialogue d'Android avant que l'utilisateur ait vu la carte — le plus mauvais
moment pour être refusé.

**`navigator.permissions.query` ne sert à rien pour le savoir, et s'y fier a
coûté la fonction entière.** Mesurée sur appareil le 16 septembre 2026, elle
répond `prompt` **permission accordée comme retirée** : elle décrit
l'autorisation de l'origine web, pas celle qu'Android accorde au paquet. Le
garde exigeait `granted` ; il ne l'obtenait jamais ; le recentrage d'ouverture
était donc court-circuité à chaque lancement, en silence, alors que la position
s'obtenait en 1,9 s dès qu'on touchait le bouton. Aucun test ne pouvait le voir
— chaque morceau, pris à part, avait l'air juste. C'est le parcours sur
appareil (`recentrage`) qui l'a montré, en regardant **où la carte se pose**.

On ne se fie donc à cette API que lorsqu'elle tranche vraiment (`denied`
interdit, `granted` autorise), et l'on s'en remet sinon au souvenir d'une
position déjà obtenue — `osm-local:geo-seen`, posé par `useGeolocation` au
premier succès. Ce souvenir ne ment pas : la position n'a pu être obtenue
qu'avec l'accord de l'utilisateur. **Ne pas remplacer ce garde par un test sur
`granted`** sans refaire la mesure.

Même cause pour le message d'erreur : une permission retirée au niveau du
système ne produit **pas** `PERMISSION_DENIED` dans cette WebView. L'appel reste
sans réponse jusqu'au `timeout` de dix secondes et revient en `TIMEOUT` (10,0 s
mesurées). D'où `geo.timeout`, qui renvoie aux réglages du téléphone au lieu
d'annoncer une « position indisponible » exacte et inutile. Ce message
n'existait nulle part à l'écran : `useGeolocation` posait `error`, et **personne
ne le lisait** — un refus se soldait par un bouton qui tourne dix secondes puis
rien. Il passe désormais par `MapStatus` (`locationError`), et s'efface au bout
de huit secondes, la permission pouvant être accordée dans les réglages sans que
l'application en soit prévenue.

### Feuilles de style de l'interface (`src/styles/ui/`)

`src/App.css` ne porte plus de règles : c'est une **liste ordonnée d'`@import`**,
une feuille par zone de l'interface (recherche, fiche, itinéraire, météo,
menus, téléchargement…). Vite les réunit en une seule feuille au build — le
découpage est un confort de lecture, pas un découpage de chargement.

- **L'ordre des `@import` est celui de la cascade**, et il reprend celui du
  fichier d'origine. Quelques règles se recouvrent d'une zone à l'autre
  (`.sheet-action-secondary` complétée par la fenêtre d'enregistrement,
  `.toggle-switch` partagé par le menu des calques et celui des catégories) :
  les réordonner changerait qui l'emporte. `base.css` vient en premier, il
  porte les variables.
- **Ne pas importer une feuille depuis son composant.** L'ordre viendrait alors
  du graphe des modules — que React et Vite décident, et qui place justement
  `App.css` en dernier — au lieu d'être lisible à un seul endroit.
- Le poids n'est pas le sujet : toute la feuille pèse **20,1 ko compressés**,
  maplibre-gl comprise. Factoriser les motifs répétés (fond, ombre, rayon des
  panneaux flottants) demanderait de toucher aux `className` de tous les
  composants pour un gain nul.

### Le geste retour (`hooks/useBackClose.ts`)

**Le geste retour d'Android ferme ce qui a été ouvert en dernier, et ne quitte
jamais l'application** (demande explicite). Quand rien n'est ouvert — sur la
carte comme pendant une navigation — il **ne fait rien** : un glissement
involontaire au volant ne doit ni arrêter la navigation, ni mettre
l'application derrière (le GPS s'y arrête).

- **Une pile unique.** Chaque élément qui se ferme s'inscrit tant qu'il est
  ouvert (`useBackClose(ouvert, fermer)`), avec **la même fonction que son
  bouton de fermeture** : le geste ne fait jamais plus que le bouton. Le dernier
  inscrit se ferme au geste suivant. Dans un même composant, les appels
  s'empilent dans leur ordre — la fenêtre d'abord, sa confirmation ensuite —
  si bien qu'une confirmation se replie avant la fenêtre qui la porte, et un
  trajet déplié avant l'historique.
- **Un composant qui n'existe qu'ouvert s'inscrit dès son montage**
  (téléchargement, historique, fiche d'un lieu, itinéraire, photo,
  enregistrement d'un lieu, fiches de fin, écran de choix) ; un état replié ou
  déplié s'inscrit tant qu'il est ouvert (menu, catégories, calques, signets,
  météo, confirmations, saisie d'un point). **Tout nouvel élément qui se ferme
  doit s'y inscrire**, sans quoi le geste passerait par-dessus.
- L'écoute passe par le greffon officiel `@capacitor/app`
  (`installBackGesture`, `services/native.ts`, posée dans `main.tsx`) : tant
  qu'une écoute existe, il n'applique plus son comportement par défaut, qui
  fermait l'application — vérifié dans sa source (`AppPlugin.java`).
- Trois choix de détail : la **recherche** se referme et rend le focus (un
  nouvel appui la rouvre), puis une recherche d'enseigne affichée se quitte
  comme un champ vidé ; la **photo de rue** sort du plein écran avant de se
  fermer, comme Échap ; l'**écran de choix d'itinéraire** s'annule, comme son
  bouton — ce n'est pas encore une navigation.
- La touche Échap garde ses propres écoutes, pour le navigateur.

### Zones de toucher

Plusieurs boutons sont dessinés plus petits que le doigt : les croix de
fermeture (28 à 30 px) et les boutons de recalage des transports (32 px), pour
48 dp recommandés par Android. **Leur zone de toucher est agrandie par un
`::after` invisible**, sans rien changer au dessin ni à la mise en page. Chaque
débord est borné par ce qui l'entoure : **jamais au-delà de la moitié de
l'espace qui sépare deux boutons voisins**, sans quoi le second volerait les
appuis du premier.

Vérifié sur le téléphone en sondant le pourtour de chaque zone
(`elementFromPoint`) et le centre de chaque voisin : croix des paramètres, de
l'itinéraire et de la fiche à 44 × 44. Là où un bouton voisin chevauche la zone
(la croix de l'itinéraire borde les boutons d'une ligne), le voisin reste
au-dessus et garde ses appuis.

- **Les flèches d'une étape d'itinéraire restent à 24 px, sans zone agrandie.**
  Les lignes ne font que 26 px de haut : la zone d'une ligne recouvrait le bas
  des boutons de la ligne voisine — un appui sur le bas d'un « ↑ » aurait
  déplacé l'étape d'en dessous (mesuré). Les agrandir vraiment demande des
  lignes plus hautes, donc un changement visible, à décider.
- **Les boutons des dossiers de signets ont rejoint la règle** (audit du
  16 septembre 2026), et leur cas montre pourquoi la règle du voisin n'est pas
  une précaution théorique. Un premier correctif leur avait donné `inset: -8px`,
  soit 44 × 44. Sondé sur le Pixel 8 (`elementFromPoint`, même méthode que les
  croix), le résultat était **faux à droite** : c'est le bouton voisin qui
  répondait. Mesure : les boutons d'un dossier — couleur, renommer, supprimer —
  sont espacés de **4 px**, ce qui plafonne le débord à 2. À 8, « renommer »
  volait les appuis destinés à « couleur ». D'où `inset: -8px -2px` : 44 px en
  hauteur, 32 en largeur. **Une zone agrandie qui déclenche la mauvaise action
  est pire que pas de zone du tout** — sonder après avoir élargi, toujours.
- Les **pastilles de couleur** (`.bookmark-color`) ne gagnent que 20 → 26 px :
  espacées de 6 px, elles plafonnent à 3 px de débord. Les agrandir vraiment
  demanderait de les écarter, donc un changement visible, à décider — comme pour
  les flèches d'étape.
- La photo de rue et les transports ne se sondent pas par le câble : leurs
  débords sont calculés sur l'écart entre leurs boutons (8 et 4 px), sans avoir
  été mesurés.

## Contraintes techniques

- **Le worker de MapLibre doit être émis à côté du bundle, sous son nom exact**
  (`build.rollupOptions` dans `vite.config.ts`, seconde entrée
  `maplibre-gl-worker`). MapLibre calcule l'URL de son worker **à l'exécution**,
  avec un nom qui sort d'un ternaire : Vite ne peut pas l'analyser
  statiquement et n'émet donc pas le fichier. La carte cherche alors
  `/assets/maplibre-gl-worker.mjs`, ne le trouve pas, et **reste vide sans
  signaler la moindre erreur** — pas de tuiles, pas de POI (« chargement des
  commerces » à l'infini), et pas de tracé d'itinéraire non plus, les sources
  GeoJSON étant décodées par ce même worker.

  Ce défaut a vécu longtemps sans être vu, parce que **le serveur de
  développement le masque entièrement** : `import.meta.url` y désigne
  `node_modules/maplibre-gl/dist/`, où le worker existe. C'est la vraie raison
  d'être de l'`optimizeDeps.exclude` ci-dessous. Il a fallu installer un APK sur
  un vrai téléphone pour le débusquer, sur une ligne de `logcat` :
  `Unable to open asset URL: https://localhost/assets/maplibre-gl-worker.mjs`.

  Corollaire : **`npm run dev` ne prouve rien sur la carte**. Toute
  modification touchant à MapLibre doit être vérifiée sur un build.
- `optimizeDeps: { exclude: ['maplibre-gl'] }` dans `vite.config.ts` est
  nécessaire ; ne pas le retirer.
- maplibre-gl v6 : `setLngLat()` doit précéder `addTo()` sur un `Marker`, sinon
  `_update()` lit une position indéfinie et lève.
- **TypeScript est en mode `strict`** depuis le 16 septembre 2026, et il l'est
  dans les deux projets (`tsconfig.app.json` et `tsconfig.node.json`). Il ne
  l'était pas : le zéro `any` du projet donnait le change, mais `strictNullChecks`
  étant éteint, `null` et `undefined` passaient partout sans un mot — dans un
  code qui manipule en permanence des valeurs optionnelles (`region.area`,
  `fix.heading`, `source?.url`). L'activer n'a **rien cassé** : zéro erreur sur
  tout `src/`, ce qui en dit long sur le soin déjà apporté aux types. Ne pas le
  désactiver pour faire passer un fichier.
- S'y ajoute l'hygiène : `noUnusedLocals`, `noUnusedParameters`,
  `erasableSyntaxOnly`, `verbatimModuleSyntax` — importer les types avec
  `import type`.
- **Les méthodes récentes ne sont pas transpilées, seulement la syntaxe.**
  `AbortSignal.any` demande une WebView 116 et `AbortSignal.timeout` une 103,
  alors que l'application s'installe à partir d'Android 7 (`minSdkVersion 24`),
  où la WebView peut être bien plus ancienne. Sur un tel appareil, le
  téléchargement d'une zone levait un `TypeError` **dès la première tuile** — la
  fonction centrale de l'application ne démarrait pas — et la couche transport
  tombait de même. Les deux passent donc par `utils/signals.ts`, qui préfère
  l'implantation native et retombe sur la sienne ; le repli est testé
  (`tests/resume.test.ts`). Même prudence pour toute méthode d'après 2022.
- L'attribution OpenStreetMap / OpenFreeMap affichée par MapLibre doit être
  conservée (licence ODbL), y compris dans une future version hors-ligne.
