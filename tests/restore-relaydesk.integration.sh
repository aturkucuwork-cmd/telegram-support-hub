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
cleanup() {
  rm -rf -- "$tmp_root"
}
trap cleanup EXIT

source_path="$tmp_root/source.sqlite"
destination_path="$tmp_root/destination.sqlite"
backup_root="$tmp_root/backups"
state_path="$tmp_root/service-state"
log_path="$tmp_root/systemctl.log"
fake_bin="$tmp_root/bin"
mkdir -p "$fake_bin"

python3 - "$source_path" "$destination_path" <<'PY'
import sqlite3
import sys

source, destination = sys.argv[1:]
for path, value in ((source, "restored"), (destination, "old")):
    database = sqlite3.connect(path)
    database.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, body TEXT NOT NULL)")
    database.execute("INSERT INTO messages (body) VALUES (?)", (value,))
    database.commit()
    database.close()
PY
printf 'inactive\nactive\ninactive\n' > "$state_path"
printf 'stale wal' > "$destination_path-wal"

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
      index="$(service_index "$service")"
      if [ "$command" = "stop" ]; then
        set_state "$index" inactive
      else
        set_state "$index" active
      fi
      printf '%s %s\n' "$command" "$service" >> "$log_path"
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

PATH="$fake_bin:$PATH" \
RELAYDESK_TEST_STATE="$state_path" \
RELAYDESK_TEST_LOG="$log_path" \
RELAYDESK_BACKUP_ROOT="$backup_root" \
DATABASE_PATH="$destination_path" \
bash "$project_root/deploy/restore-relaydesk.sh" "$source_path" "$destination_path"

if [ -e "$destination_path-wal" ] || [ -e "$destination_path-shm" ]; then
  echo "WAL/SHM sidecar restore cleanup failed" >&2
  exit 1
fi
if [ "$(sed -n '1p' "$state_path")" != "inactive" ] || [ "$(sed -n '2p' "$state_path")" != "active" ]; then
  echo "Previously active service was not restored to active" >&2
  exit 1
fi
if [ "$(sed -n '3p' "$state_path")" != "inactive" ]; then
  echo "Previously inactive listener was unexpectedly started" >&2
  exit 1
fi
if ! grep -q '^stop relaydesk-telegram-poller.service$' "$log_path" || \
   ! grep -q '^start relaydesk-telegram-poller.service$' "$log_path"; then
  echo "Poller stop/start transition was not observed" >&2
  exit 1
fi

python3 - "$destination_path" <<'PY'
import sqlite3
import sys

database = sqlite3.connect(sys.argv[1])
try:
    assert database.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert database.execute("SELECT body FROM messages").fetchone()[0] == "restored"
finally:
    database.close()
PY
echo "PASS: restore integrity, WAL/SHM isolation, and service-state transition"
