#!/usr/bin/env bash
# Construit les données routières de Valhalla pour l'extrait OpenStreetMap de la Marne.
#   ./build.sh [dossier de sortie]   (par défaut ./data)
# Construction complète du conteneur officiel (vitesses par défaut, pays, fuseaux horaires),
# sans démarrer le service ; le Dockerfile n'embarque ensuite que ce que le service lit.
# Utilisé par la CI chaque semaine : ~30 s, moins de 600 Mo de mémoire.
# DOCKER_ARGS : options en plus pour `docker run` (proxy d'entreprise, par exemple).
set -euo pipefail

IMAGE=ghcr.io/valhalla/valhalla-scripted@sha256:d5382587f4ca9171caade2d1ab1212f26377dc5f121b9c6783deda8f4428472f
EXTRACT=https://download.openstreetmap.fr/extracts/europe/france/champagne_ardenne/marne
OUT=$(realpath -m "${1:-data}")
mkdir -p "$OUT"
cd "$OUT"

curl -fsSL -o marne.osm.pbf "$EXTRACT.osm.pbf"
curl -fsSL -o marne.osm.pbf.md5 "$EXTRACT.osm.pbf.md5"
md5sum -c marne.osm.pbf.md5
curl -fsSL -o marne.state.txt "$EXTRACT.state.txt"

# shellcheck disable=SC2086
docker run --rm ${DOCKER_ARGS:-} -v "$OUT:/custom_files" \
  -e serve_tiles=False -e build_tar=True -e build_admins=True -e build_time_zones=True \
  -e use_default_speeds_config=True -e build_elevation=False -e force_rebuild=True \
  "$IMAGE" build_tiles

# Seuls ces fichiers servent au service ; le reste (pbf, tuiles éclatées) reste ici.
for f in valhalla.json valhalla_tiles.tar admins.sqlite timezones.sqlite default_speeds.json; do
  test -s "$f" || { echo "manquant : $f" >&2; exit 1; }
done
chmod -R a+rX "$OUT"
ls -l "$OUT"
