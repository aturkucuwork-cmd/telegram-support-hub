# P0 remediation fix notes — 2026-08-03

Bu tur, genel/ops audit'te bildirilen kritik P0 bulgularını gidermek için uygulandı.

## Giderilen kritik sorunlar

- **OPS-01 / poller yokluğu:** Bot API long-poll için system-level unit ve bootstrap enable/start eklendi; webhook silme + `getUpdates` modeli README'de netleştirildi.
- **OPS-02 / env drift:** Tüm servisler `/opt/relaydesk/.env.local` kullanacak şekilde birleştirildi. Bridge atomic env yazıp web/poller/listener restart ediyor.
- **OPS-03 / fresh host provision:** `relaydesk` kullanıcı/grubu, data/env/session izinleri, venv/native dependency ve systemd kurulumu `provision-relaydesk.sh` içine alındı.
- **OPS-04 / SSH bridge portu:** README'ye 3000 ve 8765 portlarını birlikte forward eden SSH komutu eklendi; bridge loopback'te kaldı.
- **OPS-05 / backup yokluğu:** WAL uyumlu Python SQLite online backup, retention, timer, integrity-check ve restore scripti eklendi.
- **OPS-06 / yanlış health-check:** Bootstrap `/api/healthz` kullanıyor; `/api/status` auth koruması sürüyor.
- **OPS-07/OPS-15 / listener kalıcılığı ve session restart loop:** Listener system-level yapıldı ve session yokken `ConditionPathExists` ile çalışmıyor.
- **OPS-12 / history 401:** History sync, localhost + `INTERNAL_API_SECRET` korumalı `/api/internal/status` kullanıyor.

## Tekrar çalıştırılan doğrulamalar

- TDD RED aşamaları görüldü: eksik poller, health, provision ve backup dosyaları testleri beklenen şekilde kırdı.
- Final `npm test`: **5/5 geçti**; build dahil.
- `npm run lint`: **geçti**.
- `npx tsc --noEmit`: **geçti**.
- Python `py_compile`: **geçti**.
- Git Bash ile `bash -n deploy/*.sh`: **geçti**.
- Runtime smoke: `/api/healthz` **200**, auth'suz `/api/status` **401**.

## Açık retest

Gerçek Linux fresh-host provision, `systemd-analyze verify/security`, reboot, Telegram getUpdates → SQLite, SSH browser wizard ve concurrent WAL backup/ayrı-host restore testleri Linux sunucuda tekrar çalıştırılmalıdır.

## P0 QA critical fix loop — 2026-08-03

### Kritik sorun → düzeltme → tekrar doğrulama

- **CRITICAL-01 / `bot-config` 500:** `restart_managed_services()` içindeki tanımsız `temporary.replace(ENV_PATH)` kaldırıldı. Gerçek `ThreadingHTTPServer` üzerinden `/bot-config` regression testi eklendi; token yazımı ve HTTP 2xx kanıtlandı.
- **CRITICAL-02 / failed poller başlamıyor:** `try-restart` yerine her managed unit için `systemctl restart` seçildi. `deploy/relaydesk-sudoers` exact `restart` imzaları ve wizard listener `start` imzasını içeriyor. Test state machine failed poller’ı token kaydı sonrası active’e taşıdı.
- **CRITICAL-03 / restore servisleri kapalı kalıyor:** Restore öncesi active unit’ler kaydedilip durduruluyor; stop doğrulanıyor; EXIT trap önceden active unit’leri başlatıyor. Start/is-active/readiness/health hataları non-zero’a çevriliyor; `|| true` kaldırıldı.
- **CRITICAL-04 / WAL/SHM güvenliği:** Mevcut `-wal`/`-shm` dosyaları destination yanında timestamp’li restore backup klasörüne taşınıyor. Aday DB üzerinde `PRAGMA integrity_check`, tablo kayıt sayısı eşleşmesi ve SQLite smoke çalışıyor; sonra atomik `mv` yapılıyor.

### Doğrulama

- TDD RED: önceki `4d1fa8d` restore scripti fail-closed kontratında RED oldu; bridge regression testi eski akışta gerçek HTTP 500 ve `try-restart` trace’i verdi.
- GREEN: `npm test` → build + **6/6 Node testi** + **1/1 gerçek bridge HTTP testi** geçti.
- `npm run lint`, `npx tsc --noEmit`, Python `py_compile` ve Git Bash `bash -n deploy/*.sh tests/restore-relaydesk.integration.sh` → geçti.
- Smoke: `npm run start` → `GET /` **HTTP 200**.
- Linux-only restore integration, `systemd-analyze`, gerçek systemctl transition, Telegram `getUpdates` → SQLite ve concurrent WAL restore → **NOT RUN** (Windows host).

