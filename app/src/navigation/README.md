# Navigation guidée

Le guidage pas à pas, dans les trois modes de déplacement de l'application :

- **à pied** — la manœuvre à venir et sa distance, le temps restant, l'heure
  d'arrivée, et, dans le détail, le profil du dénivelé ;
- **en voiture** (`car/`) — un choix d'itinéraire avant de partir (sans péage,
  le plus rapide, moins cher), fait **sur la carte** : les parcours y sont
  tracés côte à côte et chacun porte sa bulle, durée et péage, qu'on touche pour
  partir. Puis distance–action–direction en haut, les voies à emprunter quand il
  y en a, la vitesse et sa limite à gauche, l'heure d'arrivée en bas — et un
  son, le seul de l'application, pour les radars ;
- **en transports en commun** — le trajet retenu suivi action par action, sur
  l'horaire plutôt que sur la position.

Tout tient dans ce dossier, **volontairement**. La demande était d'en faire
quelque chose qu'on puisse retoucher ou retirer sans démonter l'application :
le calcul, l'état, les composants, les phrases et la feuille de style sont
ici, et l'application n'y touche qu'en cinq fichiers, où chaque endroit est
marqué d'un commentaire qui nomme ce dossier.

## Ce que le dossier contient

| Fichier | Rôle |
| --- | --- |
| `geo.ts` | Distances, caps, projection d'un point sur un segment. |
| `route.ts` | L'appel à OSRM avec `steps=true`, et le trajet mis en forme (`NavRoute`). |
| `progress.ts` | Où l'on en est sur ce tracé : avancement, écart, manœuvre à venir. |
| `elevation.ts` | Le profil du dénivelé, lu dans les tuiles d'altitude déjà utilisées par le relief. |
| `useNavPosition.ts` | `watchPosition` : le suivi continu de la position. |
| `useNavigation.ts` | La session de navigation : elle assemble tout ce qui précède. |
| `NavigationPanel.tsx` | Le bandeau de manœuvre, la barre du bas et le détail dépliable. |
| `ElevationProfile.tsx` | Le graphe du dénivelé. |
| `StartNavigationButton.tsx` | Le bouton « Démarrer » posé dans le panneau d'itinéraire. |
| `NavigationSettings.tsx` | La section « Navigation » de la fenêtre des paramètres. |
| `ModesSettings.tsx` | La fenêtre « Modes » du menu : bouton de course, fiches de fin de marche et de course. |
| `simulate.ts` | Un marcheur fictif, pour vérifier le guidage sans sortir (développement seulement). |
| `useStepCounter.ts` | Le comptage des pas, et le point de branchement du podomètre natif. |
| `history.ts` | L'historique des trajets (IndexedDB) et sa purge. |
| `trip.ts` | Les chiffres d'un trajet terminé et la façon de les écrire. |
| `TripSummary.tsx` | La fiche de fin de trajet. |
| `HistoryPanel.tsx` | L'historique : liste, sélection, détail. |
| `TripMap.tsx` | Le tracé d'un trajet sur une vraie carte. |
| `tripCard.ts` | Le bloc du détail redessiné en image. |
| `tripShare.ts` | La capture de carte hors écran et le partage. |
| `settings.ts` | Les deux réglages persistés : cadrage de la caméra, conservation. |
| `transitSteps.ts` | Un trajet en transports découpé en actions. |
| `useTransitNavigation.ts` | La session de guidage en transports. |
| `TransitNavigationPanel.tsx` | Le bandeau et la liste de la suite du trajet. |
| `exits.ts` | Par quelle sortie quitter une station. |
| `dockClearance.ts` | La hauteur réellement occupée par la colonne du bas (barre + encart de musique), lue par `App` pour ranger les boutons de droite au-dessus. |
| `running/run.ts` | Mode course : réglages de capture (2 s, 30 m, seuil de déplacement selon la précision, 45 s) et calculs de l'allure (série, régularité, allure du moment). |
| `running/useRunSession.ts` | La session de course : chronomètre hors pauses, capture filtrée, fin, enregistrement et dénivelé. |
| `running/RunButton.tsx` | Le bouton orange sous le burger, en face de la boussole. |
| `running/RunPanel.tsx` | Le bandeau « Course en cours » (Pause, Terminer) et la barre distance / allure / allure moyenne. |
| `running/RunFigures.tsx` | Les quatre chiffres d'une course, partagés par la fiche de fin et l'historique. |
| `running/PaceChart.tsx` | Le graphe de l'allure, axe inversé, moyenne en pointillés, régularité. |
| `running/RunSummary.tsx` | La fiche de fin de course, en orange. |
| `music/nowPlaying.ts` | La musique en cours, lue par le greffon natif `NowPlaying` ; n'écoute que pendant un guidage. |
| `music/MusicCard.tsx` | L'encart au-dessus de la barre du bas, dans les trois guidages — seulement s'il y a de la musique. |
| `music/MusicSettings.tsx` | « Musique pendant le guidage » dans les paramètres : l'accès à accorder une fois. |
| `strings.ts` | Les phrases, en français et en anglais — les trois modes. |
| `navigation.css` | La feuille de style : bandeau, barre, graphe, et la voiture. |

