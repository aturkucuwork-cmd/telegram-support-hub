from __future__ import annotations

import asyncio
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

import truststore


truststore.inject_into_ssl()


PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = PROJECT_ROOT / ".env.local"
LOCAL_STATUS_URL = "http://localhost:3000/api/healthz"
LOCAL_WEBHOOK_URL = "http://localhost:3000/api/telegram/webhook"
LOCAL_INTERNAL_BOTS_URL = "http://localhost:3000/api/internal/bots"
BOT_LIST_REFRESH_SECONDS = 60
ALLOWED_UPDATES = [
    "business_connection",
    "business_message",
    "edited_business_message",
    "deleted_business_messages",
    "message",
    "edited_message",
    "channel_post",
    "edited_channel_post",
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

    if not status.get("ok") or not status.get("ready"):
        raise LocalRelayError("RelayDesk hazır değil.")
    return {"configured": True, "connected": False}


def relay_update(update: dict[str, Any], webhook_secret: str, bot_id: int | None) -> None:
    headers = {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": webhook_secret,
    }
    if bot_id is not None:
        headers["X-RelayDesk-Bot-Id"] = str(bot_id)
    request = urllib.request.Request(
        LOCAL_WEBHOOK_URL,
        data=json.dumps(update).encode("utf-8"),
        headers=headers,
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


def remove_existing_webhook(token: str, *, interactive: bool = True) -> None:
    webhook_info = telegram_call(token, "getWebhookInfo")
    webhook_url = webhook_info.get("url") if isinstance(webhook_info, dict) else None
    if not webhook_url:
        return
    if not interactive:
        telegram_call(token, "deleteWebhook", {"drop_pending_updates": False})
        return

    print("Bu botta daha önce ayarlanmış bir webhook bulundu.")
    answer = input(
        "Yerel çalışma için webhook kaldırılsın mı? Bekleyen mesajlar korunur. [E/h]: "
    ).strip().lower()
    if answer not in {"", "e", "evet", "y", "yes"}:
        raise RuntimeError("Webhook kaldırılmadığı için long polling başlatılmadı.")

    telegram_call(token, "deleteWebhook", {"drop_pending_updates": False})
    print("Eski webhook kaldırıldı.")


def fetch_active_bots(internal_secret: str) -> list[dict[str, Any]]:
    request = urllib.request.Request(
        LOCAL_INTERNAL_BOTS_URL,
        headers={
            "Accept": "application/json",
            "X-RelayDesk-Internal-Secret": internal_secret,
            "X-RelayDesk-Internal-Timestamp": str(int(time.time() * 1000)),
            "X-RelayDesk-Internal-Nonce": uuid.uuid4().hex,
        },
        method="GET",
    )
    result = read_json_response(request, 10)
    bots = result.get("bots")
    if not isinstance(bots, list):
        raise LocalRelayError("RelayDesk bot listesi geçersiz bir yanıt döndürdü.")
    return bots


async def poll_one_bot(bot_id: int, token: str, webhook_secret: str) -> None:
    """Runs an independent getUpdates loop for a single bot. Errors on this bot's
    connection never propagate to sibling bot tasks — each backs off on its own."""
    bot = await asyncio.to_thread(telegram_call, token, "getMe")
    username = bot.get("username", "bilinmeyen") if isinstance(bot, dict) else "bilinmeyen"
    await asyncio.to_thread(remove_existing_webhook, token, interactive=False)
    print(f"[bot {bot_id}] Telegram botu doğrulandı: @{username}")
    if isinstance(bot, dict) and not bot.get("can_read_all_group_messages"):
        print(
            f"[bot {bot_id}] UYARI: Grup Gizliliği açık. @BotFather > /setprivacy > "
            "Disable yapın ve botu mevcut gruplara yeniden ekleyin."
        )

    offset: int | None = None
    retry_delay = 2
    while True:
        payload: dict[str, Any] = {"timeout": 25, "allowed_updates": ALLOWED_UPDATES}
        if offset is not None:
            payload["offset"] = offset

        try:
            updates = await asyncio.to_thread(
                telegram_call, token, "getUpdates", payload, timeout=35,
            )
            if not isinstance(updates, list):
                raise TelegramApiError("Telegram geçersiz bir güncelleme listesi döndürdü.")

            for update in updates:
                if not isinstance(update, dict) or not isinstance(update.get("update_id"), int):
                    continue
                await asyncio.to_thread(relay_update, update, webhook_secret, bot_id)
                offset = update["update_id"] + 1

            retry_delay = 2
        except (TelegramApiError, LocalRelayError, OSError) as error:
            print(
                f"[bot {bot_id}] Geçici bağlantı sorunu: {error} "
                f"{retry_delay} saniye sonra tekrar denenecek."
            )
            await asyncio.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 30)


async def run_multi_bot(internal_secret: str, webhook_secret: str) -> None:
    tasks: dict[int, asyncio.Task[None]] = {}

    def start_missing(bots: list[dict[str, Any]]) -> None:
        for bot in bots:
            bot_id = bot.get("id")
            token = bot.get("token")
            if not isinstance(bot_id, int) or not isinstance(token, str) or not token:
                continue
            if bot_id in tasks and not tasks[bot_id].done():
                continue
            tasks[bot_id] = asyncio.create_task(poll_one_bot(bot_id, token, webhook_secret))

    def stop_removed(active_ids: set[int]) -> None:
        for bot_id in list(tasks):
            if bot_id not in active_ids:
                tasks[bot_id].cancel()
                del tasks[bot_id]

    initial = await asyncio.to_thread(fetch_active_bots, internal_secret)
    start_missing(initial)
    print(f"Çoklu-bot dinleme başladı ({len(tasks)} bot). Durdurmak için Ctrl+C kullanın.")
    print("Mesaj içerikleri ve token'lar bu terminale yazdırılmaz.")

    while True:
        await asyncio.sleep(BOT_LIST_REFRESH_SECONDS)
        try:
            active = await asyncio.to_thread(fetch_active_bots, internal_secret)
        except (TelegramApiError, LocalRelayError, OSError) as error:
            print(f"Bot listesi yenilenemedi: {error}")
            continue
        active_ids = {bot["id"] for bot in active if isinstance(bot.get("id"), int)}
        stop_removed(active_ids)
        start_missing(active)


def run_single_bot_bootstrap(token: str, webhook_secret: str) -> int:
    """Legacy single-token loop, used only before any bot has been configured
    through the admin panel (fresh install, pre-setup-wizard)."""
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
    if not bot.get("can_read_all_group_messages"):
        print(
            "UYARI: Botun Grup Gizliliği açık. Tüm grup mesajları için "
            "@BotFather > /setprivacy > Disable yapın ve botu mevcut gruplara "
            "yeniden ekleyin veya botu grup yöneticisi yapın."
        )
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
                relay_update(update, webhook_secret, None)
                offset = update["update_id"] + 1

            retry_delay = 2
        except (TelegramApiError, LocalRelayError, OSError) as error:
            print(f"Geçici bağlantı sorunu: {error} {retry_delay} saniye sonra tekrar denenecek.")
            time.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 30)


