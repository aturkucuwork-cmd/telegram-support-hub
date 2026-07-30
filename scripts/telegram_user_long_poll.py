"""Persistent MTProto listener for groups and channels followed by one user account."""

from __future__ import annotations

import asyncio
import ctypes
import datetime
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import truststore
from telethon import TelegramClient, errors, events, types, utils
from telethon.sessions import StringSession
from telethon.tl.functions.messages import GetDialogFiltersRequest, GetForumTopicsRequest

from telegram_user_session import load_session


truststore.inject_into_ssl()

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = PROJECT_ROOT / ".env.local"
IMPORT_URL = "http://localhost:3000/api/telegram/import"
HEARTBEAT_URL = "http://localhost:3000/api/telegram/user-listener"
FOLDERS_URL = "http://localhost:3000/api/telegram/folders"
RETRY_MAX_SECONDS = 30
INITIAL_MESSAGE_LIMIT = 100
FOLDER_SYNC_SECONDS = 30
MUTEX_NAME = "Local\\RelayDeskTelegramUserListener"


def load_env() -> dict[str, str]:
    values: dict[str, str] = {}
    if not ENV_PATH.exists():
        raise RuntimeError(".env.local bulunamadı.")
    for raw_line in ENV_PATH.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def request_json(
    url: str,
    secret: str,
    *,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    headers = {
        "Accept": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": secret,
    }
    data = None
    method = "GET"
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
        method = "POST"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read().decode("utf-8"))
            detail = body.get("error", f"HTTP {error.code}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            detail = f"HTTP {error.code}"
        raise RuntimeError(f"RelayDesk isteği başarısız: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError("RelayDesk yerel sunucusuna ulaşılamadı.") from error


def acquire_single_instance() -> Any:
    if sys.platform != "win32":
        return object()
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
    kernel32.CreateMutexW.restype = ctypes.c_void_p
    handle = kernel32.CreateMutexW(None, False, MUTEX_NAME)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    if ctypes.get_last_error() == 183:
        raise RuntimeError("Telegram kullanıcı dinleyicisi zaten çalışıyor.")
    return handle


def chat_payload(entity: Any) -> dict[str, Any] | None:
    if isinstance(entity, types.Chat):
        return {
            "id": utils.get_peer_id(entity),
            "type": "group",
            "title": entity.title or "Telegram grubu",
        }
    if isinstance(entity, types.Channel):
        return {
            "id": utils.get_peer_id(entity),
            "type": "supergroup" if getattr(entity, "megagroup", False) else "channel",
            "title": entity.title or (
                "Telegram grubu" if getattr(entity, "megagroup", False) else "Telegram kanalı"
            ),
            "username": entity.username,
        }
    return None


def folder_peer_payload(entity: Any) -> dict[str, Any] | None:
    chat = chat_payload(entity)
    if chat is not None:
        return {
            "id": str(chat["id"]),
            "type": str(chat["type"]),
            "title": str(chat["title"]),
            **({"username": chat["username"]} if chat.get("username") else {}),
        }
    if isinstance(entity, types.User):
        title = " ".join(
            part
            for part in [entity.first_name, entity.last_name]
            if isinstance(part, str) and part.strip()
        ).strip()
        return {
            "id": str(entity.id),
            "type": "private",
            "title": title or entity.username or "Telegram sohbeti",
            **({"username": entity.username} if entity.username else {}),
        }
    return None


def peer_id(value: Any) -> int | None:
    try:
        return int(utils.get_peer_id(value))
    except (TypeError, ValueError):
        return None


def dialog_is_muted(dialog: Any) -> bool:
    notify_settings = getattr(getattr(dialog, "dialog", None), "notify_settings", None)
    mute_until = getattr(notify_settings, "mute_until", None)
    if isinstance(mute_until, datetime.datetime):
        current = datetime.datetime.now(datetime.timezone.utc)
        if mute_until.tzinfo is None:
            mute_until = mute_until.replace(tzinfo=datetime.timezone.utc)
        return mute_until > current
    if isinstance(mute_until, (int, float)):
        return mute_until > time.time()
    return False


def dialog_matches_filter(dialog: Any, dialog_filter: Any) -> bool:
    entity = dialog.entity
    matches = False
    if isinstance(entity, types.User):
        if getattr(entity, "bot", False):
            matches = bool(getattr(dialog_filter, "bots", False))
        elif getattr(entity, "contact", False):
            matches = bool(getattr(dialog_filter, "contacts", False))
        else:
            matches = bool(getattr(dialog_filter, "non_contacts", False))
    elif isinstance(entity, types.Chat):
        matches = bool(getattr(dialog_filter, "groups", False))
    elif isinstance(entity, types.Channel):
        matches = bool(
            getattr(dialog_filter, "groups", False)
            if getattr(entity, "megagroup", False)
            else getattr(dialog_filter, "broadcasts", False)
        )
    if not matches:
        return False
    if getattr(dialog_filter, "exclude_archived", False) and getattr(dialog, "archived", False):
        return False
    if getattr(dialog_filter, "exclude_read", False) and not getattr(dialog, "unread_count", 0):
        return False
    if getattr(dialog_filter, "exclude_muted", False) and dialog_is_muted(dialog):
        return False
    return True


async def build_folder_snapshot(client: TelegramClient) -> list[dict[str, Any]]:
    dialogs = [dialog async for dialog in client.iter_dialogs()]
    entities = {
        entity_id: dialog.entity
        for dialog in dialogs
        if (entity_id := peer_id(dialog.entity)) is not None
    }
    result = await client(GetDialogFiltersRequest())
    dialog_filters = getattr(result, "filters", result)
    folders: list[dict[str, Any]] = []

    for dialog_filter in dialog_filters:
        if not isinstance(dialog_filter, (types.DialogFilter, types.DialogFilterChatlist)):
            continue
        telegram_folder_id = getattr(dialog_filter, "id", None)
        if not isinstance(telegram_folder_id, int) or telegram_folder_id <= 0:
            continue
        title_value = getattr(dialog_filter, "title", None)
        title = getattr(title_value, "text", None) or str(title_value or "Telegram klasörü")
        explicit_inputs = list(getattr(dialog_filter, "pinned_peers", []) or []) + list(
            getattr(dialog_filter, "include_peers", []) or []
        )
        member_ids = {
            value
            for item in explicit_inputs
            if (value := peer_id(item)) is not None
        }
        for dialog in dialogs:
            if dialog_matches_filter(dialog, dialog_filter):
                value = peer_id(dialog.entity)
                if value is not None:
                    member_ids.add(value)
        excluded_ids = {
            value
            for item in (getattr(dialog_filter, "exclude_peers", []) or [])
            if (value := peer_id(item)) is not None
        }
        member_ids.difference_update(excluded_ids)

        unresolved_inputs = {
            value: item
            for item in explicit_inputs
            if (value := peer_id(item)) is not None and value not in entities
        }
        for value, input_peer in unresolved_inputs.items():
            try:
                entities[value] = await client.get_entity(input_peer)
            except (errors.RPCError, TypeError, ValueError):
                continue

        peers = [
            payload
            for value in sorted(member_ids)
            if (payload := folder_peer_payload(entities.get(value))) is not None
        ]
        folders.append({
            "id": telegram_folder_id,
            "title": title.strip() or f"Telegram klasörü #{telegram_folder_id}",
            "peers": peers,
        })

    return folders


def sender_payload(sender: Any, account: Any, outgoing: bool) -> dict[str, Any]:
    entity = sender or (account if outgoing else None)
    first_name = (
        getattr(entity, "first_name", None)
        or getattr(entity, "title", None)
        or getattr(entity, "username", None)
        or "Bilinmeyen"
    )
    result = {
        "id": getattr(entity, "id", None),
        "first_name": first_name,
        "last_name": getattr(entity, "last_name", None),
        "username": getattr(entity, "username", None),
    }
    return {key: value for key, value in result.items() if value is not None}


def attachment_payload(message: Any) -> dict[str, Any]:
    file = getattr(message, "file", None)
    name = getattr(file, "name", None)
    mime_type = getattr(file, "mime_type", None)
    empty_file = {"file_id": ""}
    if getattr(message, "photo", None):
        return {"photo": [{"file_id": "", "width": 0, "height": 0}]}
    if getattr(message, "sticker", None):
        emoji = getattr(getattr(message, "document", None), "emoji", None)
        return {"sticker": {**empty_file, "emoji": emoji}}
    if getattr(message, "voice", None):
        return {"voice": {**empty_file, "mime_type": mime_type}}
    if getattr(message, "video_note", None):
        return {"video": {**empty_file, "file_name": name, "mime_type": mime_type}}
    if getattr(message, "gif", None):
        return {"animation": {**empty_file, "file_name": name, "mime_type": mime_type}}
    if getattr(message, "video", None):
        return {"video": {**empty_file, "file_name": name, "mime_type": mime_type}}
    if getattr(message, "audio", None):
        return {"audio": {**empty_file, "file_name": name, "mime_type": mime_type}}
    if getattr(message, "document", None):
        return {"document": {**empty_file, "file_name": name, "mime_type": mime_type}}
    geo = getattr(message, "geo", None)
    if geo is not None:
        return {"location": {"latitude": geo.lat, "longitude": geo.long}}
    contact = getattr(message, "contact", None)
    if contact is not None:
        return {
            "contact": {
                "first_name": getattr(contact, "first_name", None) or "Kişi",
                "last_name": getattr(contact, "last_name", None),
                "phone_number": getattr(contact, "phone_number", None) or "",
            }
        }
    poll = getattr(message, "poll", None)
    question = getattr(poll, "question", None)
    if question:
        return {"poll": {"question": question}}
    return {}


async def read_forum_topics(client: TelegramClient, entity: Any) -> dict[int, str]:
    if not isinstance(entity, types.Channel) or not getattr(entity, "forum", False):
        return {}
    try:
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
    except (errors.RPCError, ValueError):
        return {1: "Genel"}
    topics = {
        int(topic.id): str(topic.title)
        for topic in getattr(result, "topics", [])
        if getattr(topic, "id", None) is not None and getattr(topic, "title", None)
    }
    topics.setdefault(1, "Genel")
    return topics


def topic_details(message: Any, entity: Any, topics: dict[int, str]) -> tuple[int | None, str | None]:
    action = getattr(message, "action", None)
    if isinstance(action, types.MessageActionTopicCreate):
        topics[int(message.id)] = str(action.title)
        return int(message.id), str(action.title)
    if not isinstance(entity, types.Channel) or not getattr(entity, "forum", False):
        return None, None
    reply = getattr(message, "reply_to", None)
    topic_id = getattr(reply, "reply_to_top_id", None)
    if topic_id is None and getattr(reply, "forum_topic", False):
        topic_id = getattr(reply, "reply_to_msg_id", None)
    if not isinstance(topic_id, int):
        topic_id = 1
    return topic_id, topics.get(topic_id, "Genel" if topic_id == 1 else f"Konu #{topic_id}")


async def build_item(
    message: Any,
    entity: Any,
    account: Any,
    topics: dict[int, str],
    *,
    historical: bool,
    edited: bool = False,
) -> dict[str, Any] | None:
    chat = chat_payload(entity)
    if chat is None:
        return None
    action = getattr(message, "action", None)
    if action is not None and not isinstance(action, types.MessageActionTopicCreate):
        return None

    sender = getattr(message, "sender", None)
    if sender is None:
        try:
            sender = await message.get_sender()
        except (errors.RPCError, ValueError):
            sender = None
    text = (getattr(message, "raw_text", None) or "").strip()
    topic_id, topic_title = topic_details(message, entity, topics)
    telegram_message: dict[str, Any] = {
        "message_id": int(message.id),
        "date": int(message.date.timestamp()),
        "chat": {key: value for key, value in chat.items() if value is not None},
        "from": sender_payload(sender, account, bool(message.out)),
    }
    if isinstance(action, types.MessageActionTopicCreate):
        telegram_message["forum_topic_created"] = {"name": str(action.title)}
    elif text:
        telegram_message["caption" if getattr(message, "media", None) else "text"] = text
    telegram_message.update(attachment_payload(message))
    if not text and action is None and not attachment_payload(message):
        return None

    reply_to_id = getattr(message, "reply_to_msg_id", None)
    if isinstance(reply_to_id, int):
        telegram_message["reply_to_message"] = {"message_id": reply_to_id}
    if topic_id is not None:
        telegram_message["message_thread_id"] = topic_id
        telegram_message["is_topic_message"] = True
        telegram_message["relaydesk_topic_title"] = topic_title

    return {
        "source": "group",
        "outgoing": bool(message.out),
        "historical": historical,
        "edited": edited,
        "message": telegram_message,
    }


async def post_with_retry(items: list[dict[str, Any]], secret: str) -> None:
    delay = 1
    while True:
        try:
            await asyncio.to_thread(
                request_json,
                IMPORT_URL,
                secret,
                payload={"items": items},
            )
            return
        except RuntimeError as error:
            print(f"RelayDesk aktarımı bekliyor: {error} ({delay} sn)")
            await asyncio.sleep(delay)
            delay = min(delay * 2, RETRY_MAX_SECONDS)


async def run_listener() -> None:
    mutex = acquire_single_instance()
    del mutex  # Windows keeps the underlying handle valid for the process lifetime.
    env = load_env()
    secret = env.get("TELEGRAM_WEBHOOK_SECRET", "")
    if not secret:
        raise RuntimeError(".env.local içinde TELEGRAM_WEBHOOK_SECRET eksik.")
    bundle = load_session()
    client = TelegramClient(
        StringSession(str(bundle["session"])),
        int(bundle["api_id"]),
        str(bundle["api_hash"]),
        device_model="RelayDesk Local Listener",
        app_version="1.0",
        system_version="Windows",
    )
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=5000)
    topic_cache: dict[int, dict[int, str]] = {}

    async def queue_worker() -> None:
        while True:
            first = await queue.get()
            batch = [first]
            while len(batch) < 100:
                try:
                    batch.append(queue.get_nowait())
                except asyncio.QueueEmpty:
                    break
            await post_with_retry(batch, secret)
            for _ in batch:
                queue.task_done()

    async def heartbeat() -> None:
        payload = {
            "telegramUserId": str(bundle["telegram_user_id"]),
            "displayName": str(bundle["display_name"]),
            "username": bundle.get("username"),
        }
        while True:
            try:
                await asyncio.to_thread(
                    request_json,
                    HEARTBEAT_URL,
                    secret,
                    payload=payload,
                )
            except RuntimeError as error:
                print(f"Dinleyici durumu gönderilemedi: {error}")
            await asyncio.sleep(20)

    async def folder_sync() -> None:
        while True:
            try:
                folders = await build_folder_snapshot(client)
                result = await asyncio.to_thread(
                    request_json,
                    FOLDERS_URL,
                    secret,
                    payload={
                        "telegramUserId": str(bundle["telegram_user_id"]),
                        "folders": folders,
                    },
                )
                print(
                    "Telegram klasörleri senkron: "
                    f"{result.get('folderCount', len(folders))} klasör, "
                    f"{result.get('assignedConversationCount', 0)} otomatik atama."
                )
            except (errors.RPCError, RuntimeError, TypeError, ValueError) as error:
                print(f"Telegram klasörleri senkronlanamadı: {type(error).__name__}: {error}")
            await asyncio.sleep(FOLDER_SYNC_SECONDS)

    async def enqueue_message(event: Any, *, edited: bool) -> None:
        try:
            entity = await event.get_chat()
            chat = chat_payload(entity)
            if chat is None:
                return
            chat_id = int(chat["id"])
            if chat_id not in topic_cache:
                topic_cache[chat_id] = await read_forum_topics(client, entity)
            item = await build_item(
                event.message,
                entity,
                account,
                topic_cache[chat_id],
                historical=False,
                edited=edited,
            )
            if item is not None:
                await queue.put(item)
        except Exception as error:
            print(f"Telegram mesajı işlenemedi: {type(error).__name__}: {error}")

    async def on_new_message(event: Any) -> None:
        await enqueue_message(event, edited=False)

    async def on_edited_message(event: Any) -> None:
        await enqueue_message(event, edited=True)

    await client.connect()
    if not await client.is_user_authorized():
        raise RuntimeError("Telegram kullanıcı oturumunun yetkisi sona ermiş; kurulumu yeniden çalıştırın.")
    account = await client.get_me()
    if account is None or str(account.id) != str(bundle["telegram_user_id"]):
        raise RuntimeError("Şifreli oturum beklenen Telegram hesabıyla eşleşmiyor.")

    client.add_event_handler(on_new_message, events.NewMessage())
    client.add_event_handler(on_edited_message, events.MessageEdited())
    worker_task = asyncio.create_task(queue_worker())
    heartbeat_task = asyncio.create_task(heartbeat())
    folder_task = asyncio.create_task(folder_sync())

    try:
        print(f"Telegram grup akışı bağlı: {bundle['display_name']}")
        cursor_result = await asyncio.to_thread(request_json, IMPORT_URL, secret)
        cursors = {
            str(chat_id): int(message_id)
            for chat_id, message_id in (cursor_result.get("cursors") or {}).items()
        }
        imported = 0
        dialog_count = 0
        print("Kaçırılan grup ve kanal mesajları denetleniyor...")
        async for dialog in client.iter_dialogs():
            entity = dialog.entity
            chat = chat_payload(entity)
            if chat is None:
                continue
            dialog_count += 1
            chat_id = int(chat["id"])
            topics = await read_forum_topics(client, entity)
            topic_cache[chat_id] = topics
            cursor = cursors.get(str(chat_id))
            if cursor is None:
                recent = [
                    message
                    async for message in client.iter_messages(
                        entity,
                        limit=INITIAL_MESSAGE_LIMIT,
                    )
                ]
                message_stream = reversed(recent)
            else:
                message_stream = client.iter_messages(
                    entity,
                    min_id=cursor,
                    reverse=True,
                )

            batch: list[dict[str, Any]] = []
            if hasattr(message_stream, "__aiter__"):
                async for message in message_stream:
                    item = await build_item(
                        message,
                        entity,
                        account,
                        topics,
                        historical=True,
                    )
                    if item is not None:
                        batch.append(item)
                    if len(batch) == 100:
                        await post_with_retry(batch, secret)
                        imported += len(batch)
                        batch = []
            else:
                for message in message_stream:
                    item = await build_item(
                        message,
                        entity,
                        account,
                        topics,
                        historical=True,
                    )
                    if item is not None:
                        batch.append(item)
                    if len(batch) == 100:
                        await post_with_retry(batch, secret)
                        imported += len(batch)
                        batch = []
            if batch:
                await post_with_retry(batch, secret)
                imported += len(batch)
        print(f"Başlangıç taraması tamamlandı: {dialog_count} sohbet, {imported} mesaj.")
        print("Yeni grup ve kanal mesajları canlı dinleniyor. Bu pencereyi açık bırakın.")
        await client.run_until_disconnected()
    finally:
        worker_task.cancel()
        heartbeat_task.cancel()
        folder_task.cancel()
        await client.disconnect()


if __name__ == "__main__":
    try:
        asyncio.run(run_listener())
    except KeyboardInterrupt:
        print("\nTelegram kullanıcı dinleyicisi durduruldu.")
    except Exception as error:
        raise SystemExit(f"Telegram kullanıcı dinleyicisi başlatılamadı: {error}") from error
