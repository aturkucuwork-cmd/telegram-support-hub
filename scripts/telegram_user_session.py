"""Fernet-based storage for the persistent RelayDesk Telegram user session."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

PROJECT_ROOT = Path(__file__).resolve().parent.parent
configured_session_path = os.environ.get("RELAYDESK_SESSION_PATH", "").strip()
SESSION_PATH = Path(configured_session_path) if configured_session_path else PROJECT_ROOT / ".telegram-user-session.enc"
if not SESSION_PATH.is_absolute():
    SESSION_PATH = PROJECT_ROOT / SESSION_PATH
FILE_HEADER = b"RELAYDESK-FERNET-1\n"


def _key() -> bytes:
    raw = os.environ.get("SESSION_ENCRYPTION_KEY", "").strip()
    if not raw:
        raise RuntimeError(
            "SESSION_ENCRYPTION_KEY ortam değişkeni eksik. "
            "Üretmek için: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
    return raw.encode("utf-8")


def protect(data: bytes) -> bytes:
    return Fernet(_key()).encrypt(data)


def unprotect(data: bytes) -> bytes:
    try:
        return Fernet(_key()).decrypt(data)
    except InvalidToken as error:
        raise RuntimeError("Telegram kullanıcı oturumu SESSION_ENCRYPTION_KEY ile açılamadı.") from error


def save_session(bundle: dict[str, Any]) -> None:
    required = {"api_id", "api_hash", "session", "telegram_user_id", "display_name"}
    if not required.issubset(bundle):
        raise ValueError("Telegram oturum paketi eksik.")
    payload = json.dumps(bundle, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encrypted = FILE_HEADER + protect(payload)
    temporary = SESSION_PATH.with_suffix(".enc.tmp")
    temporary.write_bytes(encrypted)
    temporary.replace(SESSION_PATH)
    os.chmod(SESSION_PATH, 0o600)


def load_session() -> dict[str, Any]:
    try:
        encrypted = SESSION_PATH.read_bytes()
    except FileNotFoundError as error:
        raise RuntimeError(
            "Şifreli Telegram kullanıcı oturumu bulunamadı. Kurulum aracını çalıştırın."
        ) from error
    if not encrypted.startswith(FILE_HEADER):
        raise RuntimeError("Telegram kullanıcı oturumu dosya biçimi geçersiz.")
    try:
        bundle = json.loads(unprotect(encrypted[len(FILE_HEADER):]).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("Telegram kullanıcı oturumu içeriği bozuk.") from error
    if not isinstance(bundle, dict):
        raise RuntimeError("Telegram kullanıcı oturumu içeriği geçersiz.")
    return bundle


if __name__ == "__main__":
    probe = b"relaydesk-fernet-roundtrip"
    if unprotect(protect(probe)) != probe:
        raise SystemExit("Fernet doğrulaması başarısız.")
    print("Fernet doğrulaması başarılı.")
