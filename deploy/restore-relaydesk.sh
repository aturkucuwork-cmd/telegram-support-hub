#!/usr/bin/env bash
# Restore a verified SQLite backup while preserving the pre-restore service state.
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

services=(
  relaydesk-web.service
  relaydesk-telegram-poller.service
  relaydesk-listener.service
)
active_services=()
web_was_active=0
for service in "${services[@]}"; do
  service_state="$(systemctl show "$service" --property=ActiveState --value)"
  case "$service_state" in
    active)
      active_services+=("$service")
      if [ "$service" = "relaydesk-web.service" ]; then
        web_was_active=1
      fi
      ;;
    inactive|failed|deactivating)
      ;;
    *)
      echo "Bilinmeyen $service durumu: $service_state" >&2
      exit 1
      ;;
  esac
done

services_stopped=0
sidecar_backup_dir=""
sidecar_snapshot_dir=""
moved_snapshot_sidecars=()
moved_sidecars=()

rollback_sidecars() {
  local suffix
  for suffix in "${moved_sidecars[@]}"; do
    if [ -e "$sidecar_backup_dir/$(basename "$destination_path")$suffix" ]; then
      mv -- "$sidecar_backup_dir/$(basename "$destination_path")$suffix" "$destination_path$suffix"
    fi
  done
}

restore_sidecar_snapshot() {
  local suffix
  if [ -z "$sidecar_snapshot_dir" ] || [ ! -d "$sidecar_snapshot_dir" ]; then
    return 0
  fi
  for suffix in "${moved_snapshot_sidecars[@]}"; do
    if [ -e "$sidecar_snapshot_dir/$(basename "$destination_path")$suffix" ]; then
      rm -f -- "$destination_path$suffix"
      mv -- "$sidecar_snapshot_dir/$(basename "$destination_path")$suffix" "$destination_path$suffix"
    fi
  done
  rm -rf -- "$sidecar_snapshot_dir"
  sidecar_snapshot_dir=""
}

restore_services() {
  local exit_code="$?"
  local service
  local start_failed=0
  local ready=0
  trap - EXIT

  restore_sidecar_snapshot

  if [ "$services_stopped" -eq 1 ]; then
    for service in "${active_services[@]}"; do
      if ! systemctl start "$service"; then
        echo "Restore sonrası servis başlatılamadı: $service" >&2
        start_failed=1
      fi
    done

    for service in "${active_services[@]}"; do
      if ! systemctl is-active --quiet "$service"; then
        echo "Restore sonrası servis active değil: $service" >&2
        start_failed=1
      fi
    done

    if [ "$web_was_active" -eq 1 ] && [ "$start_failed" -eq 0 ]; then
      for _ in $(seq 1 30); do
        if curl -fsS --max-time 2 "http://localhost:3000/api/healthz" >/dev/null 2>&1; then
          ready=1
          break
        fi
        sleep 1
      done
      if [ "$ready" -ne 1 ]; then
        echo "Restore sonrası web readiness/health kontrolü başarısız." >&2
        start_failed=1
      fi
    fi
  fi

  if [ "$start_failed" -ne 0 ]; then
    exit_code=1
  fi
  if [ "$exit_code" -eq 0 ]; then
    echo "Restore tamamlandı: $destination_path"
  fi
  exit "$exit_code"
}
trap restore_services EXIT

services_stopped=1
for service in "${active_services[@]}"; do
  systemctl stop "$service"
done
for service in "${active_services[@]}"; do
  if systemctl is-active --quiet "$service"; then
    echo "Servis durdurulamadı: $service" >&2
    exit 1
  fi
done

if [ -f "$destination_path" ]; then
  snapshot_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  sidecar_snapshot_dir="$destination_path.restore-sidecars-pending-$snapshot_timestamp"
  for suffix in -wal -shm; do
    sidecar_path="$destination_path$suffix"
    if [ -e "$sidecar_path" ]; then
      if [ -z "${moved_snapshot_sidecars[*]:-}" ]; then
        install -d -m 0700 "$sidecar_snapshot_dir"
      fi
      cp -- "$sidecar_path" "$sidecar_snapshot_dir/$(basename "$destination_path")$suffix"
      moved_snapshot_sidecars+=("$suffix")
    fi
  done
fi

if [ -f "$destination_path" ]; then
  DATABASE_PATH="$destination_path" "$project_root/deploy/backup-relaydesk.sh"
fi

destination_dir="$(dirname "$destination_path")"
install -d -o relaydesk -g relaydesk -m 0750 "$destination_dir"
temporary_path="$destination_path.restore.tmp"
cp -- "$source_path" "$temporary_path"
chown relaydesk:relaydesk "$temporary_path"
chmod 0640 "$temporary_path"

SOURCE_PATH="$source_path" CANDIDATE_PATH="$temporary_path" python3 - <<'PY'
import os
import sqlite3


def table_counts(database):
    names = database.execute(
        "SELECT name FROM sqlite_master "
        "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    counts = {}
    for (name,) in names:
        quoted_name = '"' + name.replace('"', '""') + '"'
        counts[name] = database.execute(f"SELECT COUNT(*) FROM {quoted_name}").fetchone()[0]
    return counts


source = sqlite3.connect(f"file:{os.environ['SOURCE_PATH']}?mode=ro", uri=True)
candidate = sqlite3.connect(f"file:{os.environ['CANDIDATE_PATH']}?mode=ro", uri=True)
try:
    for label, database in (("kaynak", source), ("aday", candidate)):
        result = database.execute("PRAGMA integrity_check").fetchone()[0]
        if result != "ok":
            raise SystemExit(f"{label} integrity_check başarısız: {result}")
    source_counts = table_counts(source)
    candidate_counts = table_counts(candidate)
    if source_counts != candidate_counts:
        raise SystemExit(
            f"Restore kayıt sayısı eşleşmedi: kaynak={source_counts}, aday={candidate_counts}"
        )
    if candidate.execute("SELECT 1").fetchone()[0] != 1:
        raise SystemExit("Restore SQLite smoke başarısız.")
finally:
    candidate.close()
    source.close()
PY

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
sidecar_backup_dir="$destination_path.restore-sidecars-$timestamp"
if [ "${#moved_snapshot_sidecars[@]}" -gt 0 ] || \
   [ -e "${destination_path}-wal" ] || [ -e "${destination_path}-shm" ]; then
  install -d -o relaydesk -g relaydesk -m 0700 "$sidecar_backup_dir"
fi
for suffix in -wal -shm; do
  sidecar_path="$destination_path$suffix"
  sidecar_backup_path="$sidecar_backup_dir/$(basename "$destination_path")$suffix"
  snapshot_sidecar_path="$sidecar_snapshot_dir/$(basename "$destination_path")$suffix"
  if [ -e "$snapshot_sidecar_path" ]; then
    rm -f -- "$sidecar_path"
    if ! mv -- "$snapshot_sidecar_path" "$sidecar_backup_path"; then
      rollback_sidecars
      exit 1
    fi
    moved_sidecars+=("$suffix")
  elif [ -e "$sidecar_path" ]; then
    if ! mv -- "$sidecar_path" "$sidecar_backup_path"; then
      rollback_sidecars
      exit 1
    fi
    moved_sidecars+=("$suffix")
  fi
done
rm -rf -- "$sidecar_snapshot_dir"
sidecar_snapshot_dir=""

if ! mv -f -- "$temporary_path" "$destination_path"; then
  rollback_sidecars
  exit 1
fi
exit 0
