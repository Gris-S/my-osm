<div align="center">

<img src="app/public/icon-512.png" alt="" width="128" height="128">

# MY OSM

**Une carte qui garde vos lieux pour elle.**

Commerces et horaires, transports en temps réel, navigation pas à pas et cartes
hors ligne — fondée sur OpenStreetMap, sans compte, sans pistage, et sans rien
envoyer à Google.

[![Licence](https://img.shields.io/badge/licence-GPL--3.0--or--later-blue.svg)](LICENSE)
![Plateforme](https://img.shields.io/badge/plateforme-Android-green.svg)
![État](https://img.shields.io/badge/état-alpha-orange.svg)

*English: [README.md](README.md)*

</div>

---

## Où l'obtenir

| | |
| --- | --- |
| **Android** | [Releases](https://github.com/Gris-S/my-osm/releases) — l'APK s'installe directement |
| **F-Droid** | Demande déposée ([merge request !49227](https://gitlab.com/fdroid/fdroiddata/-/merge_requests/49227)), en attente de revue. La construction est reproductible : F-Droid distribuera l'APK publié ici, à l'identique |
| **Docker** | `ghcr.io/gris-s/my-osm:latest` — la version web pour grand écran, voir [docker/README.md](docker/README.md) |

C'est une **alpha** : elle fonctionne, elle sert tous les jours, et elle bouge
encore.

---

## À quoi ça ressemble

<table>
<tr>
<td width="33%" align="center">
<img src="docs/screenshots/01-map.png" width="220" alt="Carte de Paris avec les commerces, chacun avec son pictogramme"><br>
<b>Des lieux, pas du bruit</b><br>
<sub>Commerces, cafés, transports — chaque pastille dit ce qu'est le lieu : un fromage, un poisson, un croissant.</sub>
</td>
<td width="33%" align="center">
<img src="docs/screenshots/02-place.png" width="220" alt="Fiche d'un lieu avec ses horaires"><br>
<b>Ouvert ou fermé, maintenant</b><br>
<sub>Horaires, adresse, téléphone et site, l'itinéraire à portée de doigt.</sub>
</td>
<td width="33%" align="center">
<img src="docs/screenshots/03-osm.png" width="220" alt="Formulaire d'ajout d'un lieu à OpenStreetMap"><br>
<b>L'ajouter à OpenStreetMap</b><br>
<sub>Un commerce que la carte ignorait ? On vérifie le formulaire pré-rempli, et le suivant le trouve.</sub>
</td>
</tr>
<tr>
<td width="33%" align="center">
<img src="docs/screenshots/04-transit.png" width="220" alt="Prochains passages à un arrêt"><br>
<b>Passages en direct</b><br>
<sub>Les prochains passages à tout arrêt, et si chacun est mesuré ou théorique.</sub>
</td>
<td width="33%" align="center">
<img src="docs/screenshots/05-navigation.png" width="220" alt="Navigation pas à pas"><br>
<b>Pas à pas</b><br>
<sub>À pied, à vélo, en voiture et en transports, avec trafic, limitations et voies sur la route.</sub>
</td>
<td width="33%" align="center">
<img src="docs/screenshots/06-categories.png" width="220" alt="Menu des catégories"><br>
<b>Votre carte, votre filtre</b><br>
<sub>16 catégories à allumer ou éteindre, des commerces de bouche au stationnement.</sub>
</td>
</tr>
<tr>
<td width="33%" align="center">
<img src="docs/screenshots/07-offline.png" width="220" alt="Téléchargement d'une zone hors ligne"><br>
<b>Hors ligne</b><br>
<sub>Un pays, une région ou un département, gardé sur l'appareil d'un toucher.</sub>
</td>
<td width="33%" align="center">
<img src="docs/screenshots/08-satellite.png" width="220" alt="Vue satellite"><br>
<b>Satellite et relief</b><br>
<sub>Imagerie aérienne, ombrage du relief et courbes de niveau, en clair ou en sombre.</sub>
</td>
<td width="33%" align="center">
<img src="docs/screenshots/09-dark.png" width="220" alt="La carte en thème sombre"><br>
<b>Jour et nuit</b><br>
<sub>Un thème sombre qui suit le capteur de lumière du téléphone.</sub>
</td>
</tr>
</table>

---

## Ce qu'elle fait

**Trouver des lieux**
- 16 catégories à allumer ou éteindre — épiceries, commerces de bouche, restaurants, bars, santé, beauté, mode, maison, culture, parcs, sport, hôtels, transports, stationnement…
- Chaque pastille dit ce qu'est le lieu (un fromage pour une fromagerie, un poisson pour une poissonnerie…)
- Des horaires qui disent si le lieu est ouvert **maintenant**
- Une recherche qui met les stations en tête, les recherches récentes, maison et travail d'un toucher
- Les lieux qu'OpenStreetMap ne connaît pas : un navigateur intégré cherche sur le web et rapporte la position sur la carte — sans jamais interroger Google
- Villes et quartiers : contour, population, surface, densité ; résumés et photos de Wikipédia

**Rendre à OpenStreetMap**
- Un lieu trouvé sur le web peut être **ajouté à OpenStreetMap** depuis sa fiche : formulaire pré-rempli, épingle à poser, vérification des doublons, confirmation avant l'envoi
- Une seule connexion, aucun mot de passe gardé ; éteint par défaut (Menu › Modes)

**S'y rendre**
- À pied, à vélo, en voiture et en transports en commun
- Vélo : le plus rapide ou le plus sûr côte à côte, pistes cyclables en vert, partout et sans clé
- Voiture : trafic en direct sur le trajet, limitations de vitesse, voies à suivre, radars, prix des péages quand il est publié
- Transports : passages en direct partout ([Transitous](https://transitous.org/)) et en Île-de-France (Île-de-France Mobilités) ; trajet suivi étape par étape, jusqu'à la sortie de station
- Un mode course avec son graphe d'allure
- Votre musique (n'importe quel lecteur) pilotable pendant la navigation
- Marches et courses gardées sur l'appareil avec tracé et dénivelé, aussi longtemps que vous le choisissez — ou pas du tout

**Hors ligne**
- Un pays, une région ou un département : tuiles, détails des lieux, index de recherche, adresses et Wikipédia, rangés **dans l'application**
- Navigation dans la carte, recherche et fiches marchent alors sans connexion

> **Limite assumée :** le calcul d'itinéraire demande toujours une connexion. Il
> n'y a pas de moteur de calcul sur l'appareil — l'application le dit
> franchement au lieu d'échouer en silence.

**Et le reste**
- Météo, qualité de l'air, pollens et vigilances de Météo-France
- Imagerie satellite, relief, courbes de niveau, bâtiments en 3D, calque du trafic
- Photos de rue de Mapillary
- Lieux enregistrés dans des dossiers de couleur
- Thèmes clair et sombre, le sombre suivant le capteur de lumière
- Français et anglais
- Une image Docker pour grand écran, avec les mêmes fonctions sauf le mode course

---

## Pourquoi elle existe

Parce qu'une carte ne devrait pas être le prix à payer pour savoir où l'on est.

- **Rien ne part chez Google.** Ni Firebase, ni Analytics, ni Play Services, ni
  Google Maps. La sauvegarde cloud d'Android et le transfert d'appareil à
  appareil sont coupés pour cette application, et les statistiques comme le Safe
  Browsing de la WebView sont désactivés. Le navigateur intégré bloque purement
  et simplement tous les hôtes Google.
- **Aucun compte nécessaire.** Rien à créer. La seule connexion possible est à
  votre propre compte OpenStreetMap, et seulement si vous choisissez d'y ajouter
  des lieux.
- **Vos données restent sur le téléphone.** Lieux enregistrés, adresses Maison et
  Travail, historique des trajets et cartes téléchargées ne quittent pas
  l'appareil. Il n'y a aucun serveur où aller.
- **Les clés facultatives restent les vôtres.** Elles se saisissent dans
  l'application (Menu › API) et y restent. Elles ne sont **jamais compilées dans
  un livrable publié** — la version à partager refuse de se construire si l'une
  d'elles est renseignée.
- **Logiciel libre.** GPL-3.0-or-later, source incluse, forks bienvenus.

---

## Sources des données

Tout ce qui est affiché appartient à ses auteurs et suit sa propre licence ;
l'application les crédite toutes dans *Menu › Sources et licences*.

OSM et OpenStreetMap sont des marques de la Fondation OpenStreetMap, utilisées
avec sa permission. MY OSM n'est ni approuvée par la Fondation OpenStreetMap, ni
affiliée à elle.

| | |
| --- | --- |
| Données de la carte, lieux, arrêts | contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL |
| Tuiles vectorielles | [OpenFreeMap](https://openfreemap.org/) |
| Lieux absents des tuiles, détails des lieux | [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) (overpass-api.de, private.coffee) |
| Ajout de lieux | [API d'OpenStreetMap](https://wiki.openstreetmap.org/wiki/API_v0.6), avec votre propre compte |
| Recherche et adresses | [Photon](https://photon.komoot.io/), [Base Adresse Nationale](https://adresse.data.gouv.fr/) |
| Itinéraires | [OSRM](https://routing.openstreetmap.de/), [Valhalla](https://github.com/valhalla/valhalla) et [BRouter](https://brouter.de/brouter/) pour le vélo, TomTom (clé facultative) |
| Transports | [Transitous](https://transitous.org/sources/), Île-de-France Mobilités (clé facultative) |
| Météo et air | [Open-Meteo](https://open-meteo.com/), Météo-France (clé facultative) |
| Imagerie et relief | Esri (vue en ligne seulement), [IGN](https://geoservices.ign.fr/) (aussi hors ligne, en France), Mapzen/USGS/SRTM |
| Photos de rue | [Mapillary](https://www.mapillary.com/) (clé facultative) |

Aucune clé n'est nécessaire. Sans elles l'application fonctionne — les transports
passent partout par Transitous, et les à-côtés disent simplement ce qui leur
manque.

---

## La construire soi-même

```bash
# Version web, en développement
cd app && npm install && npm run dev

# APK Android (reconstruit le web, puis Android)
source ~/.local/share/android-env.sh
cd apk && npm install && npm run apk          # débogable, pour développer
cd apk && npm run apk:release                 # celle qu'on partage
```

L'application web vit dans `app/` (React + Vite + MapLibre). `apk/` n'est que la
coquille Capacitor autour — **le code ne se modifie que dans `app/`**.

```
MY OSM/
├── app/         le code source            (README.md, CLAUDE.md à l'intérieur)
├── apk/         l'enveloppe Android       (aucune logique applicative)
├── docs/        architecture et audits
└── outils/      sauvegarde et journal
```

### Clés d'API

Les clés gratuites et facultatives (Île-de-France Mobilités, TomTom, Mapillary,
Météo-France) se saisissent **dans l'application** (Menu › API), où elles restent
sur l'appareil et se changent sans recompiler.

`app/.env.local` reste possible pour une construction locale (voir
`app/.env.example`), mais tout ce qui s'appelle `VITE_*` est **compilé dans le
programme** : qui a le fichier construit a la clé. La version à partager est donc
construite avec ces variables vidées, et le build **échoue** si l'une d'elles est
encore renseignée. Elles ne sont jamais versionnées.

---

## Soutien

MY OSM est gratuite, sans publicité et ne collecte rien. Si elle vous sert, vous
pouvez [m'offrir un café](https://buymeacoffee.com/gris_) — c'est facultatif, et
l'application fonctionne pareil dans les deux cas.

---

## Licence

MY OSM est un logiciel libre sous **GNU General Public License v3.0 ou
ultérieure** (voir [LICENSE](LICENSE)). Vous pouvez l'utiliser, l'étudier, le
modifier et le redistribuer ; toute version modifiée que vous diffusez doit
rester sous la même licence, code source compris.
