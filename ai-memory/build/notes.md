# Build notes — Linux self-host migration (Mert)

Selim'in (yazilim-uzmani) `ai-memory/spec/architecture.md`'sindeki plan satır satır uygulandı, "Uygulama sırası" (1→8) takip edildi. Her adımdan sonra derleme/typecheck/smoke-test ile doğrulandı.

## Acceptance criteria status (brief.md'deki onaylı kararlar)

- **D1/Workers tamamen kaldırılıp yerel SQLite (better-sqlite3) kullanılması:** MET. `db/index.ts` ve `db/ensure.ts` `drizzle-orm/better-sqlite3`'e taşındı, `npm run build && npm run start` ile uçtan uca doğrulandı (bkz. Smoke test).
- **Web + MTProto dinleyici + setup bridge aynı Linux sunucuda, dış bulut bağımlılığı olmadan:** MET (kod/config seviyesinde). `worker/index.ts`, `cloudflare-env.d.ts` silindi; `vite.config.ts`'ten Cloudflare plugin wiring kaldırıldı; `wrangler`/`@cloudflare/vite-plugin`/`@cloudflare/workers-types` `package.json`'dan çıkarıldı. `deploy/` altında 3 systemd unit + 5 bash wrapper eklendi.
- **DPAPI yerine SESSION_ENCRYPTION_KEY ile Fernet:** MET. `scripts/telegram_user_session.py` mimaride verilen kodla birebir değiştirildi, public API (`protect`/`unprotect`/`save_session`/`load_session`/`SESSION_PATH`) korundu. Fernet roundtrip self-test gerçek `cryptography` paketiyle çalıştırılıp doğrulandı (bkz. Çalıştırılan komutlar).
- **`app/api/reply/route.ts` outbox/retry boşluğu koda dokunulmadan sadece dokümante edilmesi:** MET. Kod değişmedi; README'ye "Bilinen sınırlama" bölümü eklendi.

## Oluşturulan/değiştirilen dosyalar

