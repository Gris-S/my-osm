Pre-release of **MY OSM**, a free map app built on OpenStreetMap: no account, no ads, and no data sent to Google.

## New since 0.1.0-alpha.115

### Public transport
- **The stop alert is now on time, even with the app closed.** Android delayed the alarm while the phone slept, so the vibration could come after you had left the train. The alarm is now exact, and during the ride a small service follows the train under a notification: it corrects the alarm when the train runs early or late, and vibrates at the second-to-last station.
- An alert already given for a line is not given again.

### New optional modes (off by default)
Turn them on in the **Modes** section of the settings.
- **Bike sharing**: stations from [CityBikes](https://citybik.es), shown with the Transport category, with the number of bikes. The card shows mechanical and electric bikes and free docks.
- **Fuel and charging**: fuel prices from the official French feed (prix-carburants.gouv.fr) and from [Pumperly](https://pumperly.com); the most recent price wins. Pick **My fuel** (electric included) to see its prices on the map, or charging stations if you drive electric. The station card shows the brand, the address, dated prices, and "Out of stock" / "Not sold here".
- Search understands "petrol", "gas station", "charging", "bike sharing" (and their French words), and finds the bike networks of other cities.

### Fixes
- Download sizes are written in the language of the interface (2.4 GB / 2,4 Go).
- Search keeps working when the system WebView is stuck offline (for example while a VPN starts).
- The layers menu opens above the navigation banner and no longer runs off the screen.
- The description now says that the system WebView's autofill can still contact Google on devices where Google is the autofill service. MY OSM itself sends nothing to Google.

## Upgrading
- **From 0.1.0-alpha.22 or later:** installs over it normally. Offline maps, saved places, history and settings are kept.
- **From 0.1.0-alpha.16 or earlier:** that build was signed with a development key, so Android will refuse to install over it. Uninstall first — which **erases downloaded offline maps, saved places, history and settings.**
- **Permissions:** exact alarms are now granted at install on Android 13 and later (`USE_EXACT_ALARM`), and a foreground location service runs only during a transit ride with the stop alert on. No background location access.

## Docker
The web version for larger screens is published with this release: `ghcr.io/gris-s/my-osm:latest` and `ghcr.io/gris-s/my-osm:0.1.0-alpha.119`. See [docker/README.md](https://github.com/Gris-S/my-osm/blob/main/docker/README.md).

## Good to know
- **No API keys are bundled.** Without keys, public transport runs on [Transitous](https://transitous.org) everywhere. Optional free keys (Paris region transport, TomTom, Mapillary, Météo-France) go in **Menu › API**.
- The interface is available in English and French.
- Android 7.0 (API 24) or later. This is an alpha: things may break.

## File
`MY-OSM-0.1.0-alpha.119.apk`
SHA-256 `EMPREINTE`
