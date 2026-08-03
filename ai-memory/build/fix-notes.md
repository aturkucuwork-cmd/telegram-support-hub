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
