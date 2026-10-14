Pre-release of **MY OSM**, a free map app built on OpenStreetMap: no account, no ads, and no data sent to Google.

## Fixed since 0.1.0-alpha.95

### Public transport
- **No more ghost metro rides.** Starting from a station such as Châtelet, a journey could begin with "board line 1 at Châtelet, get off at Châtelet" — sometimes getting off a minute before boarding — and the same RER journey was offered once per metro line. Those zero-stop rides are now removed, transfers are recounted, and journeys that take the same trains at the same times are shown once.
- **Choosing a start or a stop in the itinerary panel works like the search bar.** The platforms, entrances and bus stops of one station are grouped on a single line, stations come first, and each result shows its icon (line badge, transport, address or place) instead of the same pin for everything.

### Leave later
- **The date and time pickers are Android's calendar and clock**, in the app's blue, instead of the old scroll-wheel dialog. "Now / Leave at / Arrive by" is a segmented switch instead of a drop-down list.
- The result no longer squeezes "52 min" onto two lines: departure and arrival times go below, across the full width.
- The "Start" button of a public transport journey no longer sticks to the edge of the card.

## New since 0.1.0-alpha.87

### Driving
- **Voice guidance, in three levels.** A button on the bottom bar switches between all announcements, alerts only (speed cameras, accidents, traffic jams, route changes) and mute. It uses the phone's own text-to-speech engine, on the device. Pick the voice in **Menu › Settings › Navigation**: choose a language you have downloaded, then one of its voices. Announcements are spoken in the voice's language — French, English, Spanish, Italian, Portuguese or German — whatever the app's language.
- **Traffic gauge.** With a TomTom key, a bar on the right edge shows the rest of the trip and where traffic is slow on it.
- **Accidents and broken-down vehicles on your route**, even when they cause no traffic jam (TomTom key needed). TomTom has no driver reports: not everything you see on the roadside will be there.
- **The map comes back to the car by itself** five seconds after you last touched it.
- **Cooler phone.** While driving, the map is drawn at 30 frames per second and half resolution: in our measurement the app used about a quarter less processor.
- **A few minutes of margin on arrival times** (15 %, five minutes at most).
- In a tunnel, the automatic theme now switches to dark in under a second.
- Bigger speed display, bigger music buttons that are harder to miss, and a song title that scrolls when it does not fit.

### Public transport
- **Guidance no longer jumps ahead.** Being recognised near a stop was stored as a manual "one step ahead"; when the timetable caught up, guidance ended up one step too far.
- **You are not "on the bus" while still on the pavement.** When GPS is available, guidance only moves on once you have actually left the stop along the line. Underground, the timetable still leads.
- **The journey is recalculated from where you are** if you miss a vehicle or leave the route.
- **Station list** for the line you are on, with a blue dot that moves along as you travel. Can be turned off in **Menu › Modes**.
- The next departure time stands out in a blue pill, and the card of the stop where you board highlights your line.
- The buttons on the right no longer overlap when the banner is tall.

### Leave later
- In the itinerary panel, choose **Leave at** or **Arrive by**. For public transport, journeys are computed for that time. For driving it needs a TomTom key, and shows departure and arrival with the usual traffic at that time.

### Dark theme
- **The dark map was redone to match the light one**: calmer roads, clearer towns, French road-number shields, and a lighter background than before.

## Fixed since 0.1.0-alpha.87
- **An offline area could say "ready" with holes in it.** If the network dropped during a download, the missing tiles were counted as done. The area now stops, says the network dropped, and resuming only fetches what is missing. Places for an area are retried when the server is busy.
- **The BRouter cycling fallback had stopped working in the Android app** since 0.1.0-alpha.87: its answers were read in the wrong form.
- Deleting an offline area no longer removes satellite tiles that another, older area still uses.
- After a failed "add to OpenStreetMap", nearby places are checked again before you can send a second time, to avoid creating a duplicate.
- The compass button keeps a solid background.

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
The web version for larger screens is published with this release: `ghcr.io/gris-s/my-osm:latest` and `ghcr.io/gris-s/my-osm:0.1.0-alpha.98`. See [docker/README.md](https://github.com/Gris-S/my-osm/blob/main/docker/README.md). In a browser, signing in to OpenStreetMap shows a code to copy once.

## Good to know
- **No API keys are bundled.** Without keys, public transport runs on [Transitous](https://transitous.org) everywhere. Optional free keys (Paris region transport, TomTom, Mapillary, Météo-France) go in **Menu › API**.
- The interface is available in English and French.
- Android 7.0 (API 24) or later. This is an alpha: things may break.

## File
`MY-OSM-0.1.0-alpha.98.apk`
SHA-256 `d52eb2c95224e64e6e2559367278e433504797adca4088c854793928c5584fd6`
