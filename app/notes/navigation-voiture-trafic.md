# Navigation voiture, trafic et péages — relevé TomTom et données ouvertes

**Relevé du 9 septembre 2026**, à la demande, pour préparer le chantier
« navigation voiture ». Tout ce qui suit a été **mesuré** — appels réels à
l'API TomTom avec la clé du projet, et téléchargement des jeux de données —
et non lu dans une page de présentation. Les chiffres de quota, eux, viennent
de la page tarifs et peuvent changer : à revérifier avant de s'y fier.

Ce n'est **pas** une spécification. C'est l'état des sources au moment du
relevé, et l'ordre dans lequel il paraît raisonnable d'attaquer.

## Le besoin, tel qu'il a été formulé

Trois choses, pour la voiture :

1. la route **la plus rapide** ;
2. un parcours qui **change selon la circulation** en cours de route ;
3. le **prix des autoroutes**.

Les deux premières sont couvertes par TomTom. La troisième ne l'est pas, et
c'est là que se trouve toute la difficulté.

## Ce que l'API Routing de TomTom donne

Palier gratuit relevé : **20 000 requêtes par mois** pour l'API Routing, sans
carte bancaire. Une requête par calcul d'itinéraire, quelle que soit la
distance — c'est le nombre de calculs qui compte, jamais les kilomètres.

Appel test : `calculateRoute` Paris → Lyon, `routeType=fastest`, `traffic=true`,
`computeTravelTimeFor=all`, `sectionType=tollRoad`, `language=fr-FR`.

| Ce qu'on veut | Paramètre | Ce que la réponse a donné |
| --- | --- | --- |
| Route la plus rapide | `routeType=fastest` | 464 km, instructions en français |
| Selon le trafic | `traffic=true` | **283 min** avec trafic, 251 sans, 270 en historique |
| Chiffrer le retard | `computeTravelTimeFor=all` | `trafficDelayInSeconds: 989` |
| Recalcul dynamique | `supportingPoints` + `minDeviationDistance` / `minDeviationTime` | documenté ; on renvoie le reste du parcours et le moteur ne propose un autre chemin que s'il fait gagner assez |
| Éviter les péages | `avoid=tollRoads` | — |
| Alternatives | `maxAlternatives`, `alternativeType` | — |

`minDeviationDistance` / `minDeviationTime` sont le point à retenir : c'est le
mécanisme prévu pour qu'un itinéraire **ne change pas à chaque bouffée de
trafic**. Sans eux, un recalcul périodique ferait osciller le parcours.

### Ce que TomTom ne donne pas : le prix

La documentation de `calculateRoute` compte **63 occurrences de « toll » et
zéro de « price », « cost » ou « currency »**. La réponse réelle le confirme :
une section à péage s'y réduit à

```json
{ "startPointIndex": 791, "endPointIndex": 4777, "sectionType": "TOLL_ROAD" }
```

On sait donc **qu'on paie**, jamais **combien**. Ne pas repartir chercher dans
cette API : `sectionType` accepte `tollRoad`, `toll` et `tollVignette`, et
aucune de ces valeurs n'amène de montant.

## Le prix des péages : deux jeux publics, et leurs limites

Tous deux gratuits, en HTTPS, avec `access-control-allow-origin: *` — donc
lisibles directement par le navigateur, **sans le relais** qu'exige Bison Futé.

### Tarifs autoroutes APRR / AREA

`https://www.data.gouv.fr/fr/datasets/tarifs-autoroutes-aprr/`

CSV de 1,2 Mo, **21 505 couples** gare d'entrée → gare de sortie, cinq classes
de véhicule, à jour de février 2026 :

```
gare_entree,gare_sortie,distance_tarifaire_km,tarif_classe_1,…,tarif_classe_5
ALLAINES,AMBERIEU,462.61,58.2,89.1,143.0,190.7,32.8
```

### Gares de péage du réseau concédé

`https://www.data.gouv.fr/fr/datasets/gares-de-peage-du-reseau-routier-national-concede/`

CSV de 120 ko, **1 266 gares** nommées (`nomGare`), avec leur route et leur
position. Attention : les coordonnées sont en **Lambert-93 (EPSG:2154)**
(`x` ≈ 874 230, `y` ≈ 6 595 951), à reprojeter en WGS84.

### Les deux limites, à poser avant de promettre quoi que ce soit

