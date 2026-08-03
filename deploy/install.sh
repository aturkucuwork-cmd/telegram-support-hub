#!/usr/bin/env bash
# One-shot installer for a fresh Debian/Ubuntu server: installs OS prerequisites
# (Node.js 22, build tools, Python venv support), copies this checkout to
# /opt/relaydesk, provisions the relaydesk service account/systemd units, and
# starts the web app. Run as root from inside a clone of this repository:
#
#   git clone <repo-url> relaydesk && cd relaydesk
#   sudo bash deploy/install.sh
#
# After it finishes, open an SSH tunnel and use the setup wizard to connect a
# Telegram bot/account — this script does not touch Telegram credentials.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Bu script root olarak çalıştırılmalıdır (sudo bash deploy/install.sh)." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project_root="${RELAYDESK_ROOT:-/opt/relaydesk}"

if [ ! -f "$repo_root/package.json" ] || [ ! -f "$repo_root/deploy/provision-relaydesk.sh" ]; then
  echo "Bu script bir RelayDesk git checkout'unun deploy/ klasöründen çalıştırılmalı." >&2
  exit 1
fi

echo "== 1/4: Sistem paketleri kuruluyor =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git build-essential python3 python3-dev python3-venv

node_major=0
if command -v node >/dev/null 2>&1; then
  node_major="$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
fi
if [ "$node_major" -lt 22 ]; then
  echo "Node.js 22.x kuruluyor (NodeSource)..."
  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh
  apt-get install -y nodejs
  rm -f /tmp/nodesource_setup.sh
fi

echo "== 2/4: Proje $project_root konumuna kopyalanıyor =="
mkdir -p "$project_root"
rsync -a --delete \
  --exclude node_modules --exclude .git --exclude dist --exclude .next \
  --exclude .vinext --exclude data --exclude .venv --exclude backup \
  --exclude .wrangler \
  "$repo_root/" "$project_root/"

echo "== 3/4: Servis hesabı, bağımlılıklar ve systemd birimleri kuruluyor =="
RELAYDESK_ROOT="$project_root" bash "$project_root/deploy/provision-relaydesk.sh"

echo "== 4/4: Servisler başlatılıyor =="
bash "$project_root/deploy/relaydesk-bootstrap.sh"

env_path="$project_root/.env.local"
echo
echo "Kurulum tamamlandı."
echo
echo "Kurulum sihirbazına eriş: bir SSH tüneli aç (kendi bilgisayarından):"
echo "  ssh -L 3000:localhost:3000 -L 8765:localhost:8765 <kullanici>@<bu-sunucu>"
echo "sonra taraycında http://localhost:3000 adresini aç ve sihirbazı tamamla"
echo "(bot token, Telegram hesabı, dinleyici — hepsi taraycıdan yapılır)."
echo
echo "Ortam dosyası: $env_path (600, relaydesk sahipli)."
echo "Servis durumu: systemctl status relaydesk-web.service"
