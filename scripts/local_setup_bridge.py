"""Local-only HTTP bridge used by the RelayDesk first-run setup wizard."""

from __future__ import annotations

import asyncio
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import traceback
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import truststore
from telethon import TelegramClient, errors, utils
from telethon.sessions import StringSession
from telethon.tl.functions.account import GetConnectedBotsRequest, UpdateConnectedBotRequest
from telethon.tl.types import BusinessBotRights, InputBusinessBotRecipients

from telegram_user_session import SESSION_PATH, load_session, save_session


truststore.inject_into_ssl()

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = PROJECT_ROOT / ".env.local"
STATE_PATH = PROJECT_ROOT / ".local-setup-state.json"
PYTHON_PATH = (
    PROJECT_ROOT
    / ".venv"
    / ("Scripts" if os.name == "nt" else "bin")
    / ("python.exe" if os.name == "nt" else "python")
)
USER_LISTENER_PATH = PROJECT_ROOT / "scripts" / "telegram_user_long_poll.py"
HOST = "127.0.0.1"
PORT = 8765
MAX_BODY_BYTES = 64 * 1024
MANAGED_SERVICES = (
    "relaydesk-web.service",
    "relaydesk-telegram-poller.service",
    "relaydesk-listener.service",
)


class SetupError(RuntimeError):
    def __init__(self, message: str, *, status: int = 400, code: str = "setup_error") -> None:
        super().__init__(message)
        self.status = status
        self.code = code


def load_env() -> dict[str, str]:
    values: dict[str, str] = {}
    if not ENV_PATH.exists():
        return values
    for raw_line in ENV_PATH.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        values[key] = value
        # telegram_user_session.py reads SESSION_ENCRYPTION_KEY (and any other
        # secret) straight from the real process environment. Under systemd
        # (EnvironmentFile=.env.local) that's already the case; for direct/
        # manual invocation of this bridge, mirror it here so both paths behave
        # the same. setdefault() keeps a real env var taking precedence.
        os.environ.setdefault(key, value)
    return values


def update_env(changes: dict[str, str]) -> None:
    lines = ENV_PATH.read_text(encoding="utf-8-sig").splitlines() if ENV_PATH.exists() else []
    remaining = dict(changes)
    updated: list[str] = []
    for raw_line in lines:
        if "=" not in raw_line or raw_line.lstrip().startswith("#"):
            updated.append(raw_line)
            continue
        key = raw_line.split("=", 1)[0].strip()
        if key in remaining:
            updated.append(f"{key}={remaining.pop(key)}")
        else:
            updated.append(raw_line)
    for key, value in remaining.items():
        updated.append(f"{key}={value}")
    temporary = ENV_PATH.with_suffix(".local.tmp")
    old_umask = os.umask(0o077)
    try:
        temporary.write_text("\n".join(updated).rstrip() + "\n", encoding="utf-8")
        os.chmod(temporary, 0o600)
        temporary.replace(ENV_PATH)
        os.chmod(ENV_PATH, 0o600)
    finally:
        os.umask(old_umask)


def restart_managed_services() -> None:
    if os.name == "nt":
        return
    try:
        for service in MANAGED_SERVICES:
            subprocess.run(
                ["sudo", "-n", "systemctl", "try-restart", service],
                check=True,
                capture_output=True,
                text=True,
                timeout=20,
            )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        raise SetupError(
            "Ayarlar kaydedildi ancak RelayDesk servisleri yeniden başlatılamadı. "
            "Provision adımındaki relaydesk sudo kuralını kontrol edin.",
            status=503,
            code="service_restart_failed",
        ) from error
    temporary.replace(ENV_PATH)


def load_state() -> dict[str, Any]:
    try:
        value = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def update_state(changes: dict[str, Any]) -> None:
    value = {**load_state(), **changes}
    temporary = STATE_PATH.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary.replace(STATE_PATH)