### Kalan kritik / durum

- **CRITICAL-05 evidence gate:** Kod ve yerel doğrulamalar tamamlandı; fresh Linux/systemd/Telegram/WAL saha kanıtı bu ortamda alınamadı. Bu handoff production delivery değildir; Selim QA retesti gereklidir.
- P1/P2/P3 başlatılmadı.

STATUS: BLOCKED

## FIX-05 — Restore integration harness retest — 2026-08-03

### Acceptance criteria status

- **FIX-01 — bridge NameError / `/bot-config` 2xx:** **MET (önceki fix, bu turda dokunulmadı).**
- **FIX-02 — failed/inactive poller restart:** **MET (önceki fix, bu turda dokunulmadı).**
- **FIX-03 — restore service recovery/readiness:** **MET (kod kontratı; gerçek systemd evidence hâlâ açık).** Bu harness web active/readiness, stop failure ve start failure dallarını çalıştırıyor.
- **FIX-04 — WAL/SHM güvenliği ve integrity/smoke:** **MET (harness runtime).** Başarı akışı hem `-wal` hem `-shm` sidecar izolasyonunu, restore integrity ve kayıt değerini doğruluyor.
- **FIX-05 — Linux restore harness başlatılabilirliği:** **MET (WSL Ubuntu Linux runtime).** `mktemp -d` temp root ve `set -u` uyumlu cleanup trap eklendi; harness PASS ile tamamlandı.
- **Linux production evidence gate:** **BLOCKED/PARTIAL.** WSL üzerinde fake `systemctl` ile harness çalıştı; gerçek fresh Debian/Ubuntu systemd, servis birimleri, Telegram API, concurrent WAL writer ve ayrı-host restore bu Windows makinesinde doğrulanmadı.

### Kritik kapsam sınırı

CRITICAL-01..04 production koduna yeniden dokunulmadı. Değişiklik yalnızca `tests/restore-relaydesk.integration.sh` ve bu fix dokümantasyonundadır.

### FIX-05 düzeltmesi ve kanıt

- `tmp_root="$(mktemp -d)"` artık `set -u` altında tüm geçici yollar kullanılmadan önce oluşturuluyor.
- Cleanup, tanımlı kök üzerinde `trap cleanup EXIT` ile yapılıyor.
- Ubuntu/gawk uyumluluğu için fake `systemctl` içindeki `awk` değişkeni ayrılmış `index` adından çıkarıldı.
- Mevcut başarı akışına web active/readiness ve hem WAL hem SHM sidecar doğrulaması eklendi.
- Aynı fake-systemctl akışı içinde stop failure, start failure ve readiness failure negatif senaryoları kontrollü olarak çalıştırıldı; beklenen non-zero sonuçlar doğrulandı.

### Doğrulama

| Komut | Sonuç |
|---|---|
| `wsl.exe -d Ubuntu -- ... bash tests/restore-relaydesk.integration.sh` (FIX-05 öncesi) | **RED** — `tmp_root: unbound variable`; trap de aynı nedenle kırıldı. |
| `wsl.exe -d Ubuntu -- ... bash tests/restore-relaydesk.integration.sh` (FIX-05 sonrası) | **GREEN** — restore integrity, WAL/SHM isolation, web readiness, stop/start failure ve readiness failure akışları; final `PASS`. |
| `bash -n deploy/*.sh tests/restore-relaydesk.integration.sh` (Git Bash + WSL Ubuntu) | **OK**. |
| `bash tests/restore-relaydesk.integration.sh` (Windows Git Bash) | **NOT RUN** — harness Linux/systemd semantics gerektirdiği için bilinçli `NOT RUN` döndü. |
| `npm test` | **OK** — build, 6/6 Node testi ve 1/1 Python testi geçti. |
| `npm run lint` | **OK**. |
| `npx tsc --noEmit` | **OK**. |
| `python -m unittest discover -s tests -p "test_p0_fix.py"` | **OK** — 1 test geçti. |
| `python -m py_compile scripts/local_setup_bridge.py scripts/telegram_long_poll.py scripts/telegram_user_long_poll.py scripts/telegram_user_session.py scripts/configure_telegram_user_listener.py` | **OK**. |
| `npm run start` + `GET http://127.0.0.1:3101/` | **OK** — HTTP 200. |

### Git checkpoints

- `1b4d2ee` — temp root/cleanup ve Ubuntu awk uyumluluğu.
- `0050bf8` — web readiness, stop/start failure ve readiness failure harness senaryoları.

