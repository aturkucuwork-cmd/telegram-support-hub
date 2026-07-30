"""One-time interactive authorization for the local Telegram user listener."""

from __future__ import annotations

import asyncio
import getpass
import re
from datetime import datetime, timezone

import truststore
from telethon import TelegramClient, errors
from telethon.sessions import StringSession

from telegram_user_session import save_session


truststore.inject_into_ssl()


def ask_api_id() -> int:
    while True:
        value = input("App api_id: ").strip()
        if value.isdigit() and int(value) > 0:
            return int(value)
        print("api_id yalnızca rakamlardan oluşmalıdır.")


def ask_api_hash() -> str:
    while True:
        value = getpass.getpass("App api_hash (gizli): ").strip()
        if re.fullmatch(r"[0-9a-fA-F]{32}", value):
            return value.lower()
        print("api_hash 32 karakterlik hexadecimal değer olmalıdır.")


def ask_phone() -> str:
    while True:
        value = input("Telegram telefon numarası (örn. +905...): ").strip().replace(" ", "")
        if re.fullmatch(r"\+[1-9][0-9]{7,14}", value):
            return value
        print("Numarayı ülke koduyla birlikte girin; örnek: +905xxxxxxxxx")


async def configure() -> None:
    print("\nRelayDesk · Telegram Kullanıcı Dinleyicisi")
    print("Bu işlem yalnızca bir kez yapılır.")
    print("Gizli bilgiler terminalde görünmez ve Windows hesabınıza bağlı şifrelenir.\n")

    api_id = ask_api_id()
    api_hash = ask_api_hash()
    phone = ask_phone()
    client = TelegramClient(
        StringSession(),
        api_id,
        api_hash,
        device_model="RelayDesk Local Listener",
        app_version="1.0",
        system_version="Windows",
    )

    try:
        await client.connect()
        await client.send_code_request(phone)
        code = input("Telegram uygulamasına gelen giriş kodu: ").strip().replace(" ", "")
        try:
            await client.sign_in(phone=phone, code=code)
        except errors.SessionPasswordNeededError:
            password = getpass.getpass("İki aşamalı doğrulama parolası (gizli): ")
            await client.sign_in(password=password)

        account = await client.get_me()
        if account is None:
            raise RuntimeError("Telegram hesabı doğrulanamadı.")
        display_name = " ".join(
            part for part in (account.first_name, account.last_name) if part
        ) or account.username or f"Telegram {account.id}"
        session_string = client.session.save()
        if not isinstance(session_string, str) or not session_string:
            raise RuntimeError("Telegram oturumu oluşturulamadı.")

        save_session(
            {
                "version": 1,
                "api_id": api_id,
                "api_hash": api_hash,
                "session": session_string,
                "telegram_user_id": str(account.id),
                "display_name": display_name,
                "username": account.username,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        print(f"\nBağlantı hazır: {display_name}")
        print("Oturum Windows DPAPI ile şifrelendi; Telegram'dan çıkış yapılmadı.")
    finally:
        await client.disconnect()


if __name__ == "__main__":
    try:
        asyncio.run(configure())
    except KeyboardInterrupt:
        raise SystemExit("\nKurulum iptal edildi.")
    except errors.RPCError as error:
        raise SystemExit(f"Telegram bağlantısı başarısız: {type(error).__name__}") from error
    except Exception as error:
        raise SystemExit(f"Kurulum başarısız: {error}") from error
