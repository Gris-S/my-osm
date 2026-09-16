<div align="center">

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
| **F-Droid** | Dépôt en préparation — l'application respecte déjà leurs règles : chaîne d'outils libre, aucun SDK propriétaire, et **aucune clé d'API compilée dans le livrable** |
| **Web** | En chantier. Le même code tourne comme site installable, mais il n'est pas encore publié |

C'est une **alpha** : elle fonctionne, elle sert tous les jours, et elle bouge
encore.

---

## À quoi ça ressemble

<table>
<tr>
<td width="33%" align="center">
<img src="docs/screenshots/01-map.png" width="220" alt="Carte avec commerces et cafés"><br>
<b>Des lieux, pas du fouillis</b><br>
<sub>Commerces, cafés, transports — lus dans les tuiles elles-mêmes, donc affichés sans attente.</sub>
</td>
<td width="33%" align="center">
<img src="docs/screenshots/02-place.png" width="220" alt="Fiche d'un lieu avec ses horaires"><br>
<b>Ouvert ou fermé, maintenant</b><br>
<sub>Horaires, adresse, téléphone et site, l'itinéraire à portée d'un doigt.</sub>
</td>
<td width="33%" align="center">
<img src="docs/screenshots/03-transit.png" width="220" alt="Prochains passages à un arrêt"><br>
<b>Passages en direct</b><br>
<sub>Les prochains passages à un arrêt, et si chacun est mesuré ou théorique.</sub>
</td>
</tr>
<tr>
<td width="33%" align="center">
<img src="docs/screenshots/04-navigation.png" width="220" alt="Navigation voiture pas à pas"><br>
<b>La navigation au volant</b><br>
<sub>Instruction après instruction, avec la circulation en direct, les vitesses limites et les voies à emprunter.</sub>
</td>
<td width="33%" align="center">
<img src="docs/screenshots/05-offline.png" width="220" alt="Téléchargement d'une zone hors ligne"><br>
<b>Emportez-la</b><br>
<sub>Touchez un pays, une région ou un département : tout reste sur l'appareil.</sub>
</td>
<td width="33%" align="center">
<img src="docs/screenshots/06-satellite.png" width="220" alt="Vue satellite"><br>
<b>Satellite et relief</b><br>
<sub>Imagerie aérienne, ombrage et courbes de niveau, en clair comme en sombre.</sub>
</td>
</tr>
</table>

---

## Ce qu'elle fait

**Trouver.** Commerces, cafés, pharmacies, transports et le reste, rangés en
16 catégories qu'on allume et éteint. Les horaires disent si un lieu est ouvert
*maintenant*, pas seulement quelles sont ses heures. Quand OpenStreetMap ne
connaît pas un endroit, un navigateur intégré le cherche sur le web et rapporte
sa position sur la carte — sans jamais interroger Google.

**Y aller.** À pied, en voiture et en transports, plus un mode course avec son
graphe d'allure. La navigation voiture montre la circulation en cours sur le
trajet, les vitesses limites, les voies à emprunter et les radars. Chaque marche
et chaque course est gardée sur l'appareil, avec son tracé et son dénivelé, aussi
longtemps que vous le décidez — ou pas du tout.

**Prendre les transports.** Horaires en direct partout par
[Transitous](https://transitous.org/), et en Île-de-France par Île-de-France
Mobilités. Le trajet se suit pas à pas : où monter, dans quelle direction, où
descendre, par quelle sortie de station.

**Partir hors ligne.** Téléchargez un pays, une région ou un département : les
tuiles, les détails des lieux, l'index de recherche et les adresses sont rangés
**dans l'application**, là où le système ne peut pas les effacer. Consultation,
recherche et fiches fonctionnent alors sans aucune connexion.

> **Limite assumée :** le calcul d'itinéraire demande encore une connexion. Il
> n'y a pas de moteur embarqué — l'application le dit clairement au lieu
> d'échouer en silence.

**Et le reste.** Météo, qualité de l'air, pollens et vigilances Météo-France.
Photos de rue Mapillary. Lieux enregistrés dans des dossiers de couleur. Maison
et travail en une touche. Thèmes clair et sombre, le second suivant le capteur
de luminosité du téléphone. Français et anglais.

---

## Pourquoi elle existe

Parce qu'une carte ne devrait pas être le prix à payer pour savoir où l'on est.

- **Rien ne part chez Google.** Ni Firebase, ni Analytics, ni Play Services, ni
  Google Maps. La sauvegarde cloud d'Android et le transfert d'appareil à
  appareil sont coupés pour cette application, et les statistiques comme le Safe
  Browsing de la WebView sont désactivés. Le navigateur intégré bloque purement
  et simplement tous les hôtes Google.
- **Aucun compte, jamais.** Rien à créer, rien à quoi se connecter.
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

| | |
| --- | --- |
| Données de la carte, lieux, arrêts | contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL |
| Tuiles vectorielles | [OpenFreeMap](https://openfreemap.org/) |
| Recherche et adresses | [Photon](https://photon.komoot.io/), [Base Adresse Nationale](https://adresse.data.gouv.fr/) |
| Itinéraires | [OSRM](https://routing.openstreetmap.de/), TomTom (clé facultative) |
| Transports | [Transitous](https://transitous.org/sources/), Île-de-France Mobilités (clé facultative) |
| Météo et air | [Open-Meteo](https://open-meteo.com/), Météo-France (clé facultative) |
| Imagerie et relief | Esri, [IGN](https://geoservices.ign.fr/), Mapzen/USGS/SRTM |
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

## Licence

MY OSM est un logiciel libre sous **GNU General Public License v3.0 ou
ultérieure** (voir [LICENSE](LICENSE)). Vous pouvez l'utiliser, l'étudier, le
modifier et le redistribuer ; toute version modifiée que vous diffusez doit
rester sous la même licence, code source compris.
