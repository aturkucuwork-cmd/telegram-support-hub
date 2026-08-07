#!/usr/bin/env bash
# Safe, fail-closed P0 retest runner for a real Debian/Ubuntu host.
# It never provisions, restarts, sends Telegram messages, or prints secrets.
set -euo pipefail
umask 077

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${RELAYDESK_ENV_FILE:-/opt/relaydesk/.env.local}"
run_harness=0
run_telegram=0
run_security=0
failures=0
not_run=0
checks=0

usage() {
  cat <<'EOF'
Usage: sudo bash deploy/p0-linux-retest.sh [options]

Read-only production checks. No provisioning, restart, Telegram message, or
secret output is performed.

Options:
  --harness    Run the temporary fake-systemctl SQLite restore harness.
  --telegram   Call Telegram getWebhookInfo without printing the bot token.
  --security   Also run systemd-analyze security for the installed units.
  -h, --help   Show this help.
EOF
}

pass() {
  checks=$((checks + 1))
  printf 'PASS: %s\n' "$1"
}

fail() {
  checks=$((checks + 1))
  failures=$((failures + 1))
  printf 'FAIL: %s\n' "$1" >&2
}

not_run() {
  not_run=$((not_run + 1))
  printf 'NOT RUN: %s\n' "$1" >&2
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

env_value() {
  local key="$1"
  [ -f "$env_file" ] || return 0
  awk -F= -v wanted="$key" '$1 == wanted {sub(/^[^=]*=/, ""); print; exit}' "$env_file"
}

secret_present() {
  local key="$1"
  [ -f "$env_file" ] && awk -F= -v wanted="$key" '$1 == wanted && length($0) > length(wanted) + 1 {found=1} END {exit !found}' "$env_file"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --harness) run_harness=1 ;;
    --telegram) run_telegram=1 ;;
    --security) run_security=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [ "$(uname -s)" != "Linux" ]; then
  printf 'NOT RUN: P0 Linux retest requires Linux; detected %s.\n' "$(uname -s)" >&2
  exit 2
fi
if [ "$(id -u)" -ne 0 ]; then
  echo 'NOT RUN: P0 Linux retest requires root for systemd, ownership, and service checks.' >&2
  exit 2
fi

for command_name in systemctl systemd-analyze curl python3 awk stat; do
  if has_command "$command_name"; then
    pass "required command: $command_name"
  else
    fail "required command missing: $command_name"
  fi
done

if systemctl is-system-running --quiet; then
  pass 'systemd manager is running'
else
  fail 'systemd manager is not running or is degraded'
fi

unit_files=(
  "$project_root/deploy/relaydesk-web.service"
  "$project_root/deploy/relaydesk-telegram-poller.service"
  "$project_root/deploy/relaydesk-listener.service"
  "$project_root/deploy/relaydesk-setup-bridge.service"
  "$project_root/deploy/relaydesk-backup.service"
  "$project_root/deploy/relaydesk-backup.timer"
)
if systemd-analyze verify "${unit_files[@]}"; then
  pass 'RelayDesk systemd unit files verify'
else
  fail 'RelayDesk systemd unit files failed verification'
fi

if [ -f "$env_file" ]; then
  env_mode="$(stat -c '%a' "$env_file")"
  env_owner="$(stat -c '%U' "$env_file")"
  if [ "$env_mode" = '600' ] && [ "$env_owner" = 'relaydesk' ]; then
    pass 'shared environment file has relaydesk:relaydesk ownership and mode 600'
  else
    fail "shared environment file ownership/mode mismatch (owner=$env_owner mode=$env_mode)"
  fi
else
  fail "shared environment file is missing: $env_file"
fi

for secret_name in TELEGRAM_BOT_TOKEN SESSION_ENCRYPTION_KEY INTERNAL_API_SECRET; do
  if secret_present "$secret_name"; then
    pass "$secret_name is present in the shared environment (value hidden)"
  else
    not_run "$secret_name-dependent checks require a non-empty shared environment value"
  fi
done

for unit in relaydesk-web.service relaydesk-telegram-poller.service relaydesk-listener.service; do
  if systemctl is-enabled --quiet "$unit" && systemctl is-active --quiet "$unit"; then
    pass "$unit is enabled and active"
  else
    fail "$unit is not both enabled and active"
  fi
