#!/usr/bin/env bash
# Saves the BotFather bot token to .env.local without ever printing it to the
# terminal or a shell history file (uses `read -s`, the POSIX equivalent of
# PowerShell's Read-Host -AsSecureString).
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_path="$project_root/.env.local"
python_path="$project_root/.venv/bin/python"
if [ ! -x "$python_path" ]; then
  python_path="$(command -v python3 || command -v python)"
fi

echo
echo "RelayDesk - Yerel Telegram yapılandırması"
echo "BotFather token'ı yalnızca bu sunucudaki .env.local dosyasına kaydedilir."
echo "Token ekranda görünmez ve kaynak koduna eklenmez."
echo

read -r -s -p "BotFather bot token'ını girin: " bot_token
echo

if ! [[ "$bot_token" =~ ^[0-9]{5,20}:[A-Za-z0-9_-]{20,}$ ]]; then
  echo "Bot token biçimi geçersiz. BotFather tarafından verilen token'ı eksiksiz girin." >&2
  exit 1
fi

bot_username="$("$python_path" - "$bot_token" <<'PY'
import json
import sys
import urllib.request

token = sys.argv[1]
try:
    with urllib.request.urlopen(f"https://api.telegram.org/bot{token}/getMe", timeout=20) as response:
        result = json.load(response)
except Exception:
    sys.exit(1)

username = result.get("result", {}).get("username") if result.get("ok") else None
if not username:
    sys.exit(1)
print(username)
PY
)" || {
  echo "Token Telegram tarafından doğrulanamadı. Token'ı ve internet bağlantısını kontrol edin." >&2
  exit 1
}

webhook_secret="$("$python_path" -c 'import secrets; print(secrets.token_hex(32))')"

tmp_file="$(mktemp)"
if [ -f "$env_path" ]; then
  grep -Ev '^\s*(TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|SUPPORT_ALLOWED_EMAILS)\s*=' "$env_path" > "$tmp_file" || true
fi
{
  cat "$tmp_file"
  echo "TELEGRAM_BOT_TOKEN=$bot_token"
  echo "TELEGRAM_WEBHOOK_SECRET=$webhook_secret"
  echo "SUPPORT_ALLOWED_EMAILS=demo@relaydesk.local,indafelhayat@gmail.com"
} > "$env_path"
rm -f "$tmp_file"

echo
echo "Token doğrulandı: @${bot_username}"
echo "Yerel ayarlar güvenle kaydedildi."
