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

STATUS: READY_FOR_REVIEW
