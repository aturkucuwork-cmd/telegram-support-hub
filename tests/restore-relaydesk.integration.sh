#!/usr/bin/env bash
# Linux-only integration test. It uses a fake systemctl, but real bash, SQLite,
# WAL sidecars, restore copy, integrity checks, and service-state assertions.
set -euo pipefail

if [ "$(uname -s)" != "Linux" ]; then
  echo "NOT RUN: restore integration requires Linux/systemd semantics."
  exit 0
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "NOT RUN: restore integration requires root because restore-relaydesk.sh does." >&2
  exit 0
fi

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_root="$(mktemp -d)"
source_path="$tmp_root/source.sqlite"
destination_path="$tmp_root/destination.sqlite"
backup_root="$tmp_root/backups"
state_path="$tmp_root/service-state"
log_path="$tmp_root/systemctl.log"
fake_bin="$tmp_root/bin"
writer_ready_path="$tmp_root/writer.ready"
writer_stop_path="$tmp_root/writer.stop"
writer_pid=""
cleanup() {
  if [ -n "${writer_pid:-}" ]; then
    : > "$writer_stop_path"
    wait "$writer_pid" 2>/dev/null || true
  fi
  rm -rf -- "$tmp_root"
}
trap cleanup EXIT

mkdir -p "$fake_bin"

python3 - "$source_path" <<'PY'
import sqlite3
import sys

source = sys.argv[1]
database = sqlite3.connect(source)
assert database.execute("PRAGMA journal_mode=WAL").fetchone()[0] == "wal"
database.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, body TEXT NOT NULL)")
database.execute("INSERT INTO messages (body) VALUES (?)", ("restored",))
database.commit()
assert database.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0] == 0
database.close()
PY

python3 - "$destination_path" "$writer_ready_path" "$writer_stop_path" <<'PY' &
import sqlite3
import sys
import time
from pathlib import Path

destination, ready_path, stop_path = sys.argv[1:]
database = sqlite3.connect(destination, timeout=30)
assert database.execute("PRAGMA journal_mode=WAL").fetchone()[0] == "wal"
database.execute("PRAGMA wal_autocheckpoint=0")
database.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, body TEXT NOT NULL)")
database.execute("INSERT INTO messages (body) VALUES (?)", ("old",))
database.commit()
Path(ready_path).touch()
while not Path(stop_path).exists():
    time.sleep(0.05)
database.close()
PY
writer_pid=$!
for _ in $(seq 1 100); do
  if [ -f "$writer_ready_path" ]; then
    break
  fi
  if ! kill -0 "$writer_pid" 2>/dev/null; then
    wait "$writer_pid"
    echo "WAL fixture writer exited before becoming ready" >&2
    exit 1
  fi
  sleep 0.05
done
if [ ! -f "$writer_ready_path" ] || [ ! -f "$destination_path-wal" ] || [ ! -f "$destination_path-shm" ]; then
  echo "WAL fixture did not produce real SQLite -wal/-shm files" >&2
  exit 1
fi
wal_sha256="$(sha256sum "$destination_path-wal" | awk '{print $1}')"
shm_sha256="$(sha256sum "$destination_path-shm" | awk '{print $1}')"
shm_size="$(stat -c '%s' "$destination_path-shm")"
printf 'active\nactive\nactive\n' > "$state_path"

cat > "$fake_bin/systemctl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
state_path="$RELAYDESK_TEST_STATE"
log_path="$RELAYDESK_TEST_LOG"
services=(relaydesk-web.service relaydesk-telegram-poller.service relaydesk-listener.service)
service_index() {
  local wanted="$1"
  local index=0
  for service in "${services[@]}"; do
    if [ "$service" = "$wanted" ]; then
      echo "$index"
      return 0
    fi
    index=$((index + 1))
  done
  return 1
}
set_state() {
  local service_number="$1"
  local value="$2"
  awk -v service_number="$service_number" -v value="$value" 'NR == service_number + 1 {$0 = value} {print}' "$state_path" > "$state_path.tmp"
  mv "$state_path.tmp" "$state_path"
}
get_state() {
  sed -n "$(( $1 + 1 ))p" "$state_path"
}

command="$1"
shift
case "$command" in
  show)
    service="$1"
    index="$(service_index "$service")"
    get_state "$index"
    ;;
  is-active)
    if [ "$1" = "--quiet" ]; then shift; fi
    service="$1"
    index="$(service_index "$service")"
    [ "$(get_state "$index")" = "active" ]
    ;;
  stop|start)
    for service in "$@"; do
      printf '%s %s\n' "$command" "$service" >> "$log_path"
      if [ "${RELAYDESK_TEST_FAIL_COMMAND:-}" = "$command $service" ]; then
        exit 1
      fi
      index="$(service_index "$service")"
      if [ "$command" = "stop" ]; then
        set_state "$index" inactive
      else
        set_state "$index" active
      fi
    done
    ;;
  *)
    echo "unexpected systemctl command: $command $*" >&2
    exit 1
    ;;
