#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Affiche le journal de navigation de MY OSM, téléphone branché en USB.
#
#   outils/journal.sh            affiche le journal
#   outils/journal.sh vider      l'efface
#   outils/journal.sh > trajet.txt   le garde dans un fichier
#
# L'application doit être ouverte : le journal est lu dans sa WebView.
# ---------------------------------------------------------------------------
set -euo pipefail
source ~/.local/share/android-env.sh
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
PORT=9334

PID=$(adb shell pidof org.osmlocal.plans | tr -d '\r')
[ -n "$PID" ] || { echo "MY OSM n'est pas ouverte sur le téléphone." >&2; exit 1; }
SOCK=$(adb shell cat /proc/net/unix | grep -o "webview_devtools_remote_$PID" | head -1)
[ -n "$SOCK" ] || { echo "Débogage de la WebView indisponible." >&2; exit 1; }

adb forward tcp:$PORT localabstract:"$SOCK" >/dev/null
trap 'adb forward --remove tcp:$PORT >/dev/null 2>&1' EXIT
node "$RACINE/outils/journal.mjs" "$PORT" "${1:-lire}"
