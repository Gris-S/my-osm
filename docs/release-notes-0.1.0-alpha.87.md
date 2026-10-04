Pre-release of **MY OSM**, a free map app built on OpenStreetMap: no account, no ads, and no data sent to Google.

## Changed since 0.1.0-alpha.86 (F-Droid review)
- **The app now names itself to OpenStreetMap community services.** In the Android app, requests to Nominatim, the FOSSGIS routing servers (OSRM, Valhalla), BRouter and Overpass carry a `MY-OSM/<version>` User-Agent, as their usage policies ask.
- **Offline satellite imagery now comes from IGN only, so it is available in France only.** Esri World Imagery is no longer downloaded for offline use: its terms do not allow it. Online, the satellite view is unchanged.
- OpenStreetMap trademark notice added under *Menu › Sources & licences*.

## Fixed since 0.1.0-alpha.86
Three problems from a real car trip.
- **The music buttons did nothing with Qobuz.** Pause, next and previous were sent in a form Qobuz silently ignores when it comes from another app. They are now sent the way a headset sends them, which every player obeys.
- **The map could stay empty under the blue line for a whole trip.** After leaving home Wi-Fi, the app sometimes kept believing it was offline although the phone had mobile data: no map, and every re-route refused. Map tiles and car routes now go through Android itself when that happens.
- **The map turned before the car did.** When you slowed down or stopped just before a turn, the map already pointed down the next street, so "turn left" looked like "go straight". It now keeps facing the way you are facing until you actually turn.
- **Driving past your destination no longer restarts the navigation.** Once you have arrived, the app stays "arrived": it used to send you around the block, re-routing about ten times in three seconds.
- **A route that passes twice along the same street** (a loop, or there and back) no longer makes the position jump to the other pass.
- When typing a stop in the itinerary panel, the map buttons no longer sit on top of "Start".

## New since 0.1.0-alpha.86
- **The map of the next 15 km is loaded ahead of time** during car navigation, at the start and as you drive, so a tunnel or a patch without coverage no longer leaves a blank map. It uses about the same data as the trip itself, and nothing when Data Saver is on.

## Fixed since 0.1.0-alpha.85
- **Places missing from the map tiles now load even when the OpenStreetMap server is struggling.** On some days only half of its answers succeed; the app now tries four times, a little longer apart each time, instead of twice.
- When some places could not be loaded, the warning at the bottom of the map disappeared after eight seconds and was easy to miss. It now stays until they arrive (the app keeps trying every minute).

## Fixed since 0.1.0-alpha.84
- **Places missing from the map tiles still failed to appear on a first visit** (seen on the Docker version, in satellite view). Every time the view changed — opening, flying to a search result, each zoom step — the app cancelled its request and sent a new one; but the OpenStreetMap server keeps working on a cancelled request, so its small per-address quota filled up at once. Requests are no longer cancelled: an area already asked for is awaited, the area you are looking at goes first, one request at a time.

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
The web version for larger screens is published with this release: `ghcr.io/gris-s/my-osm:latest` and `ghcr.io/gris-s/my-osm:0.1.0-alpha.87`. See [docker/README.md](https://github.com/Gris-S/my-osm/blob/main/docker/README.md). In a browser, signing in to OpenStreetMap shows a code to copy once.

## Good to know
- **No API keys are bundled.** Without keys, public transport runs on [Transitous](https://transitous.org) everywhere. Optional free keys (Paris region transport, TomTom, Mapillary, Météo-France) go in **Menu › API**.
- The interface is available in English and French.
- Android 7.0 (API 24) or later. This is an alpha: things may break.

## File
`MY-OSM-0.1.0-alpha.87.apk`
SHA-256 `c9a6df5529b915caa68c3024f1fe20de2aae73a29415ea20f970e0edd1ef8e78`
