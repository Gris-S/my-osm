# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# MY OSM, version Docker : l'application web servie par nginx.
#
# Construire depuis la racine du dépôt :
#   docker build -f docker/Dockerfile -t my-osm .
#
# Deux étapes. La première construit l'application **une seule fois, sur
# l'architecture de la machine de construction** (`--platform=$BUILDPLATFORM`) :
# ce qu'elle produit — HTML, JavaScript, CSS — ne dépend d'aucune architecture.
# La seconde ne fait que copier : sans aucun `RUN`, elle s'assemble pour arm64
# comme pour amd64 sans émulation.
#
# Les images de base sont fixées par leur empreinte, pas seulement par leur
# étiquette : une étiquette peut être déplacée, une empreinte non.
# ---------------------------------------------------------------------------

FROM --platform=$BUILDPLATFORM docker.io/library/node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build

WORKDIR /src/app

# Les dépendances d'abord, dans leur propre couche : elles ne se refont que si
# le verrou change.
COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY app/ ./

# `docker` : le site web sans le mode course (`__RUN_MODE__`). Les clés d'API
# sont passées **à vide** : tout ce qui s'appelle VITE_* est compilé dans le
# code envoyé au navigateur, donc lisible par quiconque atteint le serveur.
# Elles se saisissent dans l'application (Menu › API) et restent dans le
# navigateur de chacun. `MYOSM_DIAGNOSTICS=0` retire l'objet de diagnostic, et
# fait casser la construction si une clé arrivait malgré tout.
ENV OSM_TARGET=docker \
    MYOSM_DIAGNOSTICS=0 \
    VITE_TOMTOM_KEY= \
    VITE_IDFM_API_KEY= \
    VITE_MAPILLARY_TOKEN= \
    VITE_METEOFRANCE_API_KEY=

# Puis chaque fichier texte est compressé une fois pour toutes, à côté de
# l'original : nginx sert le `.gz` sans recompresser (`gzip_static`).
RUN npm run build \
 && find dist -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.css' -o -name '*.html' \
      -o -name '*.svg' -o -name '*.json' -o -name '*.webmanifest' \) -size +1k \
      -exec gzip -9 -k -n {} +


FROM docker.io/nginxinc/nginx-unprivileged:1.30-alpine@sha256:ed04ec1ff34502c339ee5c3ae3f855442398edc1d05591e2b98981dcbbd20b1e

LABEL org.opencontainers.image.title="MY OSM" \
      org.opencontainers.image.description="Free OpenStreetMap map app — no account, no ads, no data sent to Google. Web version for larger screens." \
      org.opencontainers.image.source="https://github.com/Gris-S/my-osm" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"

# La configuration du site s'engendre au démarrage dans /tmp (inscriptible
# même en lecture seule, voir compose.yaml), avec les résolveurs DNS du
# conteneur. Journaux d'entrée réduits aux erreurs.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1 \
    NGINX_ENVSUBST_OUTPUT_DIR=/tmp \
    NGINX_ENTRYPOINT_QUIET_LOGS=1

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/security-headers.conf /etc/nginx/myosm/security-headers.conf
COPY docker/myosm.conf.template /etc/nginx/templates/myosm.conf.template
COPY --from=build /src/app/dist /usr/share/nginx/html

# L'image tourne déjà sous l'utilisateur 101 (nginx), sans privilèges : le
# port est donc au-dessus de 1024.
USER 101
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
