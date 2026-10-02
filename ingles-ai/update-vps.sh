#!/usr/bin/env bash
# Atualiza o app na VPS a partir do GitHub e reconstroi o container.
# Uso (na VPS):  bash /docker/mel/update-vps.sh [branch]
# Nao mexe no .env, no docker-compose.yml nem nos dados (volume mel_data).
set -euo pipefail

main() {
  local branch="${1:-claude/oddi-site-analysis-wn0r6c}"
  local app_dir="${APP_DIR:-/docker/mel}"
  local repo="${REPO_URL:-https://github.com/Augusto493/Lumbrabr.git}"
  local tmp
  tmp="$(mktemp -d)"

  echo "==> baixando $branch"
  git clone -q --depth 1 -b "$branch" "$repo" "$tmp/repo"

  echo "==> copiando pra $app_dir"
  cp -r "$tmp/repo/ingles-ai/." "$app_dir/"
  rm -rf "$tmp"

  echo "==> reconstruindo o container"
  cd "$app_dir"
  docker compose up -d --build

  echo "==> pronto. ultimas linhas do log:"
  docker logs --tail 5 mel-app
}

main "$@"
