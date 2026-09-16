# Security Policy

## Supported versions

MY OSM is alpha software with a single active line. Only the most recent
release receives fixes; there are no maintained older branches.

| Version | Supported |
| ------- | --------- |
| Latest `0.1.0-alpha.N` release | :white_check_mark: |
| Anything older | :x: |

## Reporting a vulnerability

Please report security issues **privately**, through GitHub's private
vulnerability reporting:

**[Report a vulnerability](https://github.com/Gris-S/my-osm/security/advisories/new)**

That form is only visible to the maintainer. Please do not open a public issue
for a security problem.

Expect an acknowledgement within a few days. This is a personal, non-commercial
project maintained in spare time: there is no paid support and no bounty, but
reports are taken seriously and credited in the release notes unless you prefer
otherwise.

## What is in scope

- The Android app and its native plugins (`apk/android/app/src/main/java/`).
- The web application (`app/`), including the content security policy, the
  in-app browser and the handling of links received from other apps.
- Anything that could leak data off the device. The app is built so that
  saved places, home and work addresses, trip history and downloaded maps never
  leave the phone; a path that breaks that promise is a security issue, not a
  feature request.
- API keys ending up inside a published build. Keys are entered in the app and
  the release build refuses to compile if one is present in the environment.

## What is out of scope

- The third-party services the app talks to (OpenStreetMap, OpenFreeMap,
  Transitous, Photon, the French public-data platforms, TomTom, Mapillary,
  Météo-France). Report those to their own maintainers.
- Data quality in OpenStreetMap itself.
- Builds signed with the Android debug key. Those are development artefacts and
  are not meant to be distributed; a release is signed with a private key.
- Issues that require physical access to an unlocked device, since anything
  stored by the app is protected only by Android's app sandbox and the device
  lock, as stated in the README.

## Known accepted limitations

These are documented decisions, not oversights:

- Data stored by the app is in clear text inside the app's private storage.
  It is protected by Android's sandbox and by disabling cloud backup and
  device-to-device transfer, not by a separate encryption layer.
- A page opened in the in-app browser can offer a fabricated place. The place is
  always shown — name and address — before anything is added to the map.
- A link received from another app can open a place card or an itinerary without
  confirmation. It never starts navigation on its own.
