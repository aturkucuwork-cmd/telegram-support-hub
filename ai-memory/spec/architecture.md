# Architecture — Linux self-host migration (Selim rolü, Barış tarafından dolduruldu)

Bu doküman, `ai-memory/brief.md`'deki isteğin mimari çözümüdür. Onaylı tam plan: `C:\Users\aturk\.claude\plans\projeyi-incele-ve-bana-smooth-orbit.md` — bu dosya o planın Mert'in (yazilim-muhendisi) doğrudan uygulayabileceği özetidir. **Mert bu mimariyi sorgulamadan uygular; sapma gerekirse build notes'a not düşer.**

## 1. Veritabanı katmanı: D1 → better-sqlite3

**`db/index.ts`** — şu anki hali:
```ts
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) { throw new Error(...); }
  return drizzle(env.DB, { schema });
}
```
Yeni hali:
```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

let sqlite: Database.Database | null = null;

function getSqlite() {
  if (!sqlite) {
    const path = process.env.DATABASE_PATH?.trim() || "./data/relaydesk.sqlite";
    sqlite = new Database(path);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
  }
  return sqlite;
}

export function getDb() {
  return drizzle(getSqlite(), { schema });
}

export function getRawDb() {
  return getSqlite();
}
```
`getRawDb()` eklenmesinin sebebi: `db/ensure.ts`'in ham `.exec()`/`.prepare()` çağrıları için doğrudan `better-sqlite3` handle'ına ihtiyacı var.

