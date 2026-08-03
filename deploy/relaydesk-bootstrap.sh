#!/usr/bin/env bash
# Enables and starts the RelayDesk system-level units, then health-checks the
# local web app. The setup bridge is intentionally not enabled; start it only
# during first-run setup.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Bu bootstrap script'i root olarak çalıştırılmalıdır (sudo -i veya sudo bash deploy/relaydesk-bootstrap.sh)." >&2
  exit 1
fi

echo "RelayDesk sistemleri etkinleştiriliyor..."

systemctl daemon-reload
systemctl enable --now relaydesk-web.service
systemctl enable --now relaydesk-telegram-poller.service

systemctl enable relaydesk-listener.service

echo "RelayDesk sunucusunun hazır olması bekleniyor..."
ready=0
for _ in $(seq 1 30); do
  sleep 1
  if curl -fsS "http://localhost:3000/api/healthz" >/dev/null 2>&1; then
    ready=1
    break
  fi
done

if [ "$ready" -ne 1 ]; then
  echo "RelayDesk 30 saniye içinde hazır olmadı. Kontrol edin: systemctl status relaydesk-web.service" >&2
  exit 1
fi

echo
echo "RelayDesk hazır: http://localhost:3000"
echo "Servis durumu: systemctl status relaydesk-web.service"
echo "Bot poller durumu: systemctl status relaydesk-telegram-poller.service"
echo "Dinleyici durumu: systemctl status relaydesk-listener.service"