1. **Seul APRR/AREA publie ses tarifs.** Recherche faite sur data.gouv.fr pour
   Vinci (ASF, Cofiroute, Escota), Sanef/SAPN, ATMB, SFTRF : rien
   d'exploitable. Cela couvre l'est et le centre — A6, A31, A36, A39, A40,
   A43 — soit de l'ordre du tiers du réseau concédé.
2. **Il faut apparier une section à des gares.** TomTom rend la section à péage
   en indices de points sur le tracé, pas en noms de gares. Il faut donc
   reprojeter les 1 266 gares, chercher les plus proches de l'entrée et de la
   sortie de la section, puis retrouver le couple dans la grille tarifaire.
   Faisable, mais approximatif aux extrémités — et sans valeur si le trajet
   traverse plusieurs réseaux.

## Ordre proposé si le chantier s'ouvre

1. **Le moteur voiture.** Passer le mode « voiture » à TomTom, en gardant OSRM
   en repli automatique quand la clé manque — le mode ne doit jamais cesser de
   fonctionner faute de clé, comme Mapillary et la vigilance ne cessent pas.
   À pied reste sur OSRM : le trafic n'y change rien, et OSRM n'a pas de quota.
2. **Le recalcul dynamique**, dans la session de navigation, avec
   `supportingPoints` et un seuil de déviation. C'est là que se joue la
   deuxième demande.
3. **Les péages**, en dernier, parce que c'est le morceau incertain. Prix
   officiel gare à gare là où APRR/AREA le publie, estimation kilométrique
   ailleurs, et **l'interface dit toujours de quoi il s'agit** — « 24,60 € » ou
   « ~18 € estimé », jamais un chiffre dont on ignore la nature.

## Deux questions restées ouvertes

Elles ont été posées et non tranchées ; c'est par là qu'il faut reprendre.

- **Le mode voiture passe-t-il vraiment à TomTom**, ou TomTom reste-t-il une
  option à côté d'OSRM ? Deux moteurs pour un même mode, ce sont deux formes de
  réponse à réconcilier.
- **Que faire là où le péage n'est pas chiffrable ?** Prix exact seul (rien sur
  les deux tiers du réseau), estimation seule (homogène mais approximative
  partout), ou les deux en disant lequel.

## Rappel utile : ce qui est déjà en place

Le calque « Trafic » existe déjà et n'a rien à voir avec ce chantier : il
affiche les événements de Bison Futé (gratuits, nationaux, via le relais du
serveur de développement) et, si une clé TomTom est renseignée, les tuiles de
débit. Voir `CLAUDE.md`, section « Calque Trafic ». Un défaut connu y est
signalé : **les tuiles de débit ne sont jamais rafraîchies** une fois le calque
allumé.

---

## Suite donnée — chantier ouvert et livré le 11 septembre 2026

Ce relevé a servi de point de départ ; le chantier est fait, et vit dans
`src/navigation/car/` (voir `CLAUDE.md`, section « Navigation voiture »). Ce qui
suit corrige ou complète ce qui précède, **mesuré à nouveau** ce jour-là.

### Les deux questions restées ouvertes ont été tranchées

- **Le mode voiture passe à TomTom quand la clé existe, OSRM en repli
  automatique.** Le mode ne cesse donc jamais de fonctionner faute de clé, comme
  Mapillary et la vigilance. Les deux moteurs rendent la même forme de réponse :
  les manœuvres d'OSRM sont traduites dans le vocabulaire de TomTom, qui est le
  plus riche des deux.
- **Le péage non chiffrable ne s'estime pas.** Un montant n'est affiché que s'il
  est officiel ; ailleurs, « tarif non publié ». La raison a pesé plus lourd que
  la couverture : dans un écran où l'on compare trois prix, un chiffre estimé
  est comparé quand même.

### Trois choses que ce relevé ignorait, et qui changent la donne

1. **`sectionType=speedLimit` rend la vitesse autorisée** (`maxSpeedLimitInKmh`),
   41 sections sur Paris → Lyon, 196 sur Dijon → Lyon. L'indicateur de vitesse
   n'a donc besoin d'aucune source supplémentaire.
2. **`sectionType=lanes` rend les voies à emprunter**, chacune avec ses flèches
   et un marqueur `follow` sur celles qui mènent où l'on va. C'est l'indication
   « sur quelle file se mettre », donnée par la source sans déduction.
