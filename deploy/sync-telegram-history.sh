#!/usr/bin/env bash
# Thin wrapper: activates the project venv and runs the one-off historical
# chat/group import tool.
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python_path="$project_root/.venv/bin/python"
requirements_path="$project_root/requirements-connect.txt"
sync_path="$project_root/scripts/sync_telegram_history.py"

if [ ! -x "$python_path" ]; then
  echo "Python sanal ortamı bulunamadı. Önce connect-telegram-business.sh aracını çalıştırın." >&2
  exit 1
fi

if ! "$python_path" -c "import telethon, truststore" >/dev/null 2>&1; then
  echo "Telegram senkronizasyon bileşenleri kuruluyor..."
  "$python_path" -m pip install -r "$requirements_path"
fi

set +e
"$python_path" "$sync_path"
exit_code=$?
set -e

if [ "$exit_code" -eq 0 ]; then
  echo
  echo "Geçmiş senkronizasyonu tamamlandı. Paneli yenileyebilirsiniz."
else
  echo
  echo "Geçmiş senkronizasyonu tamamlanamadı (kod: $exit_code)." >&2
fi

exit "$exit_code"