def telegram_bot_api(token: str, method: str, payload: dict[str, Any] | None = None) -> Any:
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(payload or {}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        try:
            result = json.loads(error.read().decode("utf-8"))
            detail = result.get("description", f"HTTP {error.code}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            detail = f"HTTP {error.code}"
        raise SetupError(f"Telegram bot anahtarını reddetti: {detail}") from error
    except (urllib.error.URLError, OSError) as error:
        raise SetupError("Telegram'a ulaşılamadı. İnternet bağlantısını kontrol edin.") from error
    if not result.get("ok"):
        raise SetupError(result.get("description") or "Telegram Bot API isteği başarısız.")
    return result.get("result")


def configure_bot(token: str) -> dict[str, Any]:
    token = token.strip()
    if not re.fullmatch(r"\d{5,20}:[A-Za-z0-9_-]{20,}", token):
        raise SetupError("BotFather token biçimi geçersiz.")
    bot = telegram_bot_api(token, "getMe")
    if not isinstance(bot, dict) or not bot.get("username"):
        raise SetupError("Telegram bot bilgisi doğrulanamadı.")
    telegram_bot_api(token, "deleteWebhook", {"drop_pending_updates": False})
    env = load_env()
    webhook_secret = env.get("TELEGRAM_WEBHOOK_SECRET") or secrets.token_hex(32)
    internal_secret = env.get("INTERNAL_API_SECRET") or secrets.token_urlsafe(32)
    update_env(
        {
            "TELEGRAM_BOT_TOKEN": token,
            "TELEGRAM_WEBHOOK_SECRET": webhook_secret,
            "INTERNAL_API_SECRET": internal_secret,
        }
    )
    restart_managed_services()
    update_state(
        {
            "bot_username": bot["username"],
            "bot_id": str(bot.get("id", "")),
            "bot_configured_at": datetime.now(timezone.utc).isoformat(),
            "business_connected": False,
        }
    )
    return {
        "configured": True,
        "username": bot["username"],
        "canJoinGroups": bool(bot.get("can_join_groups")),
        "groupPrivacyDisabled": bool(bot.get("can_read_all_group_messages")),
    }


def start_user_listener() -> None:
    if not SESSION_PATH.exists():
        raise SetupError("Önce Telegram kullanıcı hesabını bağlayın.", status=409)
    if os.name == "nt":
        # No systemd on a Windows dev/test machine: launch the listener
        # directly instead, same as before the Linux/systemd migration.
        if not PYTHON_PATH.exists():
            raise SetupError("RelayDesk Python ortamı bulunamadı.", status=503)
        subprocess.Popen(
            [str(PYTHON_PATH), "-u", str(USER_LISTENER_PATH)],
            cwd=str(PROJECT_ROOT),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
        )
        return
    try:
        subprocess.run(
            ["sudo", "-n", "systemctl", "start", "relaydesk-listener.service"],
            check=True, capture_output=True, text=True, timeout=15,
        )
    except (subprocess.CalledProcessError, FileNotFoundError) as error:
        raise SetupError(
            "Dinleyici servisi başlatılamadı. relaydesk-listener.service kurulu mu kontrol edin.",
        ) from error


class TelegramSetupState:
    def __init__(self) -> None:
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        self.client: TelegramClient | None = None
        self.api_id: int | None = None
        self.api_hash: str | None = None
        self.phone: str | None = None
        self.awaiting_password = False

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self.loop)
        self.loop.run_forever()

    def run(self, coroutine: Any, timeout: int = 60) -> Any:
        future = asyncio.run_coroutine_threadsafe(coroutine, self.loop)
        try:
            return future.result(timeout=timeout)
        except TimeoutError as error:
            future.cancel()
            raise SetupError("Telegram işlemi zaman aşımına uğradı. Tekrar deneyin.") from error

    async def _disconnect_pending(self) -> None:
        if self.client is not None and self.client.is_connected():
            await self.client.disconnect()
        self.client = None
        self.api_id = None
        self.api_hash = None
        self.phone = None
        self.awaiting_password = False

    async def begin(self, api_id: int, api_hash: str, phone: str) -> dict[str, Any]:
        await self._disconnect_pending()
        self.api_id = api_id
        self.api_hash = api_hash
        self.phone = phone
        self.client = TelegramClient(
            StringSession(),
            api_id,
            api_hash,
            device_model="RelayDesk Setup Wizard",
            app_version="1.0",
            system_version="Linux" if os.name != "nt" else "Windows",
            receive_updates=False,
        )
        try:
            await self.client.connect()
            await self.client.send_code_request(phone)
        except Exception:
            await self._disconnect_pending()
            raise
        return {"phase": "code", "message": "Giriş kodu Telegram uygulamanıza gönderildi."}

    async def submit_code(self, code: str) -> dict[str, Any]:
        if self.client is None or self.phone is None:
            raise SetupError("Önce telefon numarasına giriş kodu gönderin.", status=409)
        try:
            await self.client.sign_in(phone=self.phone, code=code)
        except errors.SessionPasswordNeededError:
            self.awaiting_password = True
            return {"phase": "password", "message": "İki aşamalı doğrulama parolası gerekli."}
        return await self._finalize()

    async def submit_password(self, password: str) -> dict[str, Any]:
        if self.client is None or not self.awaiting_password:
            raise SetupError("İki aşamalı doğrulama adımı beklenmiyor.", status=409)
        await self.client.sign_in(password=password)
        return await self._finalize()

    async def _finalize(self) -> dict[str, Any]:
        if self.client is None or self.api_id is None or self.api_hash is None:
            raise SetupError("Telegram oturum adımı eksik.", status=409)
        account = await self.client.get_me()
        if account is None:
            raise SetupError("Telegram hesabı doğrulanamadı.")
        display_name = " ".join(
            part for part in (account.first_name, account.last_name) if part
        ) or account.username or f"Telegram {account.id}"
        session_string = self.client.session.save()
        if not isinstance(session_string, str) or not session_string:
            raise SetupError("Telegram oturumu oluşturulamadı.")
        save_session(
            {
                "version": 1,
                "api_id": self.api_id,
                "api_hash": self.api_hash,
                "session": session_string,
                "telegram_user_id": str(account.id),
                "display_name": display_name,
                "username": account.username,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        result = {
            "phase": "complete",
            "account": {
                "displayName": display_name,
                "username": account.username,
            },
        }
        await self._disconnect_pending()
        start_user_listener()
        return result

    async def business_status(self) -> dict[str, Any]:
        env = load_env()
        token = env.get("TELEGRAM_BOT_TOKEN", "")
        if not token or not SESSION_PATH.exists():
            return {"connected": False, "username": None}
        bot_info = telegram_bot_api(token, "getMe")
        username = str(bot_info.get("username") or "")
        if not username:
            return {"connected": False, "username": None}
        bundle = load_session()
        client = TelegramClient(
            StringSession(str(bundle["session"])),
            int(bundle["api_id"]),
            str(bundle["api_hash"]),
            device_model="RelayDesk Setup Wizard",
            app_version="1.0",
            system_version="Linux" if os.name != "nt" else "Windows",
            receive_updates=False,
        )
        try:
            await client.connect()
            if not await client.is_user_authorized():
                raise SetupError("Telegram kullanıcı oturumunun yetkisi sona ermiş.", status=409)
            bot = await client.get_entity(username)
            current = await client(GetConnectedBotsRequest())
            connected = any(
                getattr(item, "bot_id", None) == getattr(bot, "id", None)
                for item in getattr(current, "connected_bots", [])
            )
            update_state({"business_connected": connected, "bot_username": username})
            return {"connected": connected, "username": username}
        finally:
            await client.disconnect()

    async def connect_business(self, replace: bool) -> dict[str, Any]:
        env = load_env()
        token = env.get("TELEGRAM_BOT_TOKEN", "")
        if not token:
            raise SetupError("Önce BotFather token'ını kaydedin.", status=409)
        if not SESSION_PATH.exists():
            raise SetupError("Önce Telegram kullanıcı hesabını bağlayın.", status=409)
        bot_info = telegram_bot_api(token, "getMe")
        username = str(bot_info.get("username") or "")
        bundle = load_session()
        client = TelegramClient(
            StringSession(str(bundle["session"])),
            int(bundle["api_id"]),
            str(bundle["api_hash"]),
            device_model="RelayDesk Setup Wizard",
            app_version="1.0",
            system_version="Linux" if os.name != "nt" else "Windows",
            receive_updates=False,
        )
        try:
            await client.connect()
            if not await client.is_user_authorized():
                raise SetupError("Telegram kullanıcı oturumunun yetkisi sona ermiş.", status=409)
            bot = await client.get_entity(username)
            if not getattr(bot, "bot", False):
                raise SetupError("BotFather token'ı bir bot hesabına ait değil.")
            if not getattr(bot, "bot_business", False):
                raise SetupError(
                    "BotFather'da bu bot için Business Mode açık değil. Business Mode'u açıp tekrar deneyin.",
                    status=409,
                    code="business_mode_required",
                )
            current = await client(GetConnectedBotsRequest())
            other_bot_ids = [
                getattr(item, "bot_id", None)
                for item in getattr(current, "connected_bots", [])
                if getattr(item, "bot_id", None) != getattr(bot, "id", None)
            ]
            if other_bot_ids and not replace:
                raise SetupError(
                    "Hesaba başka bir Business bot bağlı. Değiştirmek için onay verin.",
                    status=409,
                    code="replace_required",
                )
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
            await client(
                UpdateConnectedBotRequest(
                    bot=utils.get_input_user(bot),
                    recipients=recipients,
                    rights=rights,
                )
            )
            result = await client(GetConnectedBotsRequest())
            connected = any(
                getattr(item, "bot_id", None) == getattr(bot, "id", None)
                for item in getattr(result, "connected_bots", [])
            )
            if not connected:
                raise SetupError("Telegram Business bot bağlantısını doğrulamadı.")
            update_state(
                {
                    "business_connected": True,
                    "bot_username": username,
                    "business_connected_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            return {"connected": True, "username": username}
        finally:
            await client.disconnect()


telegram_state = TelegramSetupState()


def public_status() -> dict[str, Any]:
    env = load_env()
    state = load_state()
    account: dict[str, Any] | None = None
    if SESSION_PATH.exists():
        try:
            bundle = load_session()
            account = {
                "displayName": bundle.get("display_name"),
                "username": bundle.get("username"),
            }
        except RuntimeError:
            account = None
    bot_configured = bool(
        env.get("TELEGRAM_BOT_TOKEN") and env.get("TELEGRAM_WEBHOOK_SECRET")
    )
    business_connected = bool(state.get("business_connected"))
    bot_username = state.get("bot_username") if bot_configured else None
    if bot_configured and account is not None:
        try:
            business = telegram_state.run(telegram_state.business_status())
            business_connected = bool(business.get("connected"))
            bot_username = business.get("username") or bot_username
        except Exception:
            pass
    return {
        "available": True,
        "botConfigured": bot_configured,
        "botUsername": bot_username,
        "userSessionConfigured": account is not None,
        "telegramAccount": account,
        "businessConnected": business_connected,
    }


def friendly_telegram_error(error: Exception) -> SetupError:
    if isinstance(error, SetupError):
        return error
    if isinstance(error, errors.ApiIdInvalidError):
        return SetupError("api_id veya api_hash geçersiz.")
    if isinstance(error, errors.PhoneNumberInvalidError):
        return SetupError("Telefon numarası geçersiz. Ülke koduyla yazın.")
    if isinstance(error, errors.PhoneCodeInvalidError):
        return SetupError("Telegram giriş kodu geçersiz.")
    if isinstance(error, errors.PhoneCodeExpiredError):
        return SetupError("Telegram giriş kodunun süresi doldu. Yeni kod gönderin.")
    if isinstance(error, errors.PasswordHashInvalidError):
        return SetupError("İki aşamalı doğrulama parolası geçersiz.")
    if isinstance(error, errors.FloodWaitError):
        return SetupError(
            f"Telegram çok fazla deneme algıladı. {error.seconds} saniye sonra tekrar deneyin.",
            status=429,
        )
    if isinstance(error, errors.RPCError):
        return SetupError(f"Telegram işlemi reddetti: {type(error).__name__}")
    return SetupError("Beklenmeyen bir yerel kurulum hatası oluştu.", status=500)


class SetupHandler(BaseHTTPRequestHandler):
    server_version = "RelayDeskSetup/1.0"

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def _origin(self) -> str | None:
        origin = self.headers.get("Origin")
        if not origin:
            return None
        try:
            parsed = urlparse(origin)
            port = parsed.port
        except ValueError:
            return None
        if parsed.scheme != "http" or port != 3000:
            return None
        hostname = parsed.hostname or ""
        is_private = (
            hostname in {"localhost", "127.0.0.1"}
            or hostname.startswith("192.168.")
            or hostname.startswith("10.")
            or any(hostname.startswith(f"172.{number}.") for number in range(16, 32))
        )
        return origin if is_private else None

    def _cors_headers(self) -> dict[str, str]:
        origin = self._origin()
        return {
            **({"Access-Control-Allow-Origin": origin} if origin else {}),
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Cache-Control": "no-store",
            "Vary": "Origin",
        }

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        for key, value in self._cors_headers().items():
            self.send_header(key, value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authorized(self) -> bool:
        expected = load_env().get("LOCAL_SETUP_TOKEN", "")
        provided = self.headers.get("Authorization", "")
        return bool(expected) and secrets.compare_digest(provided, f"Bearer {expected}")

    def _body(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise SetupError("Geçersiz istek uzunluğu.") from error
        if length < 0 or length > MAX_BODY_BYTES:
            raise SetupError("Kurulum isteği çok büyük.", status=413)
        try:
            value = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise SetupError("Geçersiz JSON gövdesi.") from error
        if not isinstance(value, dict):
            raise SetupError("Kurulum verisi nesne olmalıdır.")
        return value

    def do_OPTIONS(self) -> None:
        if self._origin() is None:
            self._json(403, {"error": "Geçersiz istek kaynağı."})
            return
        self._json(204, {})

    def do_GET(self) -> None:
        if not self._authorized():
            self._json(401, {"error": "Geçersiz yerel kurulum anahtarı."})
            return
        try:
            path = urlparse(self.path).path
            if path == "/status":
                self._json(200, public_status())
                return
            if path == "/business/status":
                self._json(200, telegram_state.run(telegram_state.business_status()))
                return
            raise SetupError("Kurulum yolu bulunamadı.", status=404)
        except Exception as error:
            if not isinstance(error, SetupError):
                traceback.print_exc(file=sys.stderr)
            friendly = friendly_telegram_error(error)
            self._json(friendly.status, {"error": str(friendly), "code": friendly.code})

    def do_POST(self) -> None:
        if not self._authorized():
            self._json(401, {"error": "Geçersiz yerel kurulum anahtarı."})
            return
        try:
            path = urlparse(self.path).path
            body = self._body()
            if path == "/bot-config":
                self._json(200, configure_bot(str(body.get("token", ""))))
                return
            if path == "/telegram/start":
                raw_api_id = str(body.get("apiId", "")).strip()
                api_hash = str(body.get("apiHash", "")).strip()
                phone = str(body.get("phone", "")).replace(" ", "")
                if not raw_api_id.isdigit() or int(raw_api_id) <= 0:
                    raise SetupError("api_id yalnızca rakamlardan oluşmalıdır.")
                if not re.fullmatch(r"[0-9a-fA-F]{32}", api_hash):
                    raise SetupError("api_hash 32 karakterlik hexadecimal değer olmalıdır.")
                if not re.fullmatch(r"\+[1-9][0-9]{7,14}", phone):
                    raise SetupError("Telefon numarasını ülke koduyla yazın.")
                result = telegram_state.run(
                    telegram_state.begin(int(raw_api_id), api_hash.lower(), phone)
                )
                self._json(200, result)
                return
            if path == "/telegram/code":
                code = re.sub(r"\s+", "", str(body.get("code", "")))
                if not re.fullmatch(r"[0-9]{4,8}", code):
                    raise SetupError("Telegram giriş kodunu eksiksiz girin.")
                self._json(200, telegram_state.run(telegram_state.submit_code(code)))
                return
            if path == "/telegram/password":
                password = str(body.get("password", ""))
                if not password:
                    raise SetupError("İki aşamalı doğrulama parolasını girin.")
                self._json(200, telegram_state.run(telegram_state.submit_password(password)))
                return
            if path == "/business/connect":
                replace = body.get("replace") is True
                self._json(200, telegram_state.run(telegram_state.connect_business(replace)))
                return
            if path == "/listener/start":
                start_user_listener()
                self._json(200, {"started": True})
                return
            raise SetupError("Kurulum yolu bulunamadı.", status=404)
        except Exception as error:
            if not isinstance(error, SetupError):
                traceback.print_exc(file=sys.stderr)
            friendly = friendly_telegram_error(error)
            self._json(friendly.status, {"error": str(friendly), "code": friendly.code})


if __name__ == "__main__":
    if not load_env().get("LOCAL_SETUP_TOKEN"):
        raise SystemExit("LOCAL_SETUP_TOKEN eksik.")
    server = ThreadingHTTPServer((HOST, PORT), SetupHandler)
    print(f"RelayDesk yerel kurulum köprüsü: http://{HOST}:{PORT}")
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