Et le sous-dossier `car/`, qui tient toute la navigation voiture :

| Fichier | Rôle |
| --- | --- |
| `car/carRoute.ts` | L'appel à TomTom (ou à OSRM sans clé) et le trajet mis en forme. |
| `car/carProgress.ts` | Où l'on en est, avec les seuils propres à la voiture. |
| `car/carManeuver.ts` | La manœuvre en pictogramme, action et direction. |
| `car/proposals.ts` | Les trois propositions, et pourquoi il n'y en a parfois qu'une. |
| `car/tolls.ts` | Le prix du péage, quand il est officiellement publié. |
| `car/radars.ts` | Les radars du parcours, et le seul son de l'application. |
| `car/useCarNavigation.ts` | La session de guidage voiture. |
| `car/RouteChoice.tsx` | La barre du choix — les parcours, eux, sont sur la carte. |
| `car/CarNavigationPanel.tsx` | Le bandeau, les voies, le compteur, la barre du bas. |
| `car/carSimulate.ts` | Un conducteur fictif (développement seulement). |
| `car/data/tolls.ts` | **Engendré** — gares de péage et grille tarifaire APRR/AREA. |
| `car/data/radars.ts` | **Engendré** — les radars fixes du ministère de l'Intérieur. |

Les deux derniers sont réécrits par `npm run build:car-data`
(`scripts/build-car-data.mjs`) : **ne pas les éditer à la main**. Ils sont
chargés par import dynamique au premier itinéraire voiture, et ne pèsent donc
rien au démarrage — 40 et 28 ko compressés, dans leur propre fragment.

## Les fichiers touchés hors du dossier

Pour retirer la fonctionnalité, `rm -rf src/navigation/` puis défaire ces
fichiers — chaque endroit y est signalé par un commentaire qui nomme ce
dossier :

1. **`src/App.css`** — la ligne `@import "./navigation/navigation.css";`.
2. **`src/App.tsx`** — l'appel à `useNavigation()`, le rendu de
   `<NavigationPanel>`, le trajet passé à la carte (`navigation.mapRoute ?? route`),
   la position retirée pendant le guidage, les conditions `!navigation.active`
   qui effacent l'interface, et la prop `onStartNavigation` du panneau
   d'itinéraire.
3. **`src/components/ItineraryPanel.tsx`** — la prop `onStartNavigation` et le
   `<StartNavigationButton>` du bloc de résultat.
4. **`src/components/MapView.tsx`** — les props `navigation` et
   `onNavigationPan`, leurs deux effets, et `navArrowElement()`.