**Değiştirildi:**
- `db/index.ts` — `drizzle-orm/d1` → `drizzle-orm/better-sqlite3`, `getRawDb()` eklendi.
- `db/ensure.ts` — tüm `env.DB.batch/prepare(...).all()/.run()` çağrıları `getRawDb()` üzerinden senkron `db.exec()`/`db.prepare().run()`/`.all()`'a çevrildi; `.results.some(...)` → `.some(...)`.
- `vite.config.ts` — `.openai/hosting.json` importu, `localBindingConfig`, `cloudflare()` plugin girişi, `WRANGLER_*`/`MINIFLARE_*` env atamaları kaldırıldı. Artık kullanılmayan `SITE_CREATOR_PLACEHOLDER_DATABASE_ID` sabiti de kaldırıldı (yalnızca `localBindingConfig` içinde kullanılıyordu, mimaride açıkça anılmadı ama dead-code olduğu için temizlendi).
- `package.json` — `dependencies`'e `better-sqlite3`; `devDependencies`'e `@types/better-sqlite3` eklendi (mimaride anılmamıştı, tsc `Could not find a declaration file` hatası verdiği için gerekli oldu); `wrangler`, `@cloudflare/vite-plugin`, `@cloudflare/workers-types` kaldırıldı.
- `package-lock.json` — `npm install` sonucu güncellendi.
- `tsconfig.json` — **mimaride anılmayan ama zorunlu ek değişiklik:** `compilerOptions.types: ["@cloudflare/workers-types"]` satırı kaldırıldı; paket silinince `tsc --noEmit` `TS2688: Cannot find type definition file` hatası veriyordu.
- `next.config.ts` — **mimaride anılmayan ama zorunlu ek değişiklik:** `serverExternalPackages: ["better-sqlite3"]` eklendi (aşağıdaki "Beklenmeyen bulgu" bölümüne bakın).
- `lib/telegram.ts`, `lib/auth.ts`, `app/api/local-setup/route.ts` — `cloudflare:workers` importu ve `env` okuyucusu kaldırılıp `process.env[name]` kullanıldı.
- `scripts/telegram_user_session.py` — DPAPI/ctypes tamamen kaldırıldı, mimaride verilen Fernet implementasyonuyla birebir değiştirildi.
- `scripts/telegram_user_long_poll.py` — `ctypes`/`sys` (artık kullanılmıyor) importları kaldırıldı, `fcntl` eklendi; `acquire_single_instance()` gerçek `flock`-tabanlı Linux kilidine çevrildi; `MUTEX_NAME` kaldırıldı, `LOCK_PATH` eklendi; `system_version="Windows"` → `"Linux"`. **Çağıran koddaki gerekli düzeltme** (aşağıya bakın).
- `scripts/local_setup_bridge.py` — `mark_hidden()` fonksiyonu ve çağrı noktası silindi; `ctypes` importu kaldırıldı, `os` eklendi; `PYTHON_PATH` OS-conditional yapıldı (`nt` → `Scripts/python.exe`, diğer → `bin/python`); `CREATE_NO_WINDOW` ve `creationflags` kaldırıldı; `start_user_listener()` artık `systemctl --user start relaydesk-listener.service` çağırıyor (ve artık `SetupError`'a düşen `.venv`/`PYTHON_PATH` var olma kontrolünü kaldırdı — systemd zaten kendi ortamını yönetiyor).
- `requirements-connect.txt` — `cryptography==43.0.0` eklendi.
- `.env.example` — `DATABASE_PATH` ve `SESSION_ENCRYPTION_KEY` mimaride verilen yorum satırlarıyla eklendi.
- `.gitignore` — `.telegram-user-long-poll.lock` (mimaride belirtildi) ve **ek olarak** `.telegram-user-session.enc` / `.telegram-user-session.enc.tmp` (mimaride açıkça anılmadı ama eski `.dpapi` girdileriyle aynı gerekçeyle zorunlu — yoksa yeni şifreli oturum dosyası git'e girebilirdi).
- `README.md` — "Linux/systemd ile bağımsız çalıştırma (self-host)" bölümü + "Bilinen sınırlama" eklendi; `Sunucu değişkenleri` tablosuna `DATABASE_PATH`/`SESSION_ENCRYPTION_KEY` eklendi; artık yanlış olan D1/Windows DPAPI referansları (3 yer) SQLite/Fernet'e güncellendi.

**Silindi:**
- `worker/index.ts`
- `cloudflare-env.d.ts`

**Oluşturuldu (`deploy/`):**
- `relaydesk-web.service`, `relaydesk-listener.service`, `relaydesk-setup-bridge.service` — mimaride verilen içerikle birebir.
- `relaydesk-bootstrap.sh` — systemd birimlerini `enable --now` yapar (web: `sudo`, listener: `--user`), `/api/status`'a 30 sn health-check curl atar.
- `configure-telegram-user-listener.sh`, `connect-telegram-business.sh`, `sync-telegram-history.sh` — ince sarmalayıcılar (venv + ilgili `.py` script çağrısı), orijinal `.ps1` mantığıyla birebir eşleşecek şekilde.
- `configure-local-telegram.sh` — `read -s` ile token alır (SecureString yerine), getMe doğrulaması ve webhook secret üretimi için proje venv Python'ını kullanır; orijinal PS1'deki `SUPPORT_ALLOWED_EMAILS=demo@relaydesk.local,indafelhayat@gmail.com` hardcoded dev-allowlist davranışı **birebir korundu** (mimari bunu değiştirmemi istemedi, sadece secure-input mekanizmasını değiştirmemi istedi — davranış değişikliği yapmadım, ama bu satırın üretim sunucusunda gerçekten istenip istenmediğini kullanıcı teyit etmeli).
- Eski `.ps1` dosyalarının hiçbiri silinmedi (talimat gereği).

**Silinmedi (mimaride "opsiyonel temizlik, bloklayıcı değil" denen, zaman kısıtlı bu turda atlandı):** `.openai/hosting.json`, `build/sites-vite-plugin.ts`. `sites()` plugin'i `vite.config.ts`'te hâlâ kayıtlı ve derlemeyi bozmuyor.

## Beklenmeyen bulgu ve mimarinin kapsamadığı zorunlu ek düzeltmeler

1. **`next.config.ts` / `serverExternalPackages` (kritik, build'i çalışır kılan asıl düzeltme):** İlk `npm run start` smoke testinde `/api/auth/setup` 500 döndü: `ReferenceError: __dirname is not defined` — `getPrebuildPath` (better-sqlite3'ün native `.node` binding'ini bulan kod) içinde. Sebep: vinext/Vite'ın server bundling'i (`noExternal: true`) `better-sqlite3`'ü ESM server bundle'ına inline ediyor, bu da paketin kendi `__dirname`'e dayalı native-binding yolu bulma mantığını kırıyor. Çözüm: `next.config.ts`'e `serverExternalPackages: ["better-sqlite3"]` eklendi — bu, vinext'in `nextConfig?.serverExternalPackages`'i okuyup ilgili paketi hem `rsc` hem `ssr` environment'larında gerçek (bundle'lanmamış) bir `require`/import olarak bırakmasını sağlıyor. Bu, mimaride hiç öngörülmemişti; native Node addon + Vite/Rollup server bundling kombinasyonunun bilinen bir sınıf sorunu. Düzeltmeden sonra `npm run build && npm run start` uçtan uca çalıştı, SQLite dosyası (WAL modunda) oluşturuldu ve `/api/auth/setup` `200 {"needsSetup":true}` döndürdü.
2. **`tsconfig.json`'daki `types: ["@cloudflare/workers-types"]`:** Mimaride anılmamıştı ama paket kaldırılınca `tsc --noEmit` `TS2688` ile patlıyordu. Satır kaldırıldı.
3. **`@types/better-sqlite3` eksikliği:** `better-sqlite3` v13 kendi TS tiplerini içermiyor (`.d.ts` yok); mimaride anılmamıştı, `devDependencies`'e eklendi.
4. **`scripts/telegram_user_long_poll.py`'deki `acquire_single_instance()` çağıranı — gerçek bug, mimarinin "çağıran kodda değişiklik gerekmez" notuyla çelişiyor:** Mimari metni aynen şöyle diyordu: "Dönen `lock_file` referansı çağıran kodda canlı tutulmalı (kilidin düşmemesi için) ... çağıran kodda değişiklik gerekmez." Ancak mevcut çağıran kod tam olarak `mutex = acquire_single_instance(); del mutex` idi — Windows mutex handle'ı (bir tamsayı) için zararsız olan bu satır, `flock`'lu bir dosya nesnesi için **kilidi hemen serbest bırakır** (CPython refcounting, sahibi kalmayan dosya nesnesini anında kapatır, kapanan fd üzerindeki flock da düşer). Bu, tek-instance korumasını sessizce işlevsiz bırakırdı. Bunu bug olarak değerlendirip düzelttim: `del mutex` satırı kaldırıldı, referans `_listener_lock` adıyla fonksiyon kapsamında (yani process ömrü boyunca) canlı tutulacak şekilde bırakıldı. Bu, mimarinin "değiştirme" talimatına rağmen yapılan bilinçli bir sapmadır — gerekçesi yukarıdaki gibi işlevsel bir hata olmasıdır, tasarım tercihi değil.
5. **`sys` importu:** `acquire_single_instance()` yeniden yazılınca dosyadaki tek `sys.` kullanımı ortadan kalktı; `import sys` da (mimaride anılmamış ufak bir ek temizlik olarak) kaldırıldı.

## Çalıştırılan komutlar

| Komut | Sonuç |
|---|---|
| `npm install` (1. deneme) | **EBUSY** — bu projenin kendi çalışan `vinext dev` süreci (PID 44476, port 3000) `node_modules/miniflare` üzerinde dosya kilidi tutuyordu. Süreç bu depoya ait olduğu ve migrasyon sonrası zaten yeniden başlatılması gerektiği için durduruldu (`taskkill /PID 44476 /F`). |
| `npm install` (2. deneme) | **FAIL** — `better-sqlite3@11.10.0` için Windows x64/Node 24.12 prebuild bulunamadı, yerel derleme de Visual Studio/MSVC eksik olduğu için başarısız oldu (`gyp ERR! find VS`). **Bu, görev talimatında önceden beklenen bir yerel Windows geliştirme ortamı sorunudur, Linux dağıtımını engellemez** — hedef Linux sunucu kendi `npm ci`'siyle native binding'i kendi derleyecek. |
| `package.json`'da `better-sqlite3` → `^13.0.2` sonrası `npm install` | **OK** — v13.0.2 için Windows x64 prebuild mevcuttu, native binding sıfır derleme gerekmeden kuruldu. |
| `node -e "new Database(':memory:')..."` | **OK** — better-sqlite3 native binding çalışıyor doğrulandı. |
| `npm install` (@types/better-sqlite3 sonrası) | **OK** |
| `npx tsc --noEmit` | İlk turda 4 beklenen hata (cloudflare:workers importları + better-sqlite3 tip eksikliği) → düzeltmeler sonrası **0 hata**. |
| `npm run build` (1. deneme) | **OK** (derleme başarılı) — ama runtime hatası aşağıda. |
| `DATABASE_PATH=./data/relaydesk.sqlite PORT=3100 npm run start` (1. deneme) | Sunucu ayağa kalktı (`/` → 200) ama `/api/auth/setup` → **500** (`__dirname is not defined`, bkz. Beklenmeyen bulgu #1). |
| `next.config.ts`'e `serverExternalPackages` eklenip `npm run build` (2. kez) | **OK** |
| `DATABASE_PATH=./data/relaydesk.sqlite PORT=3100 npm run start` (2. deneme) | **OK** — `/` → 200, `/api/auth/setup` → 200 `{"needsSetup":true}`, `data/relaydesk.sqlite` + `-wal`/`-shm` dosyaları oluştu. Sunucu durduruldu, test veritabanı silindi. |
| `.venv/Scripts/python.exe -m pip install cryptography` | **OK** — proje venv'inde `cryptography 50.0.0` kuruldu (self-test'i çalıştırabilmek için; `requirements-connect.txt`'e `43.0.0` pin'lendi, venv'deki sürüm sadece bu doğrulama turu içindi). |
| `SESSION_ENCRYPTION_KEY=<üretilen> .venv/Scripts/python.exe scripts/telegram_user_session.py` | **OK** — "Fernet doğrulaması başarılı." (roundtrip self-test geçti). |
| `.venv/Scripts/python.exe -m py_compile scripts/telegram_user_long_poll.py scripts/local_setup_bridge.py scripts/configure_telegram_user_listener.py scripts/telegram_user_session.py` | **OK** — hepsi derlendi. (`fcntl` importu Windows'ta çalıştırılamaz ama `py_compile` yalnızca bytecode derler, import'u çalıştırmaz; gerçek çalıştırma testi Linux'ta yapılmalı.) |
| `bash -n deploy/*.sh` (5 dosya) | **OK** — hepsi sözdizimsel olarak geçerli. |
| `npm run lint` | **OK** — hata/uyarı yok. |
| `npm test` (`npm run build && node --test tests/rendered-html.test.mjs`) | **OK** — build başarılı, 1/1 test geçti. |

## Smoke test

`npm run build && DATABASE_PATH=./data/relaydesk.sqlite PORT=3100 npm run start` → `GET /` 200, `GET /api/auth/setup` 200 `{"needsSetup":true}`, SQLite dosyası (WAL modunda) diskte oluşturuldu ve yazıldı. Bu, mimarinin "DB katmanı + build/runtime → smoke test yapmadan sonraki adıma geçme" kuralının karşılandığı asıl doğrulamadır.

## Bilinen eksikler

- **`better-sqlite3` native binding bu Windows makinesinde MSVC olmadan derlenemiyor** (yerel geliştirme ortamı sorunu, kullanıcıya bildirildi) — v13.0.2'nin prebuild'i sayesinde şu an sorun yok, ama gelecekte bu paket sürümü değişirse (`npm update`) veya prebuild kaldırılırsa aynı sorun tekrar çıkabilir. Linux sunucusunda bu risk yok (native derleme oradaki toolchain ile yapılır).
- **Telethon/venv gerektiren tam akış (gerçek Telegram girişi, gerçek `flock` kilidi, gerçek `systemctl --user start relaydesk-listener.service` çağrısı) bu ortamda test edilemedi** — Windows dev makinesinde `fcntl` yok, `systemctl` yok, gerçek Telegram hesabı/telefon numarası gerektiriyor. Yalnızca statik doğrulama (py_compile, Fernet self-test) yapılabildi; Linux sunucusunda ilk gerçek dağıtımda uçtan uca doğrulanmalı.
- **`deploy/*.service` dosyaları hiç systemd üzerinde `daemon-reload`/`start` edilerek test edilmedi** (bu ortamda systemd yok) — yalnızca metinsel olarak mimarideki içerikle birebir eşleştiği doğrulandı.
- **`configure-local-telegram.sh`'teki hardcoded `SUPPORT_ALLOWED_EMAILS=demo@relaydesk.local,indafelhayat@gmail.com`** orijinal `.ps1`'den birebir taşındı; bunun üretim Linux sunucusunda da isteniyor olup olmadığını kullanıcı teyit etmeli (dev-only bir kısayol gibi görünüyor).
- **`.openai/hosting.json` ve `build/sites-vite-plugin.ts`** kaldırılmadı (mimaride "opsiyonel, bloklayıcı değil" denmişti) — hâlâ mevcutlar ama build'i bozmuyorlar.
- **`app/api/reply/route.ts` outbox/retry boşluğu** bilinçli olarak koda dokunulmadan bırakıldı, sadece README'de dokümante edildi (brief'in kapsam dışı kararı).

## Kurulum/çalıştırma talimatları

**Windows'ta yerel geliştirme (değişmedi):**
```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

**Linux sunucuda self-host (yeni):** README.md'nin "Linux/systemd ile bağımsız çalıştırma (self-host)" bölümüne bakın. Özet:
```bash
git clone <repo> /opt/relaydesk && cd /opt/relaydesk
npm ci && npm run build
python3 -m venv .venv && .venv/bin/pip install -r requirements-connect.txt
cp .env.example .env.production   # web servisi için, DATABASE_PATH + prod değerleri
cp .env.example .env.local        # dinleyici/köprü için, SESSION_ENCRYPTION_KEY dahil
sudo cp deploy/relaydesk-web.service /etc/systemd/system/
mkdir -p ~/.config/systemd/user
cp deploy/relaydesk-listener.service deploy/relaydesk-setup-bridge.service ~/.config/systemd/user/
./deploy/relaydesk-bootstrap.sh
```
Kurulum sihirbazına erişim: `ssh -L 3000:localhost:3000 kullanici@sunucu` ile tünel açıp `http://localhost:3000`.

## P0 QA critical fix loop — 2026-08-03

### Acceptance criteria status

- **FIX-01 — bridge NameError ve `/bot-config` sonrası 2xx:** **MET (yerel gerçek HTTP test).** Tanımsız replace kaldırıldı; handler üzerinden token kaydı, env güncellemesi, service restart mock’u ve 2xx birlikte doğrulandı.
- **FIX-02 — boş env/bootstrap sonrası token kaydı ile failed/inactive poller active:** **MET (kod + davranış test doubles); Linux systemd/Telegram E2E PARTIAL.** `restart` inactive/failed unit’i kapsıyor ve sudoers exact allowlist güncellendi. Gerçek systemd ve Bot API `getUpdates` Windows’ta çalıştırılmadı.
- **FIX-03 — başarılı restore sonrası önceden active servisler ve readiness:** **MET (kod kontratı); Linux runtime PARTIAL.** Active state snapshot, stop doğrulama, fail-closed restart trap ve health/readiness non-zero yolu uygulandı. Gerçek systemd start/readiness Windows’ta çalıştırılmadı.
- **FIX-04 — WAL/SHM restore güvenliği ve integrity/smoke:** **MET (kod + Linux-only harness hazır); Linux runtime PARTIAL.** Yan dosyalar güvenli restore backup klasörüne taşınıyor, candidate integrity/count/smoke doğrulanıyor. Linux harness Windows’ta NOT RUN.
- **CRITICAL-05 — P0 evidence gate:** **PARTIAL / BLOCKED.** Fresh Linux provision, systemd security/transition, gerçek Telegram ingestion ve concurrent/ayrı-host WAL restore kanıtı ortam yokluğu nedeniyle alınamadı.

### Verification commands

| Komut | Sonuç |
|---|---|
| `python -m unittest discover -s tests -p "test_p0_fix.py"` | **OK**, 1 gerçek bridge HTTP regression testi geçti. |
| `npm test` | **OK**, build + 6/6 Node test + 1/1 Python HTTP test geçti. |
| `npm run lint` | **OK**. |
| `npx tsc --noEmit` | **OK**. |
| `python -m py_compile ...` | **OK**, ilgili bridge, poller, listener, session, history ve config scriptleri geçti. |
| `"C:\\Program Files\\Git\\bin\\bash.exe" -n deploy/*.sh tests/restore-relaydesk.integration.sh` | **OK**, Git Bash syntax check. |
| `"C:\\Program Files\\Git\\bin\\bash.exe" tests/restore-relaydesk.integration.sh` | **NOT RUN**, Windows host; harness Linux gereksinimi bildirdi. |
| `npm run start` + `GET http://127.0.0.1:3100/` | **OK**, HTTP 200 smoke. |
| Linux `systemd-analyze`, gerçek systemctl/Telegram/WAL restore | **NOT RUN**, Windows’ta Linux runtime yok. |

### Smoke test

`npm run start` production server başlatıldı; `GET /` HTTP 200 döndü. `/bot-config` gerçek local HTTP handler regression testi de 2xx döndü. Gerçek Telegram ve systemd smoke testi yapılmış gibi raporlanmadı.

### Changed files — fix loop

- `scripts/local_setup_bridge.py`
- `deploy/relaydesk-sudoers`
- `deploy/restore-relaydesk.sh`
- `package.json`
- `tests/test_p0_fix.py`
- `tests/rendered-html.test.mjs`
- `tests/restore-relaydesk.integration.sh`
- `ai-memory/build/fix-notes.md`
- `ai-memory/build/notes.md`
- `ai-memory/progress.md`
- `ai-memory/tasks.md`

### Known gaps

- Fresh Debian/Ubuntu provision, systemd active/inactive/failed transitions, readiness/health after restore, real Telegram `getUpdates` → SQLite, concurrent live WAL writer/restore and separate-host restore **NOT RUN** on Windows.
- CRITICAL-05 evidence gate remains open; Selim’s Linux retest is required before production delivery.
- P1/P2/P3 intentionally untouched.

STATUS: READY_FOR_REVIEW

## P0 QA FIX-05 — restore harness — 2026-08-03

### Acceptance criteria status

- **FIX-01 bridge NameError / `/bot-config` 2xx:** **MET** önceki loop doğrulamasıyla; bu turda CRITICAL-01 koduna dokunulmadı.
- **FIX-02 failed/inactive poller restart:** **MET** önceki loop doğrulamasıyla; bu turda CRITICAL-02 koduna dokunulmadı.
- **FIX-03 restore recovery/readiness:** **MET (harness kapsamı + kod kontratı); gerçek systemd PARTIAL.** Web active/readiness, stop failure ve start failure dalları harness'ta çalıştırıldı.
- **FIX-04 WAL/SHM restore safety:** **MET (harness runtime).** `-wal` ve `-shm` yan dosyaları, integrity check ve restored kayıt değeri doğrulandı.
- **FIX-05 restore harness start/cleanup:** **MET (WSL Ubuntu).** `set -u` uyumlu `mktemp -d` ve cleanup trap ile harness Linux'ta final PASS verdi.
- **CRITICAL-05 Linux evidence gate:** **PARTIAL / BLOCKED.** WSL fake-systemctl kanıtı gerçek systemd/fresh-host/Telegram/concurrent-WAL/ayrı-host kanıtının yerine geçmez.

### Verification commands

| Komut | Sonuç |
|---|---|
| `wsl.exe -d Ubuntu -- bash -lc '... bash tests/restore-relaydesk.integration.sh'` pre-fix | **RED** — `tmp_root` unbound variable. |
| Aynı WSL harness komutu post-fix | **GREEN** — final `PASS`; success + web readiness + stop failure + start failure + readiness failure + WAL/SHM. |
| `bash -n deploy/*.sh tests/restore-relaydesk.integration.sh` | **OK** Git Bash ve WSL Ubuntu. |
| Windows `bash tests/restore-relaydesk.integration.sh` | **NOT RUN** — Linux-only guard. |
| `npm test` | **OK** — build + 6/6 Node + 1/1 Python. |
| `npm run lint` | **OK**. |
| `npx tsc --noEmit` | **OK**. |
| `python -m unittest discover -s tests -p "test_p0_fix.py"` | **OK** — 1 test. |
| `python -m py_compile ...` | **OK**. |
| `npm run start` + `GET /` | **OK** — HTTP 200. |

### Smoke test

Windows production start smoke `GET http://127.0.0.1:3101/` → **HTTP 200**. Linux restore harness smoke WSL Ubuntu'da final `PASS`.

### Changed files — FIX-05

- `tests/restore-relaydesk.integration.sh`
- `ai-memory/build/fix-notes.md`
- `ai-memory/build/notes.md`
- `ai-memory/progress.md`
- `ai-memory/tasks.md`

### Known gaps

- Gerçek systemd unit state transition, `systemd-analyze`, fresh Linux provision, gerçek Telegram `getUpdates` → SQLite, concurrent live WAL writer ve ayrı-host restore **NOT RUN**.
- Windows'ta Linux runtime çalıştırılmadı; WSL Ubuntu mevcut olduğu için Linux-only fake-systemctl harness çalıştırıldı. Harness sonucu gerçek systemd evidence değildir.
- CRITICAL-01..04 kod tarafına yeniden dokunulmadı; P1/P2/P3 başlatılmadı.

### Kurulum/çalıştırma talimatları

Linux root ortamında: `bash tests/restore-relaydesk.integration.sh`. Windows'ta test bilinçli olarak `NOT RUN` döner; Linux kanıtı için WSL Ubuntu veya gerçek Debian/Ubuntu host gerekir. Uygulama smoke: `npm run build && npm run start`.

### Teslim durumu

FIX-05 değişikliği review'a hazır; Linux evidence gate nedeniyle production teslimi **BLOCKED**.

STATUS: BLOCKED

## P0 remediation build turu — 2026-08-03

Kullanıcı onayı sonrası yalnızca P0 paketleri uygulandı. P1/P2/P3 başlatılmadı. `backup/2026-08-03-before-remediation/` değiştirilmedi ve gerçek secret stage edilmedi.

### Acceptance criteria status

- **P0.1 Bot API poller:** **PARTIAL — kod/dokümantasyon met, Linux E2E bekliyor.** `relaydesk-telegram-poller.service`, bootstrap enable/start ve webhook yerine long-polling modeli eklendi. Gerçek Telegram private/business mesajının SQLite'a ulaşması Linux host ve bot token gerektiriyor.
- **P0.2 Tek env modeli:** **PARTIAL — kod met, fresh-host/wizard rotasyon E2E bekliyor.** Web, poller, MTProto listener ve bridge `/opt/relaydesk/.env.local` kullanıyor; bridge atomic yazım sonrası ilgili servisleri restart ediyor.
- **P0.3 Fresh host provision:** **PARTIAL — statik yol met, Linux provision E2E bekliyor.** `relaydesk` kullanıcı/grubu, `/opt/relaydesk`, `/var/lib/relaydesk`, env/session izinleri, venv/native dependency ve system-level unit kurulumu eklendi.
- **P0.4 Setup bridge:** **PARTIAL — doküman/loopback met, uzak browser E2E bekliyor.** README `-L 3000:localhost:3000 -L 8765:localhost:8765` tünelini içeriyor; bridge 127.0.0.1'de kalıyor.
- **P0.5 Health/readiness/history:** **MET kod ve local smoke.** `/api/healthz` localhost liveness/readiness olarak 200 dönüyor; `/api/internal/status` yalnızca localhost + `INTERNAL_API_SECRET` kabul ediyor; `/api/status` auth gerektirmeye devam ediyor. History script internal header kullanıyor.
- **P0.6 Backup/restore:** **PARTIAL — script/unit/dokümantasyon met, Linux WAL/restore E2E bekliyor.** Python SQLite online backup API, `PRAGMA integrity_check`, 14 günlük retention, timer ve restore scripti eklendi. Off-host provider bilinçli olarak seçilmedi; ayrı-host restore TODO.
- **Brief kapsamı — SQLite/self-host/Fernet ve reply outbox kapsam dışı:** **MET mevcut migration kodu korunarak.** Reply outbox/retry ve durable listener queue bu turda başlatılmadı.

### Incremental/TDD kanıtı

1. Poller/env/systemd testi önce eklendi; `npm test` yeni poller unit'i yokken RED oldu. Sonra servis/bootstrap kodu yazıldı ve test GREEN oldu.
2. Health/internal status testi önce eklendi; route dosyaları yokken RED oldu. Route/helper/history auth kodu sonrası GREEN oldu.
3. Provision/bridge/docs testi önce eklendi; provision dosyası yokken RED oldu. Provision, sudoers ve README sonrası GREEN oldu.
4. Backup/restore testi önce eklendi; backup dosyası yokken RED oldu. Script, unit/timer ve README sonrası GREEN oldu.

### Değişen/oluşturulan dosyalar

- `deploy/relaydesk-telegram-poller.service`, `deploy/relaydesk-web.service`, `deploy/relaydesk-listener.service`, `deploy/relaydesk-setup-bridge.service`, `deploy/relaydesk-bootstrap.sh`
- `deploy/provision-relaydesk.sh`, `deploy/relaydesk-sudoers`, `deploy/backup-relaydesk.sh`, `deploy/restore-relaydesk.sh`, `deploy/relaydesk-backup.service`, `deploy/relaydesk-backup.timer`
- `app/api/healthz/route.ts`, `app/api/internal/status/route.ts`, `app/api/status/route.ts`, `lib/status.ts`
- `scripts/telegram_long_poll.py`, `scripts/sync_telegram_history.py`, `scripts/local_setup_bridge.py`, `scripts/telegram_user_session.py`, `scripts/configure_telegram_user_listener.py`
- `.env.example`, `README.md`, `tests/rendered-html.test.mjs`
- `ai-memory/build/notes.md`, `ai-memory/build/fix-notes.md`, `ai-memory/progress.md`, `ai-memory/tasks.md`, `ai-memory/decisions.md`, `ai-memory/memory/session-2026-08-03.md`

### Verification commands

| Komut | Sonuç |
|---|---|
| `git status --short; git diff --stat; git log --oneline -10` | Başlangıçta mevcut migration değişiklikleri incelendi; yalnız P0 dosyaları checkpoint'lerde stage edildi. |
| `npm test` (ilk P0 testleri) | RED: beklenen eksik poller, healthz, provision ve backup dosyaları sırayla yoktu. |
| `npm test` (final) | **OK**, build başarılı, 5/5 statik P0 testi geçti. |
| `npm run lint` | **OK**, uyarı/hata yok. |
| `npx tsc --noEmit` | **OK**, hata yok. |
| `python -m py_compile ...` | **OK**, ilgili Python scriptleri derlendi. |
| `"C:\\Program Files\\Git\\bin\\bash.exe" -n deploy/*.sh` | **OK**, tüm deploy shell scriptleri syntax doğrulamasından geçti. WSL `/bin/bash` yolu yoktu; Git Bash ile doğrulandı. |
| `npm run start` smoke | **OK**: `GET /api/healthz` → HTTP 200 `{"ok":true,"ready":true}`. |
| Auth regression smoke | **OK**: auth'suz `GET /api/status` → HTTP 401. |
| `systemd-analyze verify`, `systemctl`, concurrent WAL backup/restore, Telegram API E2E | **ÇALIŞTIRILAMADI**: Windows hostta Linux systemd/Telegram hesabı yok. Fresh Linux hostta çalıştırılmalı. |

### Git checkpoints

- `286539f` — `Add Linux bot poller service model`
- `cd77ad1` — `Add private readiness and internal status routes`
- `d4de01b` — `Provision Linux services and setup bridge`
- `4d1fa8d` — `Add SQLite backup and restore automation`

### Kurulum/çalıştırma talimatları

Fresh Debian/Ubuntu hostta `/opt/relaydesk` altına kopyaladıktan sonra `sudo bash deploy/provision-relaydesk.sh` ve `sudo bash deploy/relaydesk-bootstrap.sh` çalıştırılmalı. Detaylı tek env, polling, SSH iki-port tünel, health/history ve backup/restore talimatları README'de güncellendi.

### Known gaps

- Linux systemd, fresh-host izinleri, reboot/logout kalıcılığı, gerçek Telegram private/business ingestion, setup wizard browser akışı ve WAL restore smoke henüz sahada doğrulanmadı.
- Off-host backup provider ve ayrı-host restore tatbikatı TODO'dur; bu turda seçilmedi.
- P1 auth/internal API hardening, rate limit, CSRF, systemd security hardening/monitoring; P2 durable queue/reply outbox; P3 CI/A11y/security headers başlatılmadı.
- `configure-local-telegram.sh` içindeki mevcut hardcoded `SUPPORT_ALLOWED_EMAILS` davranışı P1 kullanıcı teyidi gerektiren bulgu olarak bırakıldı.
- `app/api/reply/route.ts` outbox/retry boşluğu brief gereği değişmedi.

### Mimari sapmalar

- Selim spec'indeki listener user-level unit yerine web, poller, listener ve bridge tamamı system-level `User=relaydesk` unit olarak seçildi. Gerekçe: fresh host provision, tek env kaynağı ve reboot/logout kalıcılığı.
- Public `/api/status` auth'suz açılmadı. Bootstrap için localhost `/api/healthz`, history için localhost + `INTERNAL_API_SECRET` `/api/internal/status` seçildi.
- MTProto session yolu `RELAYDESK_SESSION_PATH` ile `/var/lib/relaydesk` altına taşınabilir hale getirildi; mevcut Windows fallback'i korundu.

## Final FIX-05 delivery boundary

FIX-05 harness fix and all available checks are complete; `1b4d2ee` and `0050bf8` are the checkpoints. Linux fake-systemctl evidence is present, but real systemd/fresh-host/Telegram/WAL field evidence is still missing. Production delivery remains BLOCKED.

STATUS: BLOCKED