esac
SH
chmod 0755 "$fake_bin/systemctl"

cat > "$fake_bin/install" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
mode=""
directory=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -d) ;;
    -o|-g|-m) shift ;;
    *) directory="$1" ;;
  esac
  shift
done
mkdir -p "$directory"
if [ -n "$mode" ]; then chmod "$mode" "$directory"; fi
SH
chmod 0755 "$fake_bin/install"

cat > "$fake_bin/chown" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod 0755 "$fake_bin/chown"

cat > "$fake_bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$RELAYDESK_TEST_CURL_LOG"
[ "${RELAYDESK_TEST_READINESS:-pass}" = "pass" ]
SH
chmod 0755 "$fake_bin/curl"

cat > "$fake_bin/sleep" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod 0755 "$fake_bin/sleep"

prepare_case() {
  local case_name="$1"
  local listener_state="${2:-active}"
  local case_root="$tmp_root/$case_name"
  mkdir -p "$case_root"
  case_source="$case_root/source.sqlite"
  case_destination="$case_root/destination.sqlite"
  case_state="$case_root/service-state"
  case_log="$case_root/systemctl.log"
  case_curl_log="$case_root/curl.log"
  case_backup_root="$case_root/backups"
  python3 - "$case_source" "$case_destination" <<'PY'
import sqlite3
import sys

source, destination = sys.argv[1:]
for path, value in ((source, "restored"), (destination, "old")):
    database = sqlite3.connect(path)
    assert database.execute("PRAGMA journal_mode=WAL").fetchone()[0] == "wal"
    database.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, body TEXT NOT NULL)")
    database.execute("INSERT INTO messages (body) VALUES (?)", (value,))
    database.commit()
    database.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    database.close()
PY
  printf 'active\nactive\n%s\n' "$listener_state" > "$case_state"
}

run_case() {
  local expected_status="$1"
  local fail_command="$2"
  local readiness="$3"
  if PATH="$fake_bin:$PATH" \
    RELAYDESK_TEST_STATE="$case_state" \
    RELAYDESK_TEST_LOG="$case_log" \
    RELAYDESK_TEST_CURL_LOG="$case_curl_log" \
    RELAYDESK_TEST_FAIL_COMMAND="$fail_command" \
    RELAYDESK_TEST_READINESS="$readiness" \
    RELAYDESK_BACKUP_ROOT="$case_backup_root" \
    DATABASE_PATH="$case_destination" \
    bash "$project_root/deploy/restore-relaydesk.sh" "$case_source" "$case_destination"; then
    actual_status=0
  else
    actual_status=$?
  fi
  if [ "$actual_status" -ne "$expected_status" ]; then
    echo "Unexpected restore status: expected=$expected_status actual=$actual_status" >&2
    exit 1
  fi
}

PATH="$fake_bin:$PATH" \
RELAYDESK_TEST_STATE="$state_path" \
RELAYDESK_TEST_LOG="$log_path" \
RELAYDESK_TEST_CURL_LOG="$tmp_root/curl.log" \
RELAYDESK_TEST_READINESS="pass" \
RELAYDESK_BACKUP_ROOT="$backup_root" \
DATABASE_PATH="$destination_path" \
bash "$project_root/deploy/restore-relaydesk.sh" "$source_path" "$destination_path"

if [ -e "$destination_path-wal" ] || [ -e "$destination_path-shm" ]; then
  echo "WAL/SHM sidecar restore cleanup failed" >&2
  exit 1
fi
if [ "$(sed -n '1p' "$state_path")" != "active" ] || [ "$(sed -n '2p' "$state_path")" != "active" ]; then
  echo "Previously active services were not restored to active" >&2
  exit 1
fi
if [ "$(sed -n '3p' "$state_path")" != "active" ]; then
  echo "Previously active listener was not restored to active" >&2
  exit 1
fi
expected_log=$'stop relaydesk-web.service\nstop relaydesk-telegram-poller.service\nstop relaydesk-listener.service\nstart relaydesk-web.service\nstart relaydesk-telegram-poller.service\nstart relaydesk-listener.service'
if [ "$(cat "$log_path")" != "$expected_log" ]; then
  echo "Active service stop/start order was not preserved" >&2
  cat "$log_path" >&2
  exit 1