5. **`src/components/AppMenu.tsx`** — le `<NavigationSettings />` de la fenêtre
   des paramètres, l'entrée « Historique » du menu et son `<HistoryPanel />`,
   l'entrée « Modes » et son `<ModesSettings />`.

La navigation voiture en ajoute deux, et pas davantage :

6. **`src/config.ts`** — la ligne `TOMTOM_ROUTING_URL`.
7. **`package.json`** — le script `build:car-data`, avec
   `scripts/build-car-data.mjs`.

La sixième est une entorse assumée à la règle « le module n'ajoute rien à
`config.ts` », et elle est le prix d'une règle plus forte : **aucune URL de
service ne se code hors de `config.ts`**, parce que c'est là que se lit le
passage à l'auto-hébergement. La clé TomTom et l'URL des tuiles de trafic y
sont déjà ; y séparer la seule URL de calcul d'itinéraire aurait coûté plus
cher que la ligne qu'elle fait défaire.

Rien à défaire ailleurs : le module n'ajoute aucun type à `src/types.ts` ni
aucune clé à `src/i18n/`.

## Décisions à connaître avant d'y toucher

- **Deux guidages, deux sessions.** Le piéton avance dans l'espace, le voyageur
  dans l'horaire : `useNavigation` et `useTransitNavigation` ne partagent que
  `NavMapState`, que l'un remplit d'une caméra et l'autre d'une emprise. Les
  deux ne sont jamais actives ensemble.
- **En transports, l'horaire est le moteur**, le GPS ne fait que confirmer et
  deux flèches permettent de recaler — un train en retard rend l'horaire faux et
  il faut pouvoir le dire. Le décalage manuel se garde en **nombre d'actions**,
  ce qui le rend valable pour la suite du trajet.
- **Les sorties de station sont réservées aux modes fermés** (métro, RER,
  train) : un arrêt de bus a presque toujours une bouche de métro à moins de
  350 m, et lui proposer une sortie enverrait sous terre quelqu'un qui est déjà
  dehors.

- **Les phrases sont ici, et non dans `src/i18n/`.** C'est la seule entorse à
  la règle du projet, et elle est le prix de la précédente : une clé ajoutée à
  `fr.ts` doit l'être aussi à `en.ts`, et retirer le dossier obligerait à
  repasser dans les deux dictionnaires. `strings.ts` suit le même patron —
  français de référence, anglais typé dessus, une clé manquante casse le
  build — et lit la langue en vigueur dans le magasin de `src/i18n`, si bien
  qu'un changement de langue redessine le bandeau comme le reste.
- **Trois guidages, trois sessions**, et aucune n'est une variante des autres.
  Le piéton avance dans l'espace, le voyageur dans l'horaire, le conducteur dans
  l'espace lui aussi mais à une échelle et avec des contraintes qui n'ont rien de
  commun : des annonces plus tôt, des vitesses limites, une logique de voie, un
  choix d'itinéraire avant de partir. Les trois ne partagent que `NavMapState`,
  que `MapView` sait lire, et le localisateur `locateOnPath` — la seule partie
  réellement délicate, et la seule qu'il aurait été coûteux d'écrire deux fois.

### La voiture (`car/`)

- **TomTom quand la clé existe, OSRM sinon**, et le mode ne cesse jamais de
  fonctionner faute de clé — la règle du projet, celle de Mapillary et de la
  vigilance. Ce que TomTom apporte et qu'OSRM ignore, tout mesuré : la durée
  avec le trafic **en cours**, les sections à péage, les vitesses limites
  (`sectionType=speedLimit`), et les **voies à emprunter**
  (`sectionType=lanes`, chaque voie portant ses flèches et un marqueur
  `follow`). Sans clé, il n'y a qu'une proposition et la barre du choix le dit.
  L'API autorise l'origine croisée : aucun relais à prévoir, contrairement à
  Bison Futé et au jeton Météo-France.
