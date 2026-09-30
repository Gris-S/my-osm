Pre-release of **MY OSM**, a free map app built on OpenStreetMap: no account, no ads, and no data sent to Google.

## Changed since 0.1.0-alpha.83
- **Opening a place no longer zooms the map out.** Tapping a pin while zoomed in on a street used to jump back to a wider view; the map now keeps your zoom (it still zooms in when a search result is far away).
- The cheese-shop icon is now a clear cheese wedge; the first drawing looked like a house on the map.

## Fixed since 0.1.0-alpha.82
- **Places missing from the map tiles now keep trying when the OpenStreetMap server is busy.** When Overpass answered "too busy" (504), the app gave up and only tried again when you moved the map — a cheese shop could stay invisible on a still map. It now waits and asks again, and retries on its own a minute later if needed.

## Fixed since 0.1.0-alpha.81
- **Places missing from the map tiles did not always load** (a cheese shop that OpenStreetMap has stayed invisible). The app split each view into too many requests and ran out of the Overpass server's quota (4 requests at a time per address), then waited for a second server that was down. It now sends fewer, larger requests, and when the server says "too many requests" it waits for the free slot it announces instead of giving up.
- **Satellite view showed an error banner** when a single aerial-photo tile failed to load (a passing error from the IGN server). One missing tile is simply requested again; only real map failures are shown.

## What's new

### Add a place to OpenStreetMap
When a place is missing from the map and you find it on the web, its card now has an **OSM** button. It opens a form already filled in from what you searched and from the web page:
- the **name** is what you typed in the search bar, with a reminder to check it against the shopfront;
- the **address** is split into number, street, postcode and city (street capitalised);
- a **pin** to drag onto the entrance, and a **category** to pick;
- **places with the same name within 100 m** are looked up on OpenStreetMap first, so you don't add a duplicate.

Nothing is sent until you tick a confirmation: OpenStreetMap does not accept data copied from Google, Apple Maps or Yelp, which is often where web listings come from. You sign in to OpenStreetMap **once** — inside the app, no code to copy — and only a token is kept on the device, never a password. Off by default: turn it on in **Menu › Modes**.

### Places that were missing from the map
The map tiles only carry a fixed list of place types. Cheese shops, pastry shops, fishmongers, grocers, gyms, spas, memorials and 34 other kinds of places never showed up, even when OpenStreetMap had them. They are now fetched from OpenStreetMap (Overpass) for the area you are looking at and shown with the others — same filters, same cards. Each area is kept on the device for a week. The Overpass servers are often busy: when they don't answer, the map says so and tries again a minute later.

### Food shops and groceries
- **Groceries & convenience stores**: supermarkets, convenience stores, grocers, frozen and organic food.
- **Food shops**: bakeries, pastry shops, cheese shops, butchers, fishmongers, greengrocers, delis, dairies, coffee and tea, spices and nuts, wine shops. Your "Bakeries" setting moves there on its own.
- Map pins now show **what the shop is**: a cheese, a fish, a croissant, a cake, a glass of wine, a carrot… and elsewhere a swimming pool, a bike, flowers, glasses, a gem, scissors.

### Fixed
- When the search engine doesn't answer, the search bar now says so. It used to fall back silently to an address-only service, so a shop looked like it didn't exist.
- A dead Overpass server was removed; place details no longer wait for it.

## Upgrading
- **From 0.1.0-alpha.22 or later:** installs over it normally. Offline maps, saved places, history and settings are kept.
- **From 0.1.0-alpha.16 or earlier:** that build was signed with a development key, so Android will refuse to install over it. Uninstall first — which **erases downloaded offline maps, saved places, history and settings.**

## Docker
The web version for larger screens is published with this release: `ghcr.io/gris-s/my-osm:latest` and `ghcr.io/gris-s/my-osm:0.1.0-alpha.84`. See [docker/README.md](https://github.com/Gris-S/my-osm/blob/main/docker/README.md). In a browser, signing in to OpenStreetMap shows a code to copy once.

## Good to know
- **No API keys are bundled.** Without keys, public transport runs on [Transitous](https://transitous.org) everywhere. Optional free keys (Paris region transport, TomTom, Mapillary, Météo-France) go in **Menu › API**.
- The interface is available in English and French.
- Android 7.0 (API 24) or later. This is an alpha: things may break.

## File
`MY-OSM-0.1.0-alpha.84.apk`
SHA-256 `92be532bfd5f6b8a7990fae9da536fad1ad0e99e77e2e1d5a59c999c08d0b316`