3. **L'API Routing autorise l'origine croisée** (`access-control-allow-origin`
   renvoyé sur l'origine demandeuse). Contrairement à Bison Futé et au jeton
   Météo-France, **aucun relais n'est nécessaire**, ni en développement ni en
   production.

À noter aussi : `instructionsType=text` **sans** `guidanceVersion=2`. La
version 2 supprime `pointIndex`, qui est ce qui permet de poser une manœuvre sur
notre propre tracé.

### Le prix : la méthode qui marche

Ce relevé proposait d'apparier une section à péage à des gares en cherchant les
plus proches de ses deux extrémités. **Mesuré, cela ne fonctionne pas** : les
bornes d'une section ne sont pas les gares — 3,8 km d'écart à l'entrée et 8,5 km
à la sortie sur Paris → Lyon.

Ce qui fonctionne : chercher les gares que le tracé **traverse** (à moins de
400 m), les ordonner le long du parcours, et retenir le couple le plus étendu
que la grille connaisse — on a payé de la première barrière franchie à la
dernière. Vérifié : Paris → Lyon 41,30 €, Dijon → Lyon 16,00 €,
Beaune → Besançon 5,40 €, Paris → Bordeaux non publié (Cofiroute).

Deux pièges de la grille APRR que ce relevé ne mentionnait pas : ses deux
colonnes ne sont pas de la même finesse (142 noms d'entrée grossiers comme
`AUXERRE` contre des sorties précises comme `AUXERRE NORD`), et elle contient
des libellés composés pour les trajets inter-réseaux. Après filtrage sur les
couples dont les deux gares sont localisables, il reste **9 278 couples sur
22 460**, et 154 gares.

### Les radars : ne pas reprendre le jeu qu'on trouve en premier

Le chantier a ajouté l'avertissement de radar, qui n'était pas dans ce relevé.
Le jeu « Radars automatiques » qui sort en tête d'une recherche data.gouv.fr
**date de 2018**. Celui à utiliser est « Liste des radars fixes en France », du
ministère de l'Intérieur : dernière publication décembre 2025, 3 309 radars,
170 ko, latin-1 et point-virgule, avec la vitesse autorisée et le type, origine
croisée autorisée.

### Ce qui n'a pas bougé

Tout le reste de ce relevé reste exact : TomTom ne donne toujours pas le prix
des péages (deux points d'accès essayés en plus, `computeTollCosts` et Orbis v2,
tous deux refusent le paramètre), seuls APRR et AREA publient leurs tarifs, et
TRAFICOLOR reste inexploitable faute de géométrie.

### La réévaluation selon le trafic : ce que le relevé ne disait pas

`supportingPoints` + `minDeviationTime` fonctionne bien comme ce relevé
l'annonçait, et **en POST depuis le navigateur** — le préflight est autorisé
(`access-control-allow-methods: GET,POST`, `content-type` accepté), ce qui n'est
pas le cas du point d'authentification de Météo-France.

Un piège mesuré en revanche, et qu'il faut connaître : le mécanisme est sensible
aux points qu'on lui donne. Échantillonner le tracé un point tous les 3 km rend
**parfois** un parcours de 20 km et 25 minutes de plus que celui qu'on suit — un
appui isolé se raccroche à la mauvaise chaussée et le moteur s'oblige à y
passer. À un appui tous les 1,6 km le parcours est reconstitué à la minute près.
Dans tous les cas, le gain est revérifié avant d'adopter quoi que ce soit : le
moteur propose, l'application dispose.

### Le piège de la réévaluation : comparer deux mesures fraîches

`supportingPoints` + `minDeviationTime` ne suffit pas à faire changer
d'itinéraire quand un bouchon se forme, et l'erreur est facile à commettre.

Le temps restant d'un trajet se déduit des durées **figées au moment de son
calcul**. Un embouteillage qui apparaît devant ne l'allonge donc jamais.
Comparer un itinéraire de rechange — chiffré au trafic du moment — à ce temps
restant revient à opposer aujourd'hui à il y a une heure : le détour est toujours
perdant, et le guidage ne change jamais de route.

Il faut deux appels, et deux mesures fraîches :

1. notre parcours **épinglé** sur ses points d'appui, avec un `minDeviationTime`
   très élevé (100 000 s) : le moteur rend alors le trajet qu'on suit,
   ré-horodaté au trafic du moment. Mesuré sur Paris → Lyon : 466 km identiques,
   272,8 min contre 267 min au calcul initial, `trafficDelayInSeconds` à l'appui ;
2. le **meilleur parcours** depuis la position courante, sans contrainte.

On change si le second gagne cinq minutes sur le premier. L'écart entre le
parcours épinglé et le temps qu'on annonçait donne en prime la correction de
l'heure d'arrivée — utile même quand on ne change pas de route.
