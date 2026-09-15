#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Crée une sauvegarde datée du projet dans saves/.
#
#   outils/save.sh "description-courte"
#
# Nom obtenu : saves/AAAA-MM-JJ_NN_description — NN est le numéro suivant la
# dernière sauvegarde. Ce qui se régénère (node_modules, dist, builds Android)
# n'est pas copié, ni les livrables ni les sauvegardes elles-mêmes.
# ---------------------------------------------------------------------------
set -euo pipefail

RACINE="$(cd "$(dirname "$0")/.." && pwd)"
desc="${1:?Donne une description courte, ex. : outils/save.sh \"renommage my osm\"}"

slug=$(printf '%s' "$desc" | tr '[:upper:]' '[:lower:]' | tr ' _' '--' | tr -cd 'a-z0-9-')

dernier=$(find "$RACINE/saves" -mindepth 1 -maxdepth 1 -printf '%f\n' \
  | sed -nE 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}_([0-9]{2})_.*/\1/p' | sort -n | tail -1)
if [ -z "$dernier" ]; then numero=00; else numero=$(printf '%02d' $((10#$dernier + 1))); fi

dest="$RACINE/saves/$(date +%F)_${numero}_${slug}"

rsync -a \
  --exclude '/saves/' \
  --exclude '/livrables/' \
  --exclude 'node_modules/' \
  --exclude '/app/dist/' \
  --exclude '/apk/android/build/' \
  --exclude '/apk/android/*/build/' \
  --exclude '/apk/android/.gradle/' \
  --exclude '/apk/android/.kotlin/' \
  "$RACINE/" "$dest/"

echo "Sauvegarde créée : saves/$(basename "$dest") ($(du -sh "$dest" | cut -f1))"
