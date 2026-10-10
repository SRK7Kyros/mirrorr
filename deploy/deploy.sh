#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# deploy.sh — one-command (re)deploy of the Mirrorr stack.
#
#   • builds the web SPA (both surfaces) into $RUN/web + $RUN/admin
#   • syncs the private plugin repo into $RUN/core/plugins
#   • renders + installs the unit and nginx conf, reloads nginx
#   • restarts mirrorr-core
#
# Host-specific values come from deploy/mirrorr.local.env (gitignored); see
# deploy/mirrorr.local.env.example. The committed unit + nginx conf are
# templates — nothing in the repo points at one machine.
#
# Companions (e.g. the daddylive unwrapping proxy) are ordinary .py modules
# inside the plugin dirs — the core spawns them on demand — so there is no
# separate service unit to install or restart.
#
# Re-run after every edit; nothing else needs a manual step.
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

LOCAL_ENV="$ROOT/deploy/mirrorr.local.env"
[ -f "$LOCAL_ENV" ] && . "$LOCAL_ENV"

RUN="${MIRRORR_RUN_ROOT:-$ROOT/run}"
RUN_USER="${MIRRORR_RUN_USER:-$(id -un)}"
RUN_HOME="${MIRRORR_RUN_HOME:-$HOME}"
PLUGINS="${MIRRORR_PLUGINS_DIR:-$ROOT/../mirrorr-plugins}"
WEB_URL="${MIRRORR_WEB_URL:-}"
SERVER_NAME="${MIRRORR_SERVER_NAME:-_}"
CERT_NAME="${MIRRORR_CERT_NAME:-$SERVER_NAME}"

UNIT_DEST=/etc/systemd/system/mirrorr-core.service
NGINX_DEST=/etc/nginx/conf.d/mirrorr.conf

say() { printf '\n\033[1;32m== %s ==\033[0m\n' "$*"; }

render() {
  sed -e "s#__REPO_ROOT__#$ROOT#g" \
      -e "s#__RUN_ROOT__#$RUN#g" \
      -e "s#__RUN_USER__#$RUN_USER#g" \
      -e "s#__RUN_HOME__#$RUN_HOME#g" \
      -e "s#__WEB_URL__#$WEB_URL#g" \
      -e "s#__SERVER_NAME__#$SERVER_NAME#g" \
      -e "s#__CERT_NAME__#$CERT_NAME#g" \
      "$1"
}

install_rendered() {
  local tmp; tmp="$(mktemp)"
  render "$1" > "$tmp"
  sudo install -m644 "$tmp" "$2"
  rm -f "$tmp"
}

say "web → $RUN/web + $RUN/admin"
MIRRORR_DEPLOY_ROOT="$RUN" bun run --cwd "$ROOT/mirrorr-web" deploy:web

# Additive (no --delete): the base dir also holds the plugins mirrorr seeds
# itself (static.py, yt_dlp_piped.py), which are not in the plugin repo.
# Companion modules ride along inside resolvers/ (they are plain .py files).
say "plugins → $RUN/core/plugins"
mkdir -p "$RUN/core/plugins/resolvers" "$RUN/core/plugins/engines"
rsync -a "$PLUGINS/resolvers/" "$RUN/core/plugins/resolvers/"
rsync -a "$PLUGINS/engines/"   "$RUN/core/plugins/engines/"

# Companion services are spawned by the core now; drop the retired layout + unit.
rm -rf "$RUN/services"
if systemctl list-unit-files mirrorr-daddylive-proxy.service >/dev/null 2>&1; then
  say "retire old companion unit"
  sudo systemctl disable --now mirrorr-daddylive-proxy.service >/dev/null 2>&1 || true
  sudo rm -f /etc/systemd/system/mirrorr-daddylive-proxy.service
fi

# Production mode forbids auto-generating a JWT secret, and the API reads the
# env var (it calls _get_secret_key(None), never the base dir), so keep one
# persisted and hand it to the unit through a 0600 drop-in.
SECRET_FILE="$RUN/core/.jwt_secret"
if [ ! -f "$SECRET_FILE" ]; then
  mkdir -p "$RUN/core"
  head -c 48 /dev/urandom | base64 | tr -d '\n' > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
  echo "[deploy] generated $SECRET_FILE"
fi
sudo mkdir -p "$UNIT_DEST.d"
printf '[Service]\nEnvironment=MIRRORR_JWT_SECRET=%s\n' "$(cat "$SECRET_FILE")" \
  | sudo tee "$UNIT_DEST.d/20-jwt-secret.conf" >/dev/null
sudo chmod 600 "$UNIT_DEST.d/20-jwt-secret.conf"

say "install unit + nginx conf"
install_rendered "$ROOT/deploy/mirrorr-core.service" "$UNIT_DEST"
install_rendered "$ROOT/deploy/mirrorr.conf" "$NGINX_DEST"
sudo systemctl daemon-reload
sudo nginx -t
sudo systemctl reload nginx

say "restart mirrorr-core"
sudo systemctl restart mirrorr-core.service

say "health"
for i in $(seq 1 15); do
  curl -fsS --max-time 5 http://127.0.0.1:8000/health >/dev/null 2>&1 && break
  sleep 1
done
printf 'core   : '; curl -fsS --max-time 5 http://127.0.0.1:8000/health && echo
if [ -n "$WEB_URL" ]; then
  printf 'nginx  : '; curl -fsS -o /dev/null -w '%{http_code}\n' --max-time 10 "$WEB_URL/" || true
fi