- **Les manœuvres d'OSRM sont traduites dans le vocabulaire de TomTom**, et non
  l'inverse : c'est le plus riche des deux, et aligner sur le plus pauvre
  appauvrirait le guidage là où la clé existe.
- **Trois appels pour un départ**, sur un palier de 20 000 par mois : deux pour
  comparer les itinéraires (sans les manœuvres ni les voies, qui pèsent cinq
  fois le reste), un pour le guidage détaillé de celui qu'on retient.
- **Le choix de péage survit au recalcul.** Qui est parti sans péage ne doit pas
  y être ramené parce qu'il a manqué une sortie.
- **Les voies écartées restent parfaitement lisibles.** Ce qui distingue la voie
  à prendre est une **inversion** — encre claire sur fond plein contre encre
  sombre sur fond clair — et non une opacité : une version les délavait à 45 %,
  et l'on ne comptait plus les files à traverser. Les flèches sont dessinées et
  non écrites, dans une boîte 28 × 60 qui leur donne leur allongement.
- **La vitesse ne s'éteint jamais et ne ment jamais.** Mesure du récepteur quand
  il la donne ; sinon déduite de deux relevés, filtrée par une médiane puis une
  moyenne. Pâlie quand plus aucun relevé n'arrive. L'indicateur de dépassement a
  une hystérésis, et une marge élargie quand la vitesse est déduite — moins sûre,
  donc moins prompte à accuser.
- **En voiture, l'écran se vide une fois parti.** Toute la colonne de droite
  s'efface — météo, boussole, signets, catégories, calques, bouton de position —
  contrairement au guidage piéton, qui garde ses menus. On ne règle pas des
  calques au volant. Le burger reste à gauche, il porte les réglages du guidage.
- **Le numéro de route est une pastille colorée et plus grosse que le nom de la
  rue** : on repère « A6 » sans le lire, un nom de voie se lit. Les couleurs sont
  celles des **bornes routières françaises** — rouge pour les autoroutes et les
  nationales, jaune pour les départementales, blanc pour les voies communales et
  rurales, vert pour les européennes et les forestières, bleu cyan pour les
  réseaux métropolitains (`M`). Ne pas les redistribuer par ordre d'importance :
  que l'autoroute et la nationale partagent le rouge est exact, la pastille sert
  à reconnaître une route et non à la classer.
- **Le choix se fait sur la carte**, et non dans une fenêtre : celle qui existait
  masquait précisément ce qu'on veut regarder pour choisir, et son voile
  empêchait même de déplacer la vue. Les bulles se posent là où chaque parcours
  s'écarte le plus des autres (`bubbleAnchors`) ; il faut **deux contacts** pour
  partir, parce qu'au doigt il n'y a pas de survol.
- **Deux mécanismes distincts, à ne pas confondre.** Le *recalcul* répare notre
  écart au parcours (deux relevés au-delà de 50 m). La *réévaluation*, toutes les
  trois minutes, répond à la route qui se bouche devant alors qu'on suit son
  chemin.
- **La réévaluation compare deux mesures fraîches**, et c'est le point délicat :
  notre parcours épinglé sur ses points d'appui, donc ré-horodaté au trafic du
  moment, contre le meilleur parcours possible depuis ici. Comparer le détour au
  temps restant *affiché* ne marche pas — celui-ci est figé au calcul du trajet
  et n'augmente jamais quand un bouchon se forme, si bien que le détour perdait
  toujours. L'écart entre les deux corrige aussi l'heure d'arrivée.
- **Un prix n'est affiché que s'il est officiel.** Seules APRR et AREA publient
  leur grille — de l'ordre du tiers du réseau concédé. Ailleurs, « tarif non
  publié ». Le choix a été posé explicitement contre une estimation
  kilométrique : dans un écran où l'on compare trois prix, un chiffre estimé est
  comparé quand même. Corollaire dans `proposals.ts` : un péage seulement
  **partiellement** chiffré ne rend qu'un plancher, et ne peut donc jamais
  fonder la proposition « moins cher ».
