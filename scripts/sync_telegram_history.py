"""Import recent private-chat and group history without persisting a user session."""

from __future__ import annotations

import asyncio
import getpass
import json
import secrets
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import truststore
from telethon import TelegramClient, errors, types, utils
from telethon.sessions import MemorySession
from telethon.tl.functions.messages import GetForumTopicsRequest


truststore.inject_into_ssl()

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = PROJECT_ROOT / ".env.local"
STATUS_URL = "http://localhost:3000/api/internal/status"
IMPORT_URL = "http://localhost:3000/api/telegram/import"
STATUS_PATH = PROJECT_ROOT / ".sync-status.json"
BATCH_SIZE = 100


def write_status(phase: str, **details: Any) -> None:
    payload = {"phase": phase, **details}
    STATUS_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        raise RuntimeError(".env.local bulunamadı. Önce yerel Telegram bağlantısını başlatın.")
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def ask_api_id() -> int:
    while True:
        raw = input("App api_id: ").strip()
        if raw.isdigit():
            return int(raw)
        print("api_id yalnızca rakamlardan oluşmalıdır.")


def ask_api_hash() -> str:
    while True:
        value = getpass.getpass("App api_hash (gizli): ").strip()
        if re.fullmatch(r"[0-9a-fA-F]{32}", value):
            return value
        print("api_hash 32 karakterlik hexadecimal değer olmalıdır.")


def ask_phone() -> str:
    while True:
        value = input("Telegram telefon numarası (örn. +905...): ").strip().replace(" ", "")
        if re.fullmatch(r"\+[1-9][0-9]{7,14}", value):
            return value
        print("Numarayı ülke koduyla birlikte girin; örnek: +905xxxxxxxxx")


def ask_limit(label: str, default: int, maximum: int) -> int:
    while True:
        raw = input(f"{label} [{default}]: ").strip()
        if not raw:
            return default
        if raw.isdigit() and 1 <= int(raw) <= maximum:
            return int(raw)
        print(f"1-{maximum} arasında bir sayı girin.")


async def authorize(client: TelegramClient, phone: str) -> None:
    await client.send_code_request(phone)
    code = input("Telegram uygulamasına gelen giriş kodu: ").strip().replace(" ", "")
    try:
        await client.sign_in(phone=phone, code=code)
    except errors.SessionPasswordNeededError:
        password = getpass.getpass("İki aşamalı doğrulama parolası (gizli): ")
        await client.sign_in(password=password)