### Kalan blokaj

FIX-05 build düzeltmesi review'a hazırdır; ancak fake systemctl harness'ı gerçek systemd kanıtı değildir. Fresh Linux/systemd/Telegram/WAL saha retesti olmadan genel teslim durumu BLOCKED kalır.

STATUS: READY_FOR_REVIEW

## FIX-06 — Restore harness kapsamı — 2026-08-03

### Kritik sorun → düzeltme → tekrar doğrulama

- **MAJOR-01 — active listener recovery eksikti:** Başarı fixture’ı ve stop/start failure fixture’ı başlangıçta web, poller ve listener’ı active yapıyor. Başarı akışı listener stop → start geçişini, final active state’i ve altı komutluk exact log sırasını assert ediyor. Readiness failure fixture’ı listener’ı inactive bırakıyor ve restore sonrası hâlâ inactive olduğunu ayrıca doğruluyor.
- **MAJOR-02 — gerçek WAL/sidecar kanıtı eksikti:** Sentetik `printf` sidecar’lar kaldırıldı. Source ve destination SQLite fixture’ları `journal_mode=WAL` kullanıyor; destination gerçek `-wal`/`-shm` dosyalarını kontrollü ayrı Python writer process’i üretiyor. Restore sonrası sidecar backup dizini, iki dosyanın isimleri, WAL SHA-256, SHM boyut/non-empty içeriği, destination yanında sidecar kalmaması, `integrity_check`, WAL journal mode ve kayıt count/body doğrulanıyor.
- **Kapsam sınırı:** Writer process restore sırasında yeni veri yazmıyor; eşzamanlı canlı writer/restore ve ayrı-host restore gerçek Linux E2E kanıtıdır ve bu harness’ta açıkça `NOT RUN` bırakıldı.

### TDD kanıtı

- **RED:** Yeni active-listener/log ve gerçek-WAL assertion’ları eklendikten sonra eski harness WSL Ubuntu’da `Previously active listener was not restored to active` ile beklenen non-zero sonucu verdi.
- **GREEN:** Fixture üretimi ve assertions tamamlandıktan sonra aynı WSL Ubuntu harness’ı final `PASS` verdi; stop failure, start failure ve readiness failure dalları da beklenen non-zero sonuçları korudu.

### Verification

| Komut | Sonuç |
|---|---|
| `wsl.exe -d Ubuntu -- bash -lc "cd /mnt/c/Users/aturk/telegram-support-hub && bash tests/restore-relaydesk.integration.sh"` (assertion eklenmiş eski fixture) | **RED** — active listener recovery assertion’ı beklenen şekilde fail oldu. |
| Aynı WSL Ubuntu harness komutu (FIX-06 sonrası) | **GREEN** — gerçek SQLite WAL/SHM, sidecar preservation, integrity/count, active listener recovery, inactive listener koruması ve failure cases; final `PASS`. |
| `wsl.exe -d Ubuntu -- bash -lc "... bash -n deploy/*.sh tests/restore-relaydesk.integration.sh"` | **OK**. |
| `& "C:\Program Files\Git\bin\bash.exe" -n deploy/*.sh tests/restore-relaydesk.integration.sh` | **OK**. |
| `& "C:\Program Files\Git\bin\bash.exe" tests/restore-relaydesk.integration.sh` | **NOT RUN** — Windows/Linux guard. |
| `npm test` | **OK** — build + 6/6 Node testi + 1/1 Python testi. |
| `npm run lint` | **OK**. |
| `npx tsc --noEmit` | **OK**. |
| `python -m py_compile scripts/local_setup_bridge.py scripts/telegram_long_poll.py scripts/telegram_user_long_poll.py scripts/telegram_user_session.py scripts/configure_telegram_user_listener.py` | **OK**. |
| `npm run build` + `npm run start` + `GET http://127.0.0.1:3107/` | **OK** — HTTP 200. |

### Checkpoint

- `a98b052` — `Expand restore harness WAL and listener coverage`.

### Known gaps

- Fresh systemd/Telegram/ayrı-host restore, gerçek concurrent WAL writer/restore, `systemd-analyze` ve production servis geçişleri **NOT RUN**; WSL fake-systemctl harness production evidence yerine geçmez.
- `ai-memory/review/qa.md` bu turda değiştirilmedi; Selim’in yeniden review’ı bekleniyor.
- Backup klasörleri ve secret’lara dokunulmadı. P1/P2/P3 başlatılmadı.

STATUS: READY_FOR_REVIEW
