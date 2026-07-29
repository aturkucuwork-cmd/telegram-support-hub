from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import truststore


truststore.inject_into_ssl()


PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = PROJECT_ROOT / ".env.local"
LOCAL_STATUS_URL = "http://localhost:3000/api/status"
LOCAL_WEBHOOK_URL = "http://localhost:3000/api/telegram/webhook"
ALLOWED_UPDATES = [
    "business_connection",
    "business_message",
    "edited_business_message",
    "deleted_business_messages",
    "message",
    "edited_message",
]


class TelegramApiError(RuntimeError):
    pass


class LocalRelayError(RuntimeError):
    pass


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        raise RuntimeError(f"Yapılandırma bulunamadı: {path}")

    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def read_json_response(request: urllib.request.Request, timeout: int) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read().decode("utf-8")
            return json.loads(payload)
    except urllib.error.HTTPError as error:
        try:
            details = json.loads(error.read().decode("utf-8"))
            description = details.get("description", "HTTP isteği başarısız oldu.")
        except (json.JSONDecodeError, UnicodeDecodeError):
            description = "HTTP isteği başarısız oldu."
        raise TelegramApiError(description) from error


def telegram_call(
    token: str,
    method: str,
    payload: dict[str, Any] | None = None,
    *,
    timeout: int = 35,
) -> Any:
    data = json.dumps(payload or {}).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    result = read_json_response(request, timeout)
    if not result.get("ok"):
        raise TelegramApiError(result.get("description", "Telegram API isteği başarısız oldu."))
    return result.get("result")


def verify_local_relay() -> dict[str, Any]:
    request = urllib.request.Request(
        LOCAL_STATUS_URL,
        headers={"Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            status = json.loads(response.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
        raise LocalRelayError(
            "RelayDesk yerel sunucusuna ulaşılamadı: http://localhost:3000"
        ) from error

    if not status.get("configured"):
        raise LocalRelayError(
            "RelayDesk token ve gizli anahtarı yüklememiş. Yerel sunucuyu yeniden başlatın."
        )
    return status


def relay_update(update: dict[str, Any], webhook_secret: str) -> None:
    request = urllib.request.Request(
        LOCAL_WEBHOOK_URL,
        data=json.dumps(update).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Telegram-Bot-Api-Secret-Token": webhook_secret,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            if not 200 <= response.status < 300:
                raise LocalRelayError(f"RelayDesk HTTP {response.status} döndürdü.")
    except urllib.error.HTTPError as error:
        raise LocalRelayError(f"RelayDesk HTTP {error.code} döndürdü.") from error
    except urllib.error.URLError as error:
        raise LocalRelayError("RelayDesk yerel sunucusuna ulaşılamadı.") from error


def remove_existing_webhook(token: str) -> None:
    webhook_info = telegram_call(token, "getWebhookInfo")
    webhook_url = webhook_info.get("url") if isinstance(webhook_info, dict) else None
    if not webhook_url:
        return

    print("Bu botta daha önce ayarlanmış bir webhook bulundu.")
    answer = input(
        "Yerel çalışma için webhook kaldırılsın mı? Bekleyen mesajlar korunur. [E/h]: "
    ).strip().lower()
    if answer not in {"", "e", "evet", "y", "yes"}:
        raise RuntimeError("Webhook kaldırılmadığı için long polling başlatılmadı.")

    telegram_call(token, "deleteWebhook", {"drop_pending_updates": False})
    print("Eski webhook kaldırıldı.")


def run() -> int:
    env = load_env(ENV_PATH)
    token = env.get("TELEGRAM_BOT_TOKEN", "")
    webhook_secret = env.get("TELEGRAM_WEBHOOK_SECRET", "")
    if not token or not webhook_secret:
        raise RuntimeError(".env.local içinde Telegram ayarları eksik.")

    local_status = verify_local_relay()
    bot = telegram_call(token, "getMe")
    remove_existing_webhook(token)

    username = bot.get("username", "bilinmeyen") if isinstance(bot, dict) else "bilinmeyen"
    connection_text = (
        "Business bağlantısı RelayDesk'te kayıtlı."
        if local_status.get("connected")
        else "Business bağlantı güncellemesi bekleniyor."
    )
    print(f"Telegram botu doğrulandı: @{username}")
    print(connection_text)
    print("Mesaj dinleme başladı. Durdurmak için Ctrl+C kullanın.")
    print("Mesaj içerikleri ve token bu terminale yazdırılmaz.")

    offset: int | None = None
    retry_delay = 2
    while True:
        payload: dict[str, Any] = {
            "timeout": 25,
            "allowed_updates": ALLOWED_UPDATES,
        }
        if offset is not None:
            payload["offset"] = offset

        try:
            updates = telegram_call(token, "getUpdates", payload, timeout=35)
            if not isinstance(updates, list):
                raise TelegramApiError("Telegram geçersiz bir güncelleme listesi döndürdü.")

            for update in updates:
                if not isinstance(update, dict) or not isinstance(update.get("update_id"), int):
                    continue
                relay_update(update, webhook_secret)
                offset = update["update_id"] + 1

            retry_delay = 2
        except (TelegramApiError, LocalRelayError, OSError) as error:
            print(f"Geçici bağlantı sorunu: {error} {retry_delay} saniye sonra tekrar denenecek.")
            time.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 30)


if __name__ == "__main__":
    try:
        raise SystemExit(run())
    except KeyboardInterrupt:
        print("\nTelegram dinleme durduruldu.")
        raise SystemExit(0)
    except (RuntimeError, TelegramApiError, LocalRelayError) as error:
        print(f"\nHata: {error}", file=sys.stderr)
        raise SystemExit(1)