def request_json(
    url: str,
    *,
    payload: dict[str, Any] | None = None,
    webhook_secret: str | None = None,
    internal_secret: str | None = None,
) -> dict[str, Any]:
    headers = {"Accept": "application/json"}
    data = None
    method = "GET"
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
        method = "POST"
    if webhook_secret:
        headers["X-Telegram-Bot-Api-Secret-Token"] = webhook_secret
    if internal_secret:
        headers["X-RelayDesk-Internal-Secret"] = internal_secret
        headers["X-RelayDesk-Internal-Timestamp"] = str(int(__import__("time").time() * 1000))
        headers["X-RelayDesk-Internal-Nonce"] = secrets.token_hex(16)

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read().decode("utf-8"))
            description = body.get("error", f"HTTP {error.code}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            description = f"HTTP {error.code}"
        raise RuntimeError(f"RelayDesk isteği başarısız: {description}") from error
    except urllib.error.URLError as error:
        raise RuntimeError("RelayDesk yerel sunucusuna ulaşılamadı.") from error


def chat_from_entity(entity: Any) -> tuple[str, dict[str, Any]] | None:
    if isinstance(entity, types.User):
        if (
            getattr(entity, "is_self", False)
            or getattr(entity, "self", False)
            or getattr(entity, "bot", False)
        ):
            return None
        return (
            "business",
            {
                "id": entity.id,
                "type": "private",
                "first_name": entity.first_name or "Telegram kullanıcısı",
                "last_name": entity.last_name,
                "username": entity.username,
            },
        )

    if isinstance(entity, types.Chat):
        return (
            "group",
            {
                "id": utils.get_peer_id(entity),
                "type": "group",
                "title": entity.title or "Telegram grubu",
            },
        )

    if isinstance(entity, types.Channel):
        return (
            "group",
            {
                "id": utils.get_peer_id(entity),
                "type": "supergroup" if getattr(entity, "megagroup", False) else "channel",
                "title": entity.title or "Telegram grubu",
                "username": entity.username,
            },
        )
    return None


def sender_payload(sender: Any, fallback: Any) -> dict[str, Any]:
    entity = sender or fallback
    return {
        "id": getattr(entity, "id", None),
        "first_name": (
            getattr(entity, "first_name", None)
            or getattr(entity, "title", None)
            or "Bilinmeyen"
        ),
        "last_name": getattr(entity, "last_name", None),
        "username": getattr(entity, "username", None),
    }


def historical_text(message: Any) -> str | None:
    if isinstance(message.action, types.MessageActionTopicCreate):
        return f"Konu oluşturuldu: {message.action.title}"
    text = (message.raw_text or "").strip()
    label = None
    if getattr(message, "photo", None):
        label = "Fotoğraf"
    elif getattr(message, "sticker", None):
        label = "Çıkartma"
    elif getattr(message, "voice", None):
        label = "Sesli mesaj"
    elif getattr(message, "video_note", None):
        label = "Video mesaj"
    elif getattr(message, "video", None):
        label = "Video"
    elif getattr(message, "audio", None):
        label = "Ses dosyası"
    elif getattr(message, "gif", None):
        label = "Animasyon"
    elif getattr(message, "document", None):
        label = "Belge"
    elif getattr(message, "poll", None):
        label = "Anket"
    elif getattr(message, "geo", None):
        label = "Konum"
    elif getattr(message, "contact", None):
        label = "Kişi"

    if text:
        return text
    return label


async def message_payload(
    message: Any,
    *,
    source: str,
    chat: dict[str, Any],
    connection_id: str,
    account: Any,
    topic_id: int | None = None,
    topic_title: str | None = None,
) -> dict[str, Any] | None:
    if message.action is not None and not isinstance(
        message.action,
        types.MessageActionTopicCreate,
    ):
        return None
    text = historical_text(message)
    if not text:
        return None

    sender = message.sender
    if sender is None:
        try:
            sender = await message.get_sender()
        except (errors.RPCError, ValueError):
            sender = None

    telegram_message: dict[str, Any] = {
        "message_id": message.id,
        "date": int(message.date.timestamp()),
        "chat": {key: value for key, value in chat.items() if value is not None},
        "from": {
            key: value
            for key, value in sender_payload(sender, account if message.out else None).items()
            if value is not None
        },
        "text": text,
    }
    if source == "business":
        telegram_message["business_connection_id"] = connection_id
    reply_to_message_id = getattr(message, "reply_to_msg_id", None)
    if isinstance(reply_to_message_id, int):
        telegram_message["reply_to_message"] = {"message_id": reply_to_message_id}
    if topic_id is not None:
        telegram_message["message_thread_id"] = topic_id
        telegram_message["is_topic_message"] = True
        telegram_message["relaydesk_topic_title"] = topic_title or (
            "Genel" if topic_id == 1 else f"Konu #{topic_id}"
        )

    return {
        "source": source,
        "outgoing": bool(message.out),
        "message": telegram_message,
    }


async def forum_topics(client: TelegramClient, entity: Any) -> dict[int, str]:
    if not isinstance(entity, types.Channel) or not getattr(entity, "forum", False):
        return {}

    result = await client(
        GetForumTopicsRequest(
            peer=await client.get_input_entity(entity),
            offset_date=None,
            offset_id=0,
            offset_topic=0,
            limit=100,
            q=None,
        )
    )
    topics = {
        int(topic.id): str(topic.title)
        for topic in getattr(result, "topics", [])
        if getattr(topic, "id", None) is not None
        and getattr(topic, "title", None)
    }
    topics.setdefault(1, "Genel")
    return topics


def post_batch(items: list[dict[str, Any]], internal_secret: str) -> int:
    if not items:
        return 0
    result = request_json(
        IMPORT_URL,
        payload={"items": items},
        internal_secret=internal_secret,
    )
    return int(result.get("imported", 0))


async def sync_history() -> int:
    write_status("starting")
    env = load_env(ENV_PATH)
    internal_secret = env.get("INTERNAL_API_SECRET", "")
    if not internal_secret:
        raise RuntimeError(".env.local içinde internal API gizli anahtarı eksik.")

    status = request_json(STATUS_URL, internal_secret=internal_secret)
    connection = status.get("connection") or {}
    connection_id = connection.get("id")
    if not status.get("connected") or not connection_id:
        raise RuntimeError(
            "Önce başka bir hesaptan destek hesabına yeni mesaj gönderin; "
            "Business bağlantı kimliği henüz oluşmadı."
        )

    print("\nRelayDesk · Tek Kullanımlık Geçmiş Senkronizasyonu")
    print("Oturum dosyası oluşturulmaz; mesaj içerikleri terminale yazdırılmaz.")
    print("Varsayılan: en son 100 sohbet ve sohbet başına son 100 mesaj.\n")

    dialog_limit = ask_limit("Kaç sohbet içe aktarılsın", 100, 500)
    message_limit = ask_limit("Sohbet başına kaç son mesaj alınsın", 100, 1000)
    api_id = ask_api_id()
    api_hash = ask_api_hash()
    phone = ask_phone()

    client = TelegramClient(
        MemorySession(),
        api_id,
        api_hash,
        device_model="RelayDesk History Sync",
        app_version="1.0",
        lang_code="tr",
        system_lang_code="tr",
        receive_updates=False,
        flood_sleep_threshold=60,
    )

    imported = 0
    private_dialogs = 0
    group_dialogs = 0
    accepted_dialogs = 0
    try:
        await client.connect()
        await authorize(client, phone)
        account = await client.get_me()
        write_status("authorized")
        print(f"\nGiriş yapılan hesap: {utils.get_display_name(account)}")
        answer = input("Bu hesap doğru mu? [E/h]: ").strip().lower()
        if answer not in {"", "e", "evet", "y", "yes"}:
            write_status("cancelled")
            print("İşlem iptal edildi.")
            return 2

        print("Geçmiş okunuyor ve RelayDesk'e aktarılıyor...")
        async for dialog in client.iter_dialogs(ignore_migrated=True):
            chat_info = chat_from_entity(dialog.entity)
            if chat_info is None:
                continue
            if accepted_dialogs >= dialog_limit:
                break

            source, chat = chat_info
            accepted_dialogs += 1
            if source == "business":
                private_dialogs += 1
            else:
                group_dialogs += 1

            topic_names = await forum_topics(client, dialog.entity)
            message_entries: list[tuple[Any, int | None, str | None]] = []
            if topic_names:
                seen_messages: set[tuple[int, int]] = set()
                for current_topic_id, current_topic_title in topic_names.items():
                    try:
                        topic_messages = [
                            message
                            async for message in client.iter_messages(
                                dialog.entity,
                                limit=message_limit,
                                reply_to=current_topic_id,
                            )
                        ]
                    except errors.RPCError:
                        topic_messages = []
                    for message in topic_messages:
                        key = (current_topic_id, int(message.id))
                        if key in seen_messages:
                            continue
                        seen_messages.add(key)
                        message_entries.append(
                            (message, current_topic_id, current_topic_title)
                        )
            else:
                message_entries = [
                    (message, None, None)
                    async for message in client.iter_messages(
                        dialog.entity,
                        limit=message_limit,
                    )
                ]

            message_entries.sort(key=lambda entry: entry[0].date)
            batch: list[dict[str, Any]] = []
            dialog_imported = 0
            for message, current_topic_id, current_topic_title in message_entries:
                item = await message_payload(
                    message,
                    source=source,
                    chat=chat,
                    connection_id=connection_id,
                    account=account,
                    topic_id=current_topic_id,
                    topic_title=current_topic_title,
                )
                if item is None:
                    continue
                batch.append(item)
                if len(batch) >= BATCH_SIZE:
                    count = post_batch(batch, internal_secret)
                    imported += count
                    dialog_imported += count
                    batch.clear()

            count = post_batch(batch, internal_secret)
            imported += count
            dialog_imported += count
            write_status(
                "importing",
                dialogs=accepted_dialogs,
                private_dialogs=private_dialogs,
                group_dialogs=group_dialogs,
                messages=imported,
            )
            print(f"  Sohbet {accepted_dialogs}/{dialog_limit}: {dialog_imported} mesaj")

        write_status(
            "completed",
            dialogs=accepted_dialogs,
            private_dialogs=private_dialogs,
            group_dialogs=group_dialogs,
            messages=imported,
        )
        print("\n✓ Geçmiş senkronizasyonu tamamlandı.")
        print(f"✓ {private_dialogs} özel sohbet, {group_dialogs} grup işlendi.")
        print(f"✓ {imported} mesaj RelayDesk'e aktarıldı veya güncellendi.")
        print("Not: Gruplarda yeni mesajları almak ve yanıtlamak için botu gruba ekleyin.")
        return 0
    except errors.PhoneCodeInvalidError:
        write_status("failed", error="PhoneCodeInvalidError")
        print("Giriş kodu geçersiz.")
        return 4
    except errors.PasswordHashInvalidError:
        write_status("failed", error="PasswordHashInvalidError")
        print("İki aşamalı doğrulama parolası geçersiz.")
        return 4
    except errors.RPCError as error:
        write_status("failed", error=error.__class__.__name__)
        print(f"Telegram işlemi reddetti: {error.__class__.__name__}: {error}")
        return 5
    finally:
        if client.is_connected():
            if await client.is_user_authorized():
                try:
                    await client.log_out()
                    print("✓ Tek kullanımlık kullanıcı oturumu kapatıldı.")
                except Exception:
                    await client.disconnect()
            else:
                await client.disconnect()


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(sync_history()))
    except KeyboardInterrupt:
        write_status("cancelled")
        print("\nİşlem kullanıcı tarafından iptal edildi.")
        raise SystemExit(130)
    except (RuntimeError, OSError, ConnectionError) as error:
        write_status("failed", error=error.__class__.__name__, detail=str(error)[:500])
        print(f"\nHata: {error}", file=sys.stderr)
        raise SystemExit(1)
    except Exception as error:
        write_status("failed", error=error.__class__.__name__, detail=str(error)[:500])
        print(f"\nBeklenmeyen hata: {error.__class__.__name__}: {error}", file=sys.stderr)
        raise SystemExit(1)
