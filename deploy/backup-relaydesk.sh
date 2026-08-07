#!/usr/bin/env bash
# WAL-safe online backup for the local RelayDesk SQLite database.
set -euo pipefail
umask 077

database_path="${DATABASE_PATH:-/var/lib/relaydesk/relaydesk.sqlite}"
backup_root="${RELAYDESK_BACKUP_ROOT:-/var/lib/relaydesk/backup}"
retention_days="${RELAYDESK_BACKUP_RETENTION_DAYS:-14}"

if [ ! -f "$database_path" ]; then
  echo "SQLite veritabanı bulunamadı: $database_path" >&2
  exit 1
fi
mkdir -p "$backup_root"
chmod 0700 "$backup_root"
exec 9>"$backup_root/.backup.lock"
if ! flock -n 9; then
  echo "Başka bir RelayDesk yedekleme işlemi devam ediyor." >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output_path="$backup_root/relaydesk-$timestamp.sqlite"
temporary_path="$output_path.tmp"
trap 'rm -f "$temporary_path"' EXIT

DATABASE_PATH="$database_path" OUTPUT_PATH="$temporary_path" python3 - <<'PY'
import os
import sqlite3
from pathlib import Path

source_path = os.environ["DATABASE_PATH"]
output_path = Path(os.environ["OUTPUT_PATH"])
source = sqlite3.connect(source_path, timeout=30)
destination = sqlite3.connect(output_path)
try:
    source.backup(destination, pages=100, sleep=0.1)
    result = destination.execute("PRAGMA integrity_check").fetchone()[0]
    if result != "ok":
        raise RuntimeError(f"Backup integrity_check başarısız: {result}")
    destination.commit()
finally:
    destination.close()
    source.close()
output_path.chmod(0o600)
PY

mv -f "$temporary_path" "$output_path"
find "$backup_root" -type f -name 'relaydesk-*.sqlite' -mtime "+$retention_days" -delete
echo "SQLite online backup hazır: $output_path"
