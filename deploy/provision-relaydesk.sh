#!/usr/bin/env bash
# Provision a fresh Debian/Ubuntu host for the system-level RelayDesk units.
# Run after the application has been copied to /opt/relaydesk.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Bu script root olarak çalıştırılmalıdır." >&2
  exit 1
fi

project_root="${RELAYDESK_ROOT:-/opt/relaydesk}"
data_root="/var/lib/relaydesk"
session_path="$data_root/telegram-user-session.enc"
env_path="$project_root/.env.local"

if [ ! -d "$project_root" ]; then
  echo "RelayDesk kökü bulunamadı: $project_root" >&2
  exit 1
fi

for command in node npm python3 systemctl runuser; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Gerekli komut bulunamadı: $command. Node.js 22+, Python 3 ve systemd kurun." >&2
    exit 1
  fi
done

getent group relaydesk >/dev/null 2>&1 || groupadd --system relaydesk
id relaydesk >/dev/null 2>&1 || useradd --system --gid relaydesk --home-dir "$data_root" --create-home --shell /usr/sbin/nologin relaydesk

install -d -o relaydesk -g relaydesk -m 0750 "$project_root"
install -d -o relaydesk -g relaydesk -m 0750 "$data_root"
install -d -o relaydesk -g relaydesk -m 0700 "$data_root/backup"

if [ ! -f "$env_path" ]; then
  install -o relaydesk -g relaydesk -m 0600 "$project_root/.env.example" "$env_path"
fi

chown -R relaydesk:relaydesk "$project_root"
chmod 0600 "$env_path"

ENV_PATH="$env_path" DATA_ROOT="$data_root" SESSION_PATH="$session_path" python3 - <<'PY'
import base64
import os
import secrets
from pathlib import Path

env_path = Path(os.environ["ENV_PATH"])
data_root = os.environ["DATA_ROOT"]
session_path = os.environ["SESSION_PATH"]
defaults = {
    "DATABASE_PATH": f"{data_root}/relaydesk.sqlite",
    "RELAYDESK_SESSION_PATH": session_path,
    "LOCAL_SETUP_TOKEN": secrets.token_urlsafe(32),
    "INTERNAL_API_SECRET": secrets.token_urlsafe(32),
    "SESSION_ENCRYPTION_KEY": base64.urlsafe_b64encode(os.urandom(32)).decode("ascii"),
}
lines = env_path.read_text(encoding="utf-8").splitlines()
seen = set()
updated = []
for line in lines:
    key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else ""
    if key in defaults and key not in seen:
        seen.add(key)
        current = line.split("=", 1)[1].strip()
        updated.append(line if current else f"{key}={defaults[key]}")
    else:
        updated.append(line)
for key, value in defaults.items():
    if key not in seen:
        updated.append(f"{key}={value}")
temporary = env_path.with_name(env_path.name + ".tmp")
temporary.write_text("\n".join(updated).rstrip() + "\n", encoding="utf-8")
os.chmod(temporary, 0o600)
os.replace(temporary, env_path)
os.chmod(env_path, 0o600)
PY

runuser -u relaydesk -- npm --prefix "$project_root" ci
runuser -u relaydesk -- npm --prefix "$project_root" run build
runuser -u relaydesk -- python3 -m venv "$project_root/.venv"
runuser -u relaydesk -- "$project_root/.venv/bin/pip" install -r "$project_root/requirements-connect.txt"

install -o root -g root -m 0644 "$project_root/deploy/relaydesk-web.service" /etc/systemd/system/relaydesk-web.service
install -o root -g root -m 0644 "$project_root/deploy/relaydesk-telegram-poller.service" /etc/systemd/system/relaydesk-telegram-poller.service
install -o root -g root -m 0644 "$project_root/deploy/relaydesk-listener.service" /etc/systemd/system/relaydesk-listener.service
install -o root -g root -m 0644 "$project_root/deploy/relaydesk-setup-bridge.service" /etc/systemd/system/relaydesk-setup-bridge.service
install -o root -g root -m 0440 "$project_root/deploy/relaydesk-sudoers" /etc/sudoers.d/relaydesk

if command -v visudo >/dev/null 2>&1; then
  visudo -cf /etc/sudoers.d/relaydesk
fi
systemctl daemon-reload
systemctl enable relaydesk-web.service relaydesk-telegram-poller.service relaydesk-listener.service
systemd-analyze verify relaydesk-web.service relaydesk-telegram-poller.service relaydesk-listener.service relaydesk-setup-bridge.service

echo "RelayDesk host provision tamamlandı."
echo "Env: $env_path (600), veri: $data_root (750), session: $session_path (600 hedefi)"
echo "İlk başlatma: $project_root/deploy/relaydesk-bootstrap.sh"
