#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Fait passer à MY OSM son parcours de vérification, téléphone branché.
#
#   outils/parcours.sh                 tout le parcours
#   outils/parcours.sh coherence       un scénario, par son identifiant
#   outils/parcours.sh --liste         ce qui existe
#
# L'application doit être ouverte, et l'APK **débogable** : le pilotage passe
# par le débogage de la WebView, coupé dans la version release. Pour essayer la
# configuration de F-Droid — celle sans aucune clé — construire l'APK dédié :
#
#   cd apk && npm run apk:nokeys && npm run install-apk:nokeys
#
# Les captures et le rapport vont dans `parcours/<date>/`, hors du dépôt.
# ---------------------------------------------------------------------------
set -euo pipefail
source ~/.local/share/android-env.sh
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
PORT=9335
SORTIE="$RACINE/parcours/$(date +%Y-%m-%d_%H%M%S)"

PID=$(adb shell pidof org.osmlocal.plans | tr -d '\r')
[ -n "$PID" ] || { echo "MY OSM n'est pas ouverte sur le téléphone." >&2; exit 1; }
SOCK=$(adb shell cat /proc/net/unix | grep -o "webview_devtools_remote_$PID" | head -1)
[ -n "$SOCK" ] || {
  echo "Débogage de la WebView indisponible : cet APK n'est pas débogable." >&2
  echo "Construire « npm run apk:nokeys » (débogable, sans clés) ou « npm run apk »." >&2
  exit 1
}

adb forward --remove tcp:$PORT >/dev/null 2>&1 || true
adb forward tcp:$PORT localabstract:"$SOCK" >/dev/null
trap 'adb forward --remove tcp:$PORT >/dev/null 2>&1 || true' EXIT

node "$RACINE/outils/parcours.mjs" "$PORT" "$SORTIE" "$@"
