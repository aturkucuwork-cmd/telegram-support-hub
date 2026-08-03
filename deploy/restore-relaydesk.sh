#!/usr/bin/env bash
# Restore a verified SQLite backup. This intentionally stops application units.
set -euo pipefail
umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo "Restore root olarak çalıştırılmalıdır." >&2
  exit 1
fi

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_path="${1:-}"
destination_path="${2:-${DATABASE_PATH:-/var/lib/relaydesk/relaydesk.sqlite}}"
if [ -z "$source_path" ] || [ ! -f "$source_path" ]; then
  echo "Kullanım: $0 /var/lib/relaydesk/backup/relaydesk-<timestamp>.sqlite [destination]" >&2
  exit 2
fi

SOURCE_PATH="$source_path" python3 - <<'PY'
import os
import sqlite3

source_path = os.environ["SOURCE_PATH"]
database = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
try:
    result = database.execute("PRAGMA integrity_check").fetchone()[0]
finally:
    database.close()
if result != "ok":
    raise SystemExit(f"Restore kaynağı integrity_check başarısız: {result}")
PY

"$project_root/deploy/backup-relaydesk.sh"
systemctl stop relaydesk-telegram-poller.service relaydesk-listener.service relaydesk-web.service || true
services_stopped=1
restore_services() {
  if [ "${services_stopped:-0}" -eq 1 ]; then
    systemctl start relaydesk-web.service relaydesk-telegram-poller.service relaydesk-listener.service || true
  fi
}
trap restore_services EXIT

destination_dir="$(dirname "$destination_path")"
install -d -o relaydesk -g relaydesk -m 0750 "$destination_dir"
temporary_path="$destination_path.restore.tmp"
cp -- "$source_path" "$temporary_path"
chown relaydesk:relaydesk "$temporary_path"
chmod 0640 "$temporary_path"
mv -f "$temporary_path" "$destination_path"

services_stopped=0
echo "Restore tamamlandı: $destination_path"
