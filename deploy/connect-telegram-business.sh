#!/usr/bin/env bash
# Thin wrapper: activates the project venv (creating it on first run) and
# runs the one-off Business-bot connector tool.
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python_path="$project_root/.venv/bin/python"
requirements_path="$project_root/requirements-connect.txt"
connector_path="$project_root/scripts/connect_telegram_business.py"

if [ ! -x "$python_path" ]; then
  echo "İzole Python ortamı hazırlanıyor..."
  python3 -m venv "$project_root/.venv"
fi

if ! "$python_path" -c "import telethon, truststore" >/dev/null 2>&1; then
  echo "Telegram bağlantı bileşeni kuruluyor..."
  "$python_path" -m pip install -r "$requirements_path"
fi

set +e
"$python_path" "$connector_path"
exit_code=$?
set -e

if [ "$exit_code" -eq 0 ]; then
  echo
  echo "Bağlantı tamamlandı."
else
  echo
  echo "Bağlantı tamamlanamadı (kod: $exit_code). Mesajı kontrol edip tekrar deneyin." >&2
fi

exit "$exit_code"
