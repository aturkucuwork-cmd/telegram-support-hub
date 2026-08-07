#!/usr/bin/env bash
# Thin wrapper: activates the project venv and runs the interactive Telegram
# user-listener setup (my.telegram.org api_id/api_hash + phone/2FA login).
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python_path="$project_root/.venv/bin/python"
requirements_path="$project_root/requirements-connect.txt"

if [ ! -x "$python_path" ]; then
  echo "Python sanal ortamı bulunamadı. Önce RelayDesk Telegram bağlantısını kurun." >&2
  exit 1
fi

if ! "$python_path" -c "import telethon, truststore" >/dev/null 2>&1; then
  echo "Telegram bağlantı bileşenleri kuruluyor..."
  "$python_path" -m pip install -r "$requirements_path"
fi

"$python_path" "$project_root/scripts/configure_telegram_user_listener.py"