def run() -> int:
    env = load_env(ENV_PATH)
    webhook_secret = env.get("TELEGRAM_WEBHOOK_SECRET", "")
    internal_secret = env.get("INTERNAL_API_SECRET", "")
    token = env.get("TELEGRAM_BOT_TOKEN", "")
    if not webhook_secret:
        raise RuntimeError(".env.local içinde TELEGRAM_WEBHOOK_SECRET eksik.")

    verify_local_relay()

    active_bots: list[dict[str, Any]] = []
    if internal_secret:
        try:
            active_bots = fetch_active_bots(internal_secret)
        except (TelegramApiError, LocalRelayError, OSError) as error:
            print(f"Bot listesi alınamadı, tek-token bootstrap moduna düşülüyor: {error}")

    if active_bots:
        asyncio.run(run_multi_bot(internal_secret, webhook_secret))
        return 0

    if not token:
        raise RuntimeError(
            "Panelde hiç bot yapılandırılmadı ve .env.local içinde TELEGRAM_BOT_TOKEN yok."
        )
    return run_single_bot_bootstrap(token, webhook_secret)


if __name__ == "__main__":
    try:
        raise SystemExit(run())
    except KeyboardInterrupt:
        print("\nTelegram dinleme durduruldu.")
        raise SystemExit(0)
    except (RuntimeError, TelegramApiError, LocalRelayError) as error:
        print(f"\nHata: {error}", file=sys.stderr)
        raise SystemExit(1)
