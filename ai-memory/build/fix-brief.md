# Mert Fix Brief — P0 QA Kritik Bulguları

**Tarih:** 2026-08-03  
**Kaynak:** `ai-memory/review/qa.md`  
**Kapsam:** Yalnız P0 remediation regresyon düzeltmeleri. P1/P2/P3 başlatılmayacak.

## FIX-01 — Setup bridge `NameError`

- Kanıt: `scripts/local_setup_bridge.py:107-126,182-189`.
- `restart_managed_services()` içinde tanımsız `temporary.replace(ENV_PATH)` var.
- `update_env()` atomic replace sorumluluğunu zaten tamamlıyor.
- Düzelt: Tanımsız satırı kaldır; `/bot-config` başarı sonrası 2xx dönecek gerçek bridge regression testi ekle.

## FIX-02 — Poller inactive/failed durumda başlamıyor

- Kanıt: `scripts/local_setup_bridge.py:107-124`, `deploy/relaydesk-sudoers:4-6`.
- Boş env ile bootstrap poller'ı failed yapabiliyor; `try-restart` inactive unit'i başlatmıyor.
- Düzelt: Güvenli `restart` veya `start` akışı seç; sudoers allowlist'i güncelle. Token wizard sonrası poller active olmalı.

## FIX-03 — Restore sonrası servisler kapalı kalabiliyor

- Kanıt: `deploy/restore-relaydesk.sh:34-41,51`.
- Başarılı restore'da servisleri geri başlatma yolu devre dışı kalıyor; start hataları yutuluyor.
- Düzelt: Önceden active olan servisleri her çıkış yolunda geri başlat; hataları non-zero döndür; restore sonrası readiness kontrolü ekle.

## FIX-04 — WAL/SHM restore güvenliği

- Kanıt: `db/index.ts:11-15`, `deploy/restore-relaydesk.sh:43-49`.
- Ana SQLite dosyası değiştirilirken mevcut `-wal`/`-shm` yan dosyaları yönetilmiyor.
- Düzelt: Servislerin gerçekten durduğunu doğrula; eski yan dosyaları güvenli şekilde backup'la/temizle; restore sonrası integrity check ve smoke çalıştır.

## FIX-05 — Restore integration harness başlatılamıyor

- Kanıt: `tests/restore-relaydesk.integration.sh:15-19`; `set -u` açıkken `tmp_root` oluşturulmadan kullanılıyor.
- Düzelt: `mktemp -d` ile güvenli temp root oluştur, cleanup trap ekle; harness'ın Linux'ta çalışabilir olduğunu shell syntax dışında doğrula.
- Harness web active/readiness ve stop/start failure senaryolarını gerçekten kapsamalı; Linux-only sonuçlar Windows'ta çalıştırılmış gibi raporlanmamalı.

## FIX-06 — Restore harness kapsamı eksik

- `tests/restore-relaydesk.integration.sh` en az bir fixture'da listener'ı başlangıçta active yapıp stop/start recovery ve final active state'i assert etmeli; inactive listener senaryosu da korunmalı.
- Sentetik metin `-wal/-shm` dosyaları yerine gerçek SQLite WAL fixture ve mümkünse canlı writer kullanılmalı; sidecar backup dizini, taşınan dosya içerikleri, integrity/count ve destination temizliği assert edilmeli.
- Gerçek concurrent writer ve ayrı-host restore Linux E2E kanıtıdır; Windows/WSL harness bunu production kanıtı olarak göstermemeli.

## Zorunlu doğrulama

- Önce testlerin RED olduğunu göster, sonra düzelt.
- `npm test`, `npm run lint`, `npx tsc --noEmit`, Python compile ve `bash -n` çalıştır.
- Linux-only kontrolleri açıkça `NOT RUN` olarak kaydet.
- Yalnız fix dosyalarını stage et; mevcut eski uncommitted değişiklikleri stage etme.
- Düzeltme sonrası checkpoint commit oluştur.
- `ai-memory/build/fix-notes.md` ve `ai-memory/build/notes.md` sonuçlarını güncelle.

STATUS: BLOCKED