**`db/ensure.ts`** (277 satır) — D1'e özgü çağrılar plain better-sqlite3 API'sine çevrilir:
- `env.DB.batch([...])` → `for (const statement of statements) db.exec(statement);` (better-sqlite3'te `.exec()` çoklu-statement kabul eder).
- `env.DB.prepare(sql).all()` → `db.prepare(sql).all()` (dönüş şekli değişir: D1 `{results: T[]}` döndürür, better-sqlite3 doğrudan `T[]` döndürür — `columns.results.some(...)` gibi tüm erişimleri `columns.some(...)`'a güncelle).
- `env.DB.prepare(sql).run()` → `db.prepare(sql).run()` (aynı isim, farklı imza olabilir — dönüş değeri kullanılan yerlerde kontrol et).
- Dış imza korunur: `ensureSchema()` hâlâ `async function` olarak kalır (içeride senkron çağrılar yapıp `Promise.resolve()` gibi sarılabilir) ki `app/api/**/route.ts` içindeki ~15 `await ensureSchema()` çağrı noktası **hiç değişmesin**.
- Modül-seviyesi "initialized" memoization deseni (varsa) aynen korunur.

**`drizzle.config.ts`**: değişmiyor. `dialect: "sqlite"` zaten hem D1 hem better-sqlite3 için ortak; mevcut `drizzle/0000..0005*.sql` migration dosyaları geçerli kalıyor, yeniden üretmeye gerek yok.

**`package.json`**: `dependencies`'e `better-sqlite3` eklenir. Native binding olduğu için sunucuda `npm ci`/`npm install` ile derlenmeli — Windows'tan `node_modules` kopyalanmamalı (bu bir dokümantasyon notu, kod değişikliği değil).

## 2. Build/runtime: Cloudflare Worker yolu kaldırılıyor

**Doğrulanmış gerçek** (node_modules/vinext/dist/cli.js:291-309 okunarak teyit edildi): `vinext start`, `worker/index.ts`'e hiç dokunmuyor. `./server/prod-server.js`'i import edip düz bir Node HTTP sunucusu başlatıyor (`PORT`/`HOST` env, `dist/` build çıktısını servis ediyor). **Yani ek bir Node sunucu wrapper'ı yazmaya gerek yok** — `npm run build && npm run start` zaten hedeflenen self-host komutları, `package.json`'daki mevcut scriptler değişmiyor.

Yapılacak değişiklikler:

**`vite.config.ts`** — şu anki hali `@cloudflare/vite-plugin`'i zorunlu kuruyor (`cloudflare({...})` plugin girişi), `.openai/hosting.json`'dan `d1`/`r2` okuyor (`localBindingConfig`). Yeni hali:
- `import hostingConfig from "./.openai/hosting.json"` satırını ve `const { d1, r2 } = hostingConfig` satırını kaldır.
- `localBindingConfig` objesini tamamen kaldır.
- `const { cloudflare } = await import("@cloudflare/vite-plugin")` satırını ve `plugins` listesindeki `cloudflare({...})` girişini kaldır.
- `plugins: [localMediaUpload(), vinext(), sites()]` olarak kalır — `sites()` plugin'i kaldırmak opsiyonel/bloklayıcı değil (bkz. aşağıdaki "opsiyonel temizlik").
- `WRANGLER_WRITE_LOGS`/`WRANGLER_LOG_PATH`/`MINIFLARE_REGISTRY_PATH` env atamalarını kaldır (artık anlamsız).
- `server: { host: "0.0.0.0", ... }` ve Codex seatbelt polling bloğu **aynen kalır** — Cloudflare ile ilgisi yok.

**`worker/index.ts`**: dosya tamamen silinir (Cloudflare Images `/_vinext/image` yolu dahil). Bu bir kabul edilen ödünleşim — self-host'ta görsel optimizasyon için bir karşılık eklenmiyor (admin destek paneli, görsel-ağırlıklı bir site değil). `next/image` lokal görseller için otomatik `<img>`+srcSet fallback'ine düşer.

**`cloudflare-env.d.ts`**: dosya tamamen silinir (`Cloudflare.Env.DB: D1Database` artık anlamsız).

**`package.json` devDependencies**: `wrangler`, `@cloudflare/vite-plugin`, `@cloudflare/workers-types` kaldırılır.

**Opsiyonel temizlik (bloklayıcı değil, yapılırsa iyi olur):** `.openai/hosting.json` ve `build/sites-vite-plugin.ts` Cloudflare/OpenAI-hosting'e özgü, artık amaçsız — kaldırılabilir ama zaman kısıtlıysa atlanabilir.

**Reverse proxy notu:** Eğer sunucu nginx/Caddy arkasında TLS sonlandırmayla çalışacaksa, `VINEXT_TRUST_PROXY=1` (veya `VINEXT_TRUSTED_HOSTS`) ortam değişkeni eklenmesi gerekiyor — yoksa `lib/auth.ts`'teki `Secure` cookie mantığı (`new URL(request.url).protocol === "https:"`) `X-Forwarded-Proto`'yu görmez. Bunu `.env.example`'a bir yorum satırı olarak ekle, zorunlu bir kod değişikliği değil.

## 3. Ortam değişkeni geçişi: `cloudflare:workers` → `process.env`

Üç dosyada aynı desen — `import { env } from "cloudflare:workers"` + `env[name]` okuyan yardımcı fonksiyon → doğrudan `process.env[name]`:

- **`lib/telegram.ts`**: dosya başındaki `cloudflare:workers` importunu kaldır, env okuyan yardımcıyı `process.env[name]` kullanacak şekilde değiştir.
- **`lib/auth.ts`**: `runtimeValue()` fonksiyonu → `function runtimeValue(name: string) { return process.env[name]; }`, importu kaldır.
- **`app/api/local-setup/route.ts`**: aynı desen, `runtimeValue()` → `process.env[name]`.

Başka hiçbir dosya `cloudflare:workers` import etmiyor (repo geneli arandı, doğrulandı).

## 4. Fernet şifreleme: `scripts/telegram_user_session.py`

Public API **birebir korunur** — `protect(data)`, `unprotect(data)`, `save_session(bundle)`, `load_session()`, `SESSION_PATH` sabiti. Bu sayede `telegram_user_long_poll.py`, `local_setup_bridge.py`, `configure_telegram_user_listener.py` dosyalarında **hiçbir değişiklik gerekmez**.

Yeni içerik:
```python
"""Fernet-based storage for the persistent RelayDesk Telegram user session."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SESSION_PATH = PROJECT_ROOT / ".telegram-user-session.enc"
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
```

**Önemli güvenlik notu (dokümantasyonda mutlaka belirtilecek):** DPAPI'nin "sadece bu Windows kullanıcısı çözebilir" garantisinin yerini artık "anahtarı bilen herkes çözebilir" (Fernet) alıyor — bu nedenle `chmod 600` artık dekoratif değil, gerçek güvenlik sınırı. `SESSION_ENCRYPTION_KEY`'in saklandığı env dosyası bir SSH private key gibi korunmalı (600 izin, systemd `EnvironmentFile=` ile beslenir, kabuk geçmişine/process listesine düşmemeli).

**Eski `.telegram-user-session.dpapi` dosyası**: göç scripti yazılmıyor — DPAPI zaten makine+kullanıcıya bağlı olduğu için Linux'ta işe yaramaz. Dosya adı `.enc`'e değiştiği için eski dosya sessizce görmezden gelinir; kullanıcı kurulum sihirbazından bir kez yeniden Telegram girişi yapar. Bunu dokümantasyonda not düş.

**`requirements-connect.txt`**: `cryptography` eklenir (güncel stabil sürüm, örn. `cryptography==43.0.0` veya üstü — telethon 1.44.0/truststore 0.10.4 ile uyumlu olduğundan emin ol).

## 5. Linux'a özgü düzeltmeler

**`scripts/telegram_user_long_poll.py`**:
- `acquire_single_instance()` (satır ~81-92): Windows mutex kodu tamamen kaldırılır (artık Windows'ta çalışmayacağız), yerine gerçek bir Linux kilidi:
```python
import fcntl

LOCK_PATH = PROJECT_ROOT / ".telegram-user-long-poll.lock"

def acquire_single_instance() -> Any:
    lock_file = open(LOCK_PATH, "w")
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as error:
        raise RuntimeError("Telegram kullanıcı dinleyicisi zaten çalışıyor.") from error
    return lock_file
```
Dönen `lock_file` referansı çağıran kodda canlı tutulmalı (kilidin düşmemesi için) — mevcut `handle` dönüş sözleşmesiyle aynı, çağıran kodda değişiklik gerekmez.
- Artık kullanılmayan `ctypes` importu (sadece Windows mutex için vardı) kaldırılır.
- `TelegramClient(..., system_version="Windows", ...)` → `system_version="Linux"` (kozmetik).
- `.gitignore`'a `.telegram-user-long-poll.lock` eklenir.

**`scripts/local_setup_bridge.py`**:
- `mark_hidden()` fonksiyonu ve çağrı noktası **tamamen silinir** (Windows gizli-dosya özniteliğinin Linux karşılığı yok ve artık gerçek koruma `chmod 600`'de — madde 4'te `save_session` zaten bunu yapıyor).
- `PYTHON_PATH` sabiti: `.venv/Scripts/python.exe` (Windows) → işletim sistemine göre seçilen hale getirilir: `PROJECT_ROOT / ".venv" / ("Scripts" if os.name == "nt" else "bin") / ("python.exe" if os.name == "nt" else "python")` — geliştirici hâlâ Windows'ta test edebilsin diye OS-conditional bırakılıyor, production Linux'ta `bin/python` yoluna düşüyor.
- `CREATE_NO_WINDOW` sabiti ve `subprocess.Popen(..., creationflags=CREATE_NO_WINDOW)` çağrısındaki `creationflags` kwarg'ı kaldırılır (Windows-only, POSIX'te geçersiz).
- `start_user_listener()` / `/listener/start` endpoint'i: `Popen` ile scripti doğrudan başlatmak yerine `systemctl --user start relaydesk-listener.service` çağırır:
```python
def start_user_listener() -> None:
    if not SESSION_PATH.exists():
        raise SetupError("Önce Telegram kullanıcı hesabını bağlayın.", status=409)
    subprocess.run(
        ["systemctl", "--user", "start", "relaydesk-listener.service"],
        check=True, capture_output=True, text=True, timeout=15,
    )
```
Gerekçe: süreç yönetimi tamamen systemd'de toplanıyor, `Popen` ile elle başlatılan bir süreç systemd'nin restart/crash-recovery mekanizmasının dışında kalır ve bridge yeniden başladığında yetim kalır.

**`scripts/configure_telegram_user_listener.py`**: `save_session` importu değişmiyor (Fernet'e geçiş şeffaf), başka değişiklik gerekmiyor.

## 6. `deploy/` — systemd birimleri + bash script'leri (yeni klasör)

**`deploy/relaydesk-web.service`** (sistem geneli, `/etc/systemd/system/`):
```ini
[Unit]
Description=RelayDesk web app (Next.js/vinext)
After=network.target

[Service]
Type=simple
User=relaydesk
WorkingDirectory=/opt/relaydesk
EnvironmentFile=/opt/relaydesk/.env.production
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**`deploy/relaydesk-listener.service`** (kullanıcı düzeyi, `~/.config/systemd/user/` — root/sudo gerekmez):
```ini
[Unit]
Description=RelayDesk Telegram MTProto listener
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/relaydesk
EnvironmentFile=/opt/relaydesk/.env.local
ExecStart=/opt/relaydesk/.venv/bin/python -u scripts/telegram_user_long_poll.py
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```
Bu birimin `Restart=on-failure`'ı, "Telegram tarafında geçici kesinti olsa bile çalışmaya devam etme" hedefinin gerçek uygulanma katmanı.

**`deploy/relaydesk-setup-bridge.service`** (kullanıcı düzeyi, opsiyonel — varsayılan olarak enable edilmez, sadece kurulum sırasında `systemctl --user start relaydesk-setup-bridge.service` ile elle başlatılır):
```ini
[Unit]
Description=RelayDesk local setup bridge (Telegram login yardımcı sunucusu)

[Service]
Type=simple
WorkingDirectory=/opt/relaydesk
EnvironmentFile=/opt/relaydesk/.env.local
ExecStart=/opt/relaydesk/.venv/bin/python -u scripts/local_setup_bridge.py
Restart=on-failure
```

**Bash script'leri — hangi `.ps1` neye dönüşüyor:**

| PowerShell | Karar |
|---|---|
| `run-relaydesk-server.ps1` | **Gereksiz** — `relaydesk-web.service` yerini alıyor, bash portu yok. |
| `run-telegram-user-listener.ps1` | **Gereksiz** — `relaydesk-listener.service` yerini alıyor. |
| `run-local-setup-bridge.ps1` | **Gereksiz** — `relaydesk-setup-bridge.service` yerini alıyor. |
| `start-local-telegram.ps1` | **`deploy/relaydesk-bootstrap.sh`'e dönüşür** — systemd birimlerini `enable --now` yapar + `/api/status`'a health-check curl atar. |
| `configure-telegram-user-listener.ps1` | **`deploy/configure-telegram-user-listener.sh`'e dönüşür** — ince sarmalayıcı, `.venv/bin/python scripts/configure_telegram_user_listener.py` çağırır. |
| `configure-local-telegram.ps1` | **`deploy/configure-local-telegram.sh`'e dönüşür** — `Read-Host -AsSecureString` yerine `read -s` kullanır. |
| `connect-telegram-business.ps1` | **`deploy/connect-telegram-business.sh`'e dönüşür** — ince sarmalayıcı. |
| `sync-telegram-history.ps1` | **`deploy/sync-telegram-history.sh`'e dönüşür** — ince sarmalayıcı. |

Eski `.ps1` dosyaları **silinmiyor** (Windows'ta geliştirme/test için hâlâ işe yarayabilirler) — sadece yanlarına Linux eşdeğerleri ekleniyor.

## 7. `.env.example` güncellemesi

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
SUPPORT_ALLOWED_EMAILS=
LOCAL_SETUP_TOKEN=

# Yerel SQLite veritabanı dosya yolu. Production'da kalıcı/yedeklenen bir dizine
# işaret etmeli (örn. /var/lib/relaydesk/relaydesk.sqlite); dizin önceden var olmalı.
DATABASE_PATH=./data/relaydesk.sqlite

# Telegram kullanıcı oturumunu şifrelemek için kullanılan anahtar. Üretmek için:
# python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# Bir SSH private key gibi koru — 600 izinli, sadece servis kullanıcısının okuyabileceği dosyada tut.
SESSION_ENCRYPTION_KEY=
```

## 8. Kapsam dışı bırakılan bulgu (dokümantasyona not düşülecek, KOD DEĞİŞMEYECEK)

`app/api/reply/route.ts` satır 41-86 doğrulandı: Telegram `sendMessage` başarısız olursa `catch` bloğu direkt 502 dönüyor, mesaj `messages`/`auditLogs`/`messageLogs` hiçbirine yazılmıyor — ajanın yazdığı metin sunucu tarafında kayboluyor. Bu gerçek bir dayanıklılık boşluğu ama bu migrasyonun kapsamı dışında (bir `outbox` tablosu + retry/backoff gerektirir). README'ye "bilinen sınırlama" olarak eklenecek, kod dokunulmayacak.

## Uygulama sırası (Mert bu sırayla ilerlesin)

1. DB katmanı (`db/index.ts`, `db/ensure.ts`, `package.json`'a `better-sqlite3`) — build/start smoke test yapmadan sonraki adıma geçme.
2. Build/runtime (`vite.config.ts`, `worker/index.ts` sil, `cloudflare-env.d.ts` sil, `package.json`'dan Cloudflare devDependencies kaldır) → `npm run build && npm run start` ile uçtan uca doğrula.
3. Env değişkeni geçişi (3 dosya).
4. Python/Fernet + Linux düzeltmeleri → `python scripts/telegram_user_session.py` self-test'i çalıştır.
5. `requirements-connect.txt` + `.env.example`.
6. `deploy/` systemd birimleri + bash script'leri.
7. README/AGENTS.md'ye Linux dağıtım notları ekle (SESSION_ENCRYPTION_KEY üretimi, SSH tünel ile setup wizard erişimi, DPAPI→Fernet tek seferlik yeniden giriş notu, reply/route.ts bilinen sınırlaması).

## STATUS: READY_FOR_BUILD
