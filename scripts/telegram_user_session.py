"""Windows DPAPI storage for the persistent RelayDesk Telegram user session."""

from __future__ import annotations

import ctypes
import json
import os
from ctypes import wintypes
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SESSION_PATH = PROJECT_ROOT / ".telegram-user-session.dpapi"
FILE_HEADER = b"RELAYDESK-DPAPI-1\n"
ENTROPY = b"RelayDesk Telegram user session v1"
CRYPTPROTECT_UI_FORBIDDEN = 0x01


class DataBlob(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_ubyte)),
    ]


def _input_blob(data: bytes) -> tuple[DataBlob, Any]:
    buffer = ctypes.create_string_buffer(data)
    blob = DataBlob(
        len(data),
        ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)),
    )
    return blob, buffer


def _crypt(data: bytes, *, protect: bool) -> bytes:
    if os.name != "nt":
        raise RuntimeError("Telegram kullanıcı oturumu yalnızca Windows DPAPI ile açılabilir.")

    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    operation = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    operation.argtypes = [
        ctypes.POINTER(DataBlob),
        wintypes.LPCWSTR if protect else ctypes.POINTER(wintypes.LPWSTR),
        ctypes.POINTER(DataBlob),
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(DataBlob),
    ]
    operation.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p

    source, source_buffer = _input_blob(data)
    entropy, entropy_buffer = _input_blob(ENTROPY)
    output = DataBlob()
    description = None if protect else wintypes.LPWSTR()
    description_arg = None if protect else ctypes.byref(description)

    if not operation(
        ctypes.byref(source),
        "RelayDesk Telegram user session" if protect else description_arg,
        ctypes.byref(entropy),
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(output),
    ):
        raise ctypes.WinError(ctypes.get_last_error())

    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        del source_buffer, entropy_buffer
        if output.pbData:
            kernel32.LocalFree(ctypes.cast(output.pbData, ctypes.c_void_p))
        if not protect and description:
            kernel32.LocalFree(ctypes.cast(description, ctypes.c_void_p))


def protect(data: bytes) -> bytes:
    return _crypt(data, protect=True)


def unprotect(data: bytes) -> bytes:
    return _crypt(data, protect=False)


def save_session(bundle: dict[str, Any]) -> None:
    required = {"api_id", "api_hash", "session", "telegram_user_id", "display_name"}
    if not required.issubset(bundle):
        raise ValueError("Telegram oturum paketi eksik.")
    payload = json.dumps(bundle, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encrypted = FILE_HEADER + protect(payload)
    temporary = SESSION_PATH.with_suffix(".dpapi.tmp")
    temporary.write_bytes(encrypted)
    temporary.replace(SESSION_PATH)


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
        bundle = json.loads(unprotect(encrypted[len(FILE_HEADER) :]).decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError(
            "Telegram kullanıcı oturumu bu Windows hesabıyla açılamadı."
        ) from error
    if not isinstance(bundle, dict):
        raise RuntimeError("Telegram kullanıcı oturumu içeriği geçersiz.")
    return bundle


if __name__ == "__main__":
    probe = b"relaydesk-dpapi-roundtrip"
    if unprotect(protect(probe)) != probe:
        raise SystemExit("DPAPI doğrulaması başarısız.")
    print("DPAPI doğrulaması başarılı.")