- **Les bornes d'une section à péage ne sont pas les gares** — mesuré, 3,8 km et
  8,5 km d'écart sur Paris → Lyon. Le prix se trouve en cherchant les gares que
  le tracé **traverse**, puis le couple le plus étendu que la grille connaisse.
  Vérifié : Paris → Lyon 41,30 €, Dijon → Lyon 16,00 €, Beaune → Besançon
  5,40 €, Paris → Bordeaux non publié.
- **Le son est réservé aux radars**, et c'est le seul de l'application. Une
  application qui parle à chaque virage finit qu'on la coupe, et le seul moment
  où l'on veut être prévenu sans regarder l'écran passe alors inaperçu. La
  sortie audio se prépare **dans le clic de « Démarrer »** — les navigateurs ne
  créent pas de contexte audio ailleurs — au même endroit et pour la même
  raison que les capteurs de mouvement du guidage piéton.
- **La simulation accélère la position, pas le compteur.** Vingt-cinq fois
  l'allure réelle pour voir défiler quarante manœuvres, mais la vitesse annoncée
  reste celle qu'on tiendrait vraiment — sinon l'indicateur afficherait trois
  mille kilomètres-heure et resterait rouge, c'est-à-dire qu'il ne serait pas
  testable, ce pour quoi la simulation existe. Comme à pied, développement
  seulement, deux verrous plutôt qu'un.
- **Le suivi de position est indépendant de `useGeolocation`.** Ce dernier rend
  une position à la demande (`getCurrentPosition`) et son interface est promise
  au portage Capacitor : elle ne doit pas changer. Le guidage a besoin d'un
  flux continu, d'où `useNavPosition` et son `watchPosition`. Le remplacer par
  `@capacitor/geolocation` se fait au même endroit et de la même façon.
- **Le dénivelé vient des tuiles d'altitude déjà utilisées par l'ombrage**
  (`CONFIG.TERRAIN_TILE_URL`, encodage « terrarium »), pas d'un service de
  profil. Elles sont mondiales, sans clé, et souvent déjà dans le cache du
  navigateur puisque le relief les demande. Aucune source à ajouter, aucune
  limite d'appels à surveiller.
- **Le profil n'est calculé qu'au dépli du détail**, comme tout ce qui coûte
  un téléchargement dans ce projet : quelques tuiles de 55 à 155 ko qu'un
  marcheur ne regardera pas forcément.
- **Le cadrage se règle dans les paramètres** (`useNavCamera.ts`, section
  « Navigation ») et vaut « adaptatif » par défaut : le zoom se déduit alors de
  la distance à la prochaine manœuvre, de sorte que la position et le point où
  l'on tourne tiennent ensemble dans l'écran, et que la carte se resserre à
  l'approche du carrefour. « Fixe » rend l'échelle constante d'avant ce réglage.
  Dans les deux cas le centre ne bouge pas du marcheur : c'est l'échelle qui
  travaille, pas le cadrage. `LOOK_AHEAD_SHARE` dans `useNavigation.ts` est le
  seul réglage à toucher pour changer la hauteur à laquelle la manœuvre apparaît.
- **La carte reste vue de dessus, et c'est le repère qui est décentré** : le
  marcheur est assis aux deux tiers de la hauteur par la `padding` de la caméra.
  Centré, la moitié de l'écran montrerait le chemin déjà parcouru ; penchée, la
  carte gagnerait du terrain mais écraserait les distances vers l'horizon. La
  marge est **retirée à l'arrêt**, sinon tous les recentrages suivants viseraient
  le bas de l'écran.