done

if systemctl is-active --quiet relaydesk-setup-bridge.service; then
  pass 'setup bridge is active for the wizard'
else
  not_run 'setup bridge is inactive; start it manually only for the SSH wizard retest'
fi

if curl -fsS --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/healthz | grep -qx '200'; then
  pass 'localhost readiness endpoint returns HTTP 200'
else
  fail 'localhost readiness endpoint did not return HTTP 200'
fi
if curl -sS --max-time 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/status | grep -qx '401'; then
  pass 'anonymous /api/status remains protected with HTTP 401'
else
  fail 'anonymous /api/status did not remain protected with HTTP 401'
fi

database_path="$(env_value DATABASE_PATH || true)"
if [ -n "$database_path" ]; then
  case "$database_path" in
    /*) ;;
    *) database_path="$project_root/$database_path" ;;
  esac
fi
if [ -n "$database_path" ] && [ -f "$database_path" ]; then
  if DATABASE_PATH="$database_path" python3 - <<'PY'
import os
import sqlite3

database = sqlite3.connect(os.environ["DATABASE_PATH"])
try:
    assert database.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
finally:
    database.close()
PY
  then
    pass 'SQLite integrity_check is ok'
  else
    fail 'SQLite integrity_check failed'
  fi
else
  not_run 'SQLite integrity check requires an existing DATABASE_PATH file'
fi

if [ "$run_security" -eq 1 ]; then
  if systemd-analyze security \
      relaydesk-web.service \
      relaydesk-telegram-poller.service \
      relaydesk-listener.service \
      relaydesk-setup-bridge.service; then
    pass 'systemd security report completed (review scores before delivery)'
  else
    fail 'systemd security report failed'
  fi
else
  not_run 'systemd-analyze security was not requested; use --security for the report'
fi

if [ "$run_telegram" -eq 1 ]; then
  if secret_present TELEGRAM_BOT_TOKEN; then
    token="$(env_value TELEGRAM_BOT_TOKEN)"
    if printf '%s' "$token" | python3 -c '
import json
import sys
import urllib.request

token = sys.stdin.read().strip()
if not token:
    raise SystemExit("empty token")
with urllib.request.urlopen(
    f"https://api.telegram.org/bot{token}/getWebhookInfo", timeout=15
) as response:
    payload = json.load(response)
if not payload.get("ok"):
    raise SystemExit("Telegram getWebhookInfo returned ok=false")
result = payload.get("result", {})
if result.get("url"):
    raise SystemExit("Telegram webhook URL is not empty")
print("Telegram getWebhookInfo ok; webhook URL empty")
' 
    then
      pass 'Telegram getWebhookInfo succeeded and webhook URL is empty'
    else
      fail 'Telegram getWebhookInfo failed or webhook URL was not empty'
    fi
  else
    not_run 'Telegram getWebhookInfo requires TELEGRAM_BOT_TOKEN in the shared environment'
  fi
  not_run 'real private/business message to SQLite requires an operator-sent Telegram message and DB query'
else
  not_run 'Telegram checks were not requested; use --telegram only on the intended host'
fi

if [ "$run_harness" -eq 1 ]; then
  if bash "$project_root/tests/restore-relaydesk.integration.sh"; then
    pass 'WSL/Linux fake-systemctl restore harness passed (not production systemd evidence)'
  else
    fail 'Linux restore harness failed'
  fi
else
  not_run 'restore harness was not requested; use --harness for the temporary fake-systemctl test'
fi

not_run 'fresh-host provision, reboot/logout/network recovery, SSH browser wizard, concurrent WAL restore, and separate-host restore require a prepared Linux environment'
printf 'SUMMARY: checks=%s failures=%s not_run=%s\n' "$checks" "$failures" "$not_run"
if [ "$failures" -ne 0 ] || [ "$not_run" -ne 0 ]; then
  echo 'STATUS: BLOCKED — missing or failed evidence must not be treated as production success.'
  exit 2
fi
echo 'STATUS: READY_FOR_REVIEW'
