Pre-release of **MY OSM**, a free map app built on OpenStreetMap: no account, no ads, and no data sent to Google.

## New since 0.1.0-alpha.119

### Fixes
- **Street photos open again.** In the installed app (and the Docker version) every photo ended in "Photo unavailable": the Mapillary viewer built a filter with `new Function`, which the app's security policy forbids. The filter is now replaced at build time; the policy stays as strict as before.
- **Layer switches work on the first tap.** Relief, traffic and street photos ignored a tap made while map tiles were still loading (right after moving the map, or while the relief was downloading), so they had to be tapped twice.
- **Car navigation uses the standard map.** Started in satellite view, it now switches to the map, and the satellite view comes back when navigation ends.

### Categories
- **Museums & culture** keeps museums, galleries, cinemas, theatres, libraries, monuments and castles.
- New **Heritage & curiosities** category for plaques, memorials, street art and "attractions" (bridges, fountains…), **off by default**. Turn it on in the categories menu.

### Search
- Results appear at every letter, starting with places already on the map, then from Photon.
- Search looks around the part of the map you are looking at, not only around your position.
- Categories understood in 69 languages and 15,580 brands (id-tagging-schema, name-suggestion-index). Small typos are tolerated.
- In Europe, Overpass requests go to a European instance first; the "missing shops" message is shorter and rarer.

### Public transport
- The transit navigation panel can be collapsed (handle at the top, tap or swipe) and slides open and closed. Opening categories, layers or bookmarks collapses it.
- During navigation, the right-hand menus stay below the weather and compass buttons.

## Upgrading
- **From 0.1.0-alpha.22 or later:** installs over it normally. Offline maps, saved places, history and settings are kept.
- **From 0.1.0-alpha.16 or earlier:** that build was signed with a development key, so Android will refuse to install over it. Uninstall first — which **erases downloaded offline maps, saved places, history and settings.**
- Your category choices are kept; the new Heritage & curiosities category starts off.

## Docker
The web version for larger screens is published with this release: `ghcr.io/gris-s/my-osm:latest` and `ghcr.io/gris-s/my-osm:0.1.0-alpha.124`. See [docker/README.md](https://github.com/Gris-S/my-osm/blob/main/docker/README.md).

## Good to know
- **No API keys are bundled.** Without keys, public transport runs on [Transitous](https://transitous.org) everywhere. Optional free keys (Paris region transport, TomTom, Mapillary, Météo-France) go in **Menu › API**.
- The interface is available in English and French.
- Android 7.0 (API 24) or later. This is an alpha: things may break.

## File
`MY-OSM-0.1.0-alpha.124.apk`
SHA-256 `SHA_A_REMPLIR`
