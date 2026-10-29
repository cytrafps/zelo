#!/usr/bin/env bash
# deploy-tag.sh <image> <tag> <nom> : écrit le tag de <image> dans deploy/overlays/homelab, qu'Argo CD
# applique au cluster (GitOps). Lancé par la CI sur main, depuis la racine d'un dépôt cloné en entier.
#
# Le tag n'avance jamais en arrière : si celui déjà écrit vient d'un commit qui n'est pas un ancêtre
# de celui-ci (deux fusions rapprochées dont la seconde a fini avant, ou un vieux run relancé), on
# s'arrête. Le commit est retrouvé par les 7 caractères qui terminent le tag (sha-abc1234,
# osm-20261029-abc1234).
set -euo pipefail
image=$1 tag=$2 name=$3
file=deploy/overlays/homelab/kustomization.yaml

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
# Le jeton n'est donné qu'ici (checkout sans persist-credentials) : les scripts de build ne l'ont pas.
auth=(-c "http.https://github.com/.extraheader=AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)")

for _ in 1 2 3; do
  # Le tag est réécrit sur la dernière version de main à chaque essai : jamais de conflit avec un
  # autre commit de déploiement.
  git "${auth[@]}" fetch -q origin main
  git reset -q --hard origin/main
  current=$(awk -v line="name: $image" '$0 ~ line"$" { getline; sub(/.*newTag: */, ""); print; exit }' "$file")
  short=$(sed -nE 's/.*-([0-9a-f]{7})$/\1/p' <<<"$current")
  if [ -n "$short" ] && deployed=$(git rev-parse -q --verify "$short^{commit}"); then
    if ! git merge-base --is-ancestor "$deployed" "$GITHUB_SHA"; then
      echo "Tag déjà plus récent ($current) : $tag n'est pas déployé."
      exit 0
    fi
  fi
  pattern=$(sed 's/[][\/.^$*]/\\&/g' <<<"$image")
  sed -i "/name: $pattern\$/{n;s|newTag: .*|newTag: $tag|}" "$file"
  git diff --quiet && exit 0
  git commit -qam "deploy: $name $tag [skip ci]"
  git "${auth[@]}" push -q origin HEAD:main && exit 0
  sleep 5
done
exit 1
