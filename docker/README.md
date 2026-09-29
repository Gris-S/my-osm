# MY OSM — Docker

The web version of MY OSM, served by nginx, for larger screens: on a computer the
search, the place card and the itinerary live in a column on the left, and the
map takes the rest. On a phone-sized window it looks like the Android app.

Everything the Android app does is here **except the running mode**.

## Run it

```bash
docker compose -f docker/compose.yaml up -d
```

Then open <http://localhost:8080>.

`ghcr.io/gris-s/my-osm:latest` is the **release**, rebuilt on every push to
`main`: update tools such as Watchtower, What's Up Docker or Portainer see it
change and offer the update. Each release is also tagged with its version
(e.g. `ghcr.io/gris-s/my-osm:0.1.0-alpha.64`) — use that tag to pin one.

To build the image yourself instead, from the root of the repository:

```bash
docker build -f docker/Dockerfile -t my-osm .
```

## HTTPS, location and offline maps

Browsers only give location and offline storage to **secure pages**: HTTPS, or
`localhost`.

| Opened as | Map, search, itineraries, transit | Location | Offline maps |
| --- | --- | --- | --- |
| `http://localhost:8080` on the host | yes | yes | yes |
| `http://192.168.x.x:8080` from another device | yes | no | no |
| `https://…` behind a reverse proxy | yes | yes | yes |

On a plain `http://` network address the app still works, and says why location
and offline maps are unavailable. To get them from other devices, put the
container behind a reverse proxy that serves HTTPS (Caddy, Traefik, Nginx Proxy
Manager…) and point it at port 8080.

## API keys

**No API key is built into the image.** Anything compiled into the app is
readable by whoever can reach the server. Keys are entered in the app
(**Menu › API**) and stay in each browser. Without keys, transit runs on
Transitous everywhere, Paris included; TomTom, PRIM (Paris region), Mapillary
and Météo-France are optional.

## What the container does

- **nginx 1.30**, unprivileged image: runs as user 101 on port 8080, no Linux
  capability, read-only filesystem, `/tmp` in memory, memory and process count
  capped (`compose.yaml`).
- **Security headers**: a strict Content Security Policy (scripts from the app
  only, no inline script, no `eval`), no framing by other sites, `nosniff`, a
  Permissions-Policy limited to location and motion sensors.
- **One relay**, `/api/traffic/events`, to the French national road events feed
  (Bison Futé), which browsers cannot read directly. `GET` only, rate-limited,
  cached three minutes, and nothing from the browser (cookies, IP, headers) is
  forwarded. Every other `/api/` path is a 404.
- **Pre-compressed files** (gzip), fingerprinted assets cached for a year, the
  page and the service worker always revalidated.
- Base images pinned by digest; GitHub Actions pinned by commit.
- `/healthz` for the health check.

## Images

Built for `linux/amd64` and `linux/arm64` (Raspberry Pi 4 and later).