fi
if [ ! -s "$tmp_root/curl.log" ]; then
  echo "Active web readiness check was not observed" >&2
  exit 1
fi

sidecar_backup_dir="$(find "$(dirname "$destination_path")" -mindepth 1 -maxdepth 1 -type d -name 'destination.sqlite.restore-sidecars-*' -print -quit)"
if [ -z "$sidecar_backup_dir" ]; then
  echo "Restore sidecar backup directory was not created" >&2
  exit 1
fi
expected_sidecar_names=$'destination.sqlite-shm\ndestination.sqlite-wal'
if [ "$(find "$sidecar_backup_dir" -mindepth 1 -maxdepth 1 -type f -printf '%f\n' | sort)" != "$expected_sidecar_names" ]; then
  echo "Restore sidecar backup file names were not preserved" >&2
  find "$sidecar_backup_dir" -mindepth 1 -maxdepth 1 -type f -printf '%f\n' >&2
  exit 1
fi
actual_wal_sha256="$(sha256sum "$sidecar_backup_dir/destination.sqlite-wal" | awk '{print $1}')"
actual_shm_sha256="$(sha256sum "$sidecar_backup_dir/destination.sqlite-shm" | awk '{print $1}')"
actual_shm_size="$(stat -c '%s' "$sidecar_backup_dir/destination.sqlite-shm")"
if [ "$actual_wal_sha256" != "$wal_sha256" ] || \
   [ "$actual_shm_sha256" != "$shm_sha256" ] || \
   [ "$actual_shm_size" != "$shm_size" ] || \
   [ ! -s "$sidecar_backup_dir/destination.sqlite-shm" ]; then
  echo "Restore sidecar backup contents were not preserved" >&2
   echo "expected wal=$wal_sha256 shm=$shm_sha256 shm_size=$shm_size" >&2
   echo "actual wal=$actual_wal_sha256 shm=$actual_shm_sha256 shm_size=$actual_shm_size" >&2
  exit 1
fi

python3 - "$destination_path" <<'PY'
import sqlite3
import sys

database = sqlite3.connect(sys.argv[1])
try:
    assert database.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert database.execute("SELECT COUNT(*) FROM messages").fetchone()[0] == 1
    assert database.execute("SELECT body FROM messages").fetchone()[0] == "restored"
finally:
    database.close()
PY

: > "$writer_stop_path"
wait "$writer_pid"
writer_pid=""
if [ -e "$destination_path-wal" ] || [ -e "$destination_path-shm" ]; then
  echo "Destination retained a SQLite sidecar after the WAL restore" >&2
  exit 1
fi

prepare_case stop-failure
run_case 1 'stop relaydesk-web.service' pass
if [ "$(sed -n '1p' "$case_state")" != "active" ] || \
   [ "$(sed -n '2p' "$case_state")" != "active" ] || \
   [ "$(sed -n '3p' "$case_state")" != "active" ]; then
  echo "Stop failure did not preserve active service recovery" >&2
  exit 1
fi

prepare_case start-failure active
run_case 1 'start relaydesk-telegram-poller.service' pass
if [ "$(sed -n '1p' "$case_state")" != "active" ] || \
   [ "$(sed -n '2p' "$case_state")" != "inactive" ] || \
   [ "$(sed -n '3p' "$case_state")" != "active" ]; then
  echo "Start failure did not preserve listener recovery while poller failed" >&2
  exit 1
fi

prepare_case readiness-failure inactive
run_case 1 '' fail
if [ ! -s "$case_curl_log" ]; then
  echo "Readiness failure path did not execute the web health check" >&2
  exit 1
fi
if [ "$(sed -n '3p' "$case_state")" != "inactive" ]; then
  echo "Previously inactive listener was unexpectedly started" >&2
  exit 1
fi

prepare_case inactive-success inactive
run_case 0 '' pass
inactive_success_listener_state="$(sed -n '3p' "$case_state")"
inactive_success_log=$'stop relaydesk-web.service\nstop relaydesk-telegram-poller.service\nstart relaydesk-web.service\nstart relaydesk-telegram-poller.service'
if [ "$(cat "$case_log")" != "$inactive_success_log" ]; then
  echo "Successful restore changed inactive listener service order" >&2
  cat "$case_log" >&2
  exit 1
fi
if [ "$inactive_success_listener_state" != "inactive" ]; then
  echo "Successful restore unexpectedly started an inactive listener" >&2
  exit 1
fi

echo "NOT RUN: concurrent live writer/restore and separate-host restore require a real Linux E2E environment."
echo "PASS: real SQLite WAL fixture, sidecar preservation, integrity/count, and service-state recovery"