- **Tous les menus restent ouverts pendant le guidage**, le burger et la colonne
  météo/boussole descendant sous le bandeau (`.app-shell.is-navigating`). Seule
  la barre de recherche ne revient pas : elle occupe la ligne du bandeau.
- **Le bouton de recentrage vit dans la même colonne que la barre**
  (`.nav-dock`), et non à un décalage chiffré au-dessus d'elle : la barre grandit
  de deux cents pixels quand le détail se déplie, et tout nombre écrit à la main
  finit par passer dessous.
- **L'historique va dans IndexedDB, pas dans `localStorage`**, contrairement aux
  autres réglages du projet : un trajet porte son tracé et son profil de
  dénivelé, deux à dix kilo-octets pièce, et l'écriture de `localStorage` est
  synchrone — elle bloquerait le fil principal au moment précis où l'on vient
  d'arriver. La base porte son propre nom : supprimer le dossier laisse une base
  orpheline, que le navigateur nettoiera avec le reste des données du site.
- **« Ma position » ne va pas dans un historique** : `App` laisse l'extrémité
  sans nom, et le guidage lui trouve son adresse par géocodage inverse au
  départ. Le trajet part sans attendre la réponse.
- **Le partage est une image**, qui porte tout le bloc du détail. Elle est
  redessinée sur un canvas (`tripCard.ts`) et non capturée du DOM — aucune API
  du navigateur ne sait faire cela — la carte étant, elle, une vraie capture.
- **Le chemin de sortie dépend de l'appareil** : feuille de partage du système
  sur téléphone et tablette, presse-papiers puis téléchargement sur ordinateur —
  Linux, Windows et macOS traités pareil, pour n'avoir qu'un geste à connaître.
- **L'image est prête avant le clic, jamais fabriquée pendant.** La feuille de
  partage ne s'ouvre que dans le geste même de l'utilisateur ; un `await` avant
  `navigator.share` fait perdre cette autorisation et le partage retombe sur
  l'enregistrement. Le bouton reste grisé le temps du rendu — ne pas
  « simplifier » son gestionnaire en le rendant asynchrone.
- **Un trajet garde des nombres, jamais des phrases** : vitesse, allure, écart
  au temps annoncé et titre se recalculent au rendu. Changer de langue refait
  ainsi l'affichage d'un historique vieux de six mois, ce qu'une chaîne figée
  interdirait.
- **Le temps annoncé est celui de la portion parcourue**, accumulé d'un
  recalcul à l'autre : s'arrêter à mi-chemin se compare à la moitié annoncée,
  pas au trajet entier. C'est le sens de « ajusté selon l'endroit où l'on appuie
  sur Terminer ».
- **Le comptage des pas est un compteur maison**, sur l'accéléromètre : aucun
  navigateur ne donne accès au podomètre du système. `useStepCounter.ts` est
  écrit pour être remplacé tel quel au packaging APK, comme `useGeolocation` —
  l'en-tête du fichier dit ce qu'il faudra (greffon Capacitor, permission
  `ACTIVITY_RECOGNITION` — retirée du manifeste tant qu'aucun greffon ne s'en
  sert —, `source` passant à `"device"`). La demande d'accès aux
  capteurs se fait **dans le clic du bouton « Démarrer »** : iOS ne l'accorde que
  depuis un geste, et le contexte du geste est perdu dans un effet.
- **Le recalcul suit l'écart, pas le premier pas de travers** : il faut
  `OFF_ROUTE_FIXES` relevés consécutifs au-delà de `OFF_ROUTE_METERS` du tracé.
  Un relevé GPS isolé rebondit de vingt mètres sous les arbres ; recalculer à
  chaque rebond viderait le quota d'OSRM et ferait clignoter l'instruction.
  Un recalcul raté attend avant de retenter — 5 s, puis 10, 20, 40, une minute
  au plus (`rerouteRetryDelayMs`, `progress.ts`) — au lieu de repartir tous les
  trois relevés tant que le réseau manque.
