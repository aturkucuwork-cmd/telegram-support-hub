"""Connect a Secretary/Business bot once without persisting a user session."""

from __future__ import annotations

import asyncio
import getpass
import re
import sys

from telethon import TelegramClient, errors, utils
from telethon.sessions import MemorySession
from telethon.tl.functions.account import (
    GetConnectedBotsRequest,
    UpdateConnectedBotRequest,
)
from telethon.tl.types import BusinessBotRights, InputBusinessBotRecipients


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


def ask_bot_username() -> str:
    while True:
        value = input("Bağlanacak bot kullanıcı adı (@ olmadan da olur): ").strip().lstrip("@")
        if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{4,31}", value):
            return value
        print("Geçerli bir Telegram bot kullanıcı adı girin.")


async def authorize(client: TelegramClient, phone: str) -> None:
    await client.send_code_request(phone)
    code = input("Telegram uygulamasına gelen giriş kodu: ").strip().replace(" ", "")
    try:
        await client.sign_in(phone=phone, code=code)
    except errors.SessionPasswordNeededError:
        password = getpass.getpass("İki aşamalı doğrulama parolası (gizli): ")
        await client.sign_in(password=password)


async def connect_bot() -> int:
    print("\nRelayDesk · Tek Kullanımlık Telegram Bağlantısı")
    print("Bilgiler yalnızca bu terminalin belleğinde tutulur; oturum dosyası oluşturulmaz.\n")

    api_id = ask_api_id()
    api_hash = ask_api_hash()
    phone = ask_phone()
    bot_username = ask_bot_username()

    client = TelegramClient(
        MemorySession(),
        api_id,
        api_hash,
        device_model="RelayDesk One-Time Connector",
        app_version="1.0",
        lang_code="tr",
        system_lang_code="tr",
        receive_updates=False,
    )

    connected = False
    try:
        await client.connect()
        await authorize(client, phone)

        account = await client.get_me()
        print(f"\nGiriş yapılan hesap: {utils.get_display_name(account)}")
        answer = input("Bu hesap doğru mu? [E/h]: ").strip().lower()
        if answer not in {"", "e", "evet", "y", "yes"}:
            print("İşlem iptal edildi.")
            return 2

        bot = await client.get_entity(bot_username)
        if not getattr(bot, "bot", False):
            print("Belirtilen kullanıcı bir bot değil.")
            return 2
        if not getattr(bot, "bot_business", False):
            print("Bu botta Secretary/Business Mode etkin değil. BotFather ayarını kontrol edin.")
            return 2

        recipients = InputBusinessBotRecipients(
            existing_chats=True,
            new_chats=True,
            contacts=True,
            non_contacts=True,
            exclude_selected=False,
            users=[],
            exclude_users=[],
        )
        rights = BusinessBotRights(reply=True, read_messages=True)
        input_bot = utils.get_input_user(bot)

        current = await client(GetConnectedBotsRequest())
        other_bot_ids = [
            getattr(item, "bot_id", None)
            for item in getattr(current, "connected_bots", [])
            if getattr(item, "bot_id", None) != getattr(bot, "id", None)
        ]
        if other_bot_ids:
            replace = input(
                "Hesaba başka bir Business bot bağlı. Onu bu botla değiştirmek istiyor musunuz? [e/H]: "
            ).strip().lower()
            if replace not in {"e", "evet", "y", "yes"}:
                print("Mevcut bağlantı korunarak işlem iptal edildi.")
                return 2

        await client(
            UpdateConnectedBotRequest(
                bot=input_bot,
                recipients=recipients,
                rights=rights,
            )
        )

        result = await client(GetConnectedBotsRequest())
        bot_id = getattr(bot, "id", None)
        connected = any(
            getattr(item, "bot_id", None) == bot_id
            for item in getattr(result, "connected_bots", [])
        )
        if not connected:
            print("Telegram bağlantıyı doğrulamadı. Hesap veya özellik dağıtımı uygun olmayabilir.")
            return 3

        print(f"\n✓ @{bot_username} hesaba bağlandı.")
        print("✓ Mevcut ve yeni özel sohbetlere erişim ile yanıt yetkisi verildi.")
        return 0
    except errors.PhoneCodeInvalidError:
        print("Giriş kodu geçersiz.")
        return 4
    except errors.PasswordHashInvalidError:
        print("İki aşamalı doğrulama parolası geçersiz.")
        return 4
    except errors.RPCError as error:
        print(f"Telegram işlemi reddetti: {error.__class__.__name__}: {error}")
        return 5
    except (OSError, ConnectionError) as error:
        print(f"Telegram bağlantısı kurulamadı: {error}")
        return 6
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
        raise SystemExit(asyncio.run(connect_bot()))
    except KeyboardInterrupt:
        print("\nİşlem kullanıcı tarafından iptal edildi.")
        sys.exit(130)
