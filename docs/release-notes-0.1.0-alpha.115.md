Pre-release of **MY OSM**, a free map app built on OpenStreetMap: no account, no ads, and no data sent to Google.

## New since 0.1.0-alpha.98

### Tracks and places from other apps
- **MY OSM now shows up when you open a GPX, KML or GeoJSON file** — from a file manager, a download, or a file sent in WhatsApp — next to OsmAnd. You can also use **Menu › Open a file**, or drop a file on the map in the Docker version.
- The track is drawn in purple and the map frames it; named points become purple pins that open their card.
- **Follow a track, on foot or by bike.** Guidance runs **on the track itself**, not on a route of its own. When the file carries turn-by-turn instructions ("Turn left onto…"), those are what you hear and read, each at its place. Otherwise the turns are read from the track's shape. The routing engine is only used to bring you to the start of the track, and back onto it if you stray.
- Files exported from route planners store every instruction as a point: they are no longer turned into hundreds of pins.
- **Save to my places** keeps the points **and the track**, if the file has one. Close the file, delete it elsewhere: the track stays in its folder.

### Saved places
- **A ▶ button on every folder.** A folder with a track opens it, ready to follow. A folder of places becomes a route from where you are through all of them, **nearest first** — handy for a list of sights in a city you are visiting.
- An expanded folder shows its full name, with its buttons on the line below.

### Longer routes
- **Up to 48 stops** on foot, by bike and by car (15 by public transport, where every stop costs a request on a shared quota). Long bike routes are now requested piece by piece: the bike routing server refuses more than 10 points at once, and routes with more than 8 stops used to fail without saying why.

### Public transport
- **A strong vibration before your stop**, like Citymapper's: when the train leaves the second-to-last station, the phone vibrates hard (short-short-long, three times) and a notification says where to get off and which exit to take — **even with the screen off and the phone in your pocket**. Allow notifications when asked; for an on-time alert, also allow **Alarms & reminders** (Menu › Modes shows the shortcut). On/off under the station list and in Menu › Modes.
- **Guidance follows the train you actually took.** On reaching the platform, the real departures are fetched and the first train is assumed: if it leaves earlier than planned, the whole line shifts. Underground, a coarse position from the mobile network (up to about 250 m) now also counts, and the timetable is corrected to match it.
- The arrows ‹ › only **browse** the other steps: they no longer move your position. A browsed step shows its whole line without the blue dot, and "Back to now" returns.
- The station list no longer shows times, which were misleading when you took another train.

### Everywhere
- **Music player per navigation.** In Menu › Modes, tap the walking, cycling, car, transit or running icon to show or hide the now-playing card there.
- **"Leave later" has its own day and time picker**: day chips (Today, Tomorrow, the week ahead) and two scroll wheels, in the app's theme. Android's calendar was white on white at night.
- **"My location" is refreshed** when you come back to the itinerary panel after a navigation or after leaving the app: a bike route was computed from where you had been an hour earlier.
- The "End" button of a walk or a ride is a round button, like when driving: the elevation button no longer slides under it.

## Upgrading
- **From 0.1.0-alpha.22 or later:** installs over it normally. Offline maps, saved places, history and settings are kept.
- **From 0.1.0-alpha.16 or earlier:** that build was signed with a development key, so Android will refuse to install over it. Uninstall first — which **erases downloaded offline maps, saved places, history and settings.**
- **New permissions**, both optional: notifications and exact alarms, for the stop alert. Nothing else changes.

## Docker
The web version for larger screens is published with this release: `ghcr.io/gris-s/my-osm:latest` and `ghcr.io/gris-s/my-osm:0.1.0-alpha.115`. See [docker/README.md](https://github.com/Gris-S/my-osm/blob/main/docker/README.md). There, the stop alert only vibrates while the page is open.

## Good to know
- **No API keys are bundled.** Without keys, public transport runs on [Transitous](https://transitous.org) everywhere. Optional free keys (Paris region transport, TomTom, Mapillary, Météo-France) go in **Menu › API**.
- The interface is available in English and French.
- Android 7.0 (API 24) or later. This is an alpha: things may break.

## File
`MY-OSM-0.1.0-alpha.115.apk`
SHA-256 `[À REMPLIR]`
