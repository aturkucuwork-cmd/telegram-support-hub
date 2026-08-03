---
tags: [progress, relaydesk]
---

# İlerleme

## Son durum

- RelayDesk yerelde `http://localhost:3000` adresinde çalışıyor.
- Sites projesi aktif ve özel erişim politikasıyla yayınlanmış durumda.
- Ajans sistemi v1.1.0 proje köküne entegre edildi.

## Son yapılanlar

- 2026-07-31: Ajans ajanları, workflow skill'leri ve çoklu araç talimatları proje köküne kuruldu.
- 2026-07-31: Kalıcı `ai-memory` proje hafızası başlatıldı.
- 2026-07-31: 10 ajan, 3 skill, yapılandırma frontmatter'ları, lint ve yerel HTTP yanıtı başarıyla doğrulandı.
- 2026-08-03: Linux/self-host production-readiness ops audit'i tamamlandı; kritik operasyon bulguları `ai-memory/review/ops-audit.md` içine kanıtlarıyla yazıldı.
- 2026-08-03: Genel uygulama denetimi tamamlandı; auth, API, Telegram, test, erişilebilirlik ve operasyon eksikleri `ai-memory/review/general-audit.md` içine yazıldı. Final kalite checklist'i kritik bulgular nedeniyle BLOCKED.
- 2026-08-03: Denetim bulguları P0-P3 remediation planına dönüştürüldü; uygulama başlamadı, kapsam genişlemeleri karar kaydına işlendi.

## Blokajlar

- Üretim ortamında `TELEGRAM_BOT_TOKEN` tanımlı görünmüyor; canlı Telegram işlevleri bu değer tamamlanmadan çalışmayabilir.
- Production teslimi; kritik self-host ve güvenlik bulguları düzeltilip fresh Linux/systemd E2E doğrulaması tamamlanana kadar bloklu.
- P0 QA review'unda dört kritik regresyon bulundu; Mert fix turu açıldı (`ai-memory/build/fix-brief.md`).

## Sonraki adımlar

- Yeni geliştirme brief'ini Ajans workflow'u üzerinden başlatmak
- Üretim Telegram yapılandırmasını tamamlayıp webhook smoke testi yapmak
- Bot API poller/env/bridge/servis hesabı/backup kritiklerinin Linux E2E retestini yapmak ve yeniden review almak
- P1/P2/P3 remediation paketlerini kullanıcı onayı ve ayrı Change Request kapsamına göre planlamak

## 2026-08-03 P0 remediation

- Kullanıcı backup doğrulamasından sonra P0 remediation için açık onay verdi; backup klasörüne dokunulmadı.
- P0.1-P0.6 kod paketleri uygulandı: Bot API poller, tek env, system-level fresh-host provision, iki-port bridge dokümantasyonu, health/internal status ve SQLite backup/restore.
- Dört atomik Git checkpoint oluşturuldu: `286539f`, `cd77ad1`, `d4de01b`, `4d1fa8d`.
- Build/test/lint/typecheck/Python syntax/shell syntax ve local health/status smoke geçti.
- Selim bağımsız P0 QA/security/a11y review'ını tamamladı; setup wizard restart bug'ı, inactive poller start akışı, restore servis/WAL riskleri ve eksik Linux E2E kanıtı nedeniyle `ai-memory/review/qa.md` BLOCKED olarak yazıldı.
- P0 QA fix loop tamamlandı: bridge NameError/2xx regression, failed poller restart modeli/allowlist ve fail-closed WAL/SHM restore servis recovery düzeltildi; checkpoint commitleri `38b119e` ve `f111484`.
- Fix doğrulaması build/test/lint/typecheck/Python/shell syntax ve local HTTP smoke ile geçti; Linux systemd/Telegram/WAL gerçek E2E kanıtı Windows ortamı nedeniyle açık kaldı.
- 2026-08-03: FIX-05 uygulandı; `tmp_root`/cleanup trap ve Ubuntu awk uyumluluğu düzeltildi. WSL Ubuntu harness PASS verdi; web readiness, stop failure, start failure, readiness failure ve WAL/SHM akışları doğrulandı. Checkpoint'ler `1b4d2ee`, `0050bf8`.
- 2026-08-03: FIX-06 uygulandı; restore harness active listener stop/start recovery + exact log order, inactive listener case, gerçek SQLite WAL/SHM fixture, sidecar backup isim/içerik, integrity/count ve destination cleanup assertions ile genişletildi. WSL Ubuntu final PASS; checkpoint `a98b052`.

## Güncel blokajlar

- Gerçek Linux systemd/fresh-host/Telegram/WAL restore E2E doğrulaması bu Windows ortamında yapılamadı; WSL fake-systemctl harness'ı geçti, gerçek saha retesti bekliyor.
- P0 CRITICAL-05 evidence gate açık: Selim’in Linux saha retest’i olmadan production delivery yapılmayacak.
- FIX-05 harness başlatma bulgusu kapandı; gerçek systemd/fresh-host/Telegram/WAL evidence gate açık.
- FIX-06 MAJOR-01/02 harness kapsamı Selim QA retestinde kapandı; gerçek Linux concurrent/ayrı-host evidence gate’i açık.
- P1/P2/P3 paketleri bilinçli olarak başlatılmadı.

## 2026-08-03 — Eşzamanlı ikinci oturumdan bulunan yeni CRITICAL bug (düzeltildi)

- Ayrı bir konuşma/oturumda (RelayDesk Linux self-host araştırması sırasında) `deploy/relaydesk-setup-bridge.service`'te `NoNewPrivileges=true` bulundu — bu, bridge'in `local_setup_bridge.py` içindeki `sudo -n systemctl restart/start ...` çağrılarını (restart_managed_services, start_user_listener) gerçek bir Linux'ta **her zaman** başarısız kılıyordu, çünkü `NoNewPrivileges` sudo'nun setuid-root bitini geçersiz kılıyor. `relaydesk-sudoers`'daki NOPASSWD kuralları doğru olsa bile setup sihirbazının en kritik iki adımı (token kaydından sonra servis restart, Telegram girişinden sonra dinleyici başlatma) çökerdi. Diğer üç servis (`relaydesk-web`, `relaydesk-telegram-poller`, `relaydesk-listener`) sudo çağırmadığı için onlarda sorun yok, dokunulmadı.
- Düzeltme: `deploy/relaydesk-setup-bridge.service`'ten yalnızca `NoNewPrivileges=true` satırı kaldırıldı; diğer sertleştirme direktifleri (`PrivateTmp`, `ProtectHome`, `ReadWritePaths`) korundu.
- Bu bulgu `ai-memory/review/qa.md`/`general-audit.md`/`ops-audit.md`'de henüz yoktu; Selim'in bir sonraki review turunda dahil edilmesi gerekiyor.

## 2026-08-03 — GERÇEK Linux/systemd üzerinde kısmi CRITICAL-05 kanıtı (WSL2 Ubuntu 24.04, gerçek systemd PID 1, gerçek sudo)

Önceki tüm doğrulamalar Windows'ta veya WSL'de "fake systemctl" mock'uyla yapılmıştı — bu ilk kez **gerçek systemd + gerçek sudo** üzerinde çalıştırıldı (WSL2 Ubuntu 24.04, `/etc/wsl.conf`'ta `systemd=true`, PID 1 = systemd). Bu, CRITICAL-05'in tamamını kapatmaz (fresh cloud VM/reboot/gerçek Telegram hesabı/ayrı-host restore hâlâ NOT RUN) ama önemli bir alt kümesini gerçek kanıtla kapatır:

**Doğrulanan (PASS):**
- `npm install` + `npm run build` gerçek Linux'ta, native `better-sqlite3` derlemesiyle başarılı (build-essential/python3-dev sonrası).
- `provision-relaydesk.sh` uçtan uca çalıştı (düzeltmelerden sonra, aşağıya bakın): relaydesk kullanıcı/grup, `/opt/relaydesk` + `/var/lib/relaydesk` izinleri, `.venv` + pip install, 6 systemd unit + sudoers kurulumu.
- `systemd-analyze verify` 6 unit için de **0 hata**.
- `relaydesk-web.service` gerçekten `systemctl start` ile ayağa kalktı; `GET /api/healthz` → 200 `{"ok":true,"ready":true}`; `GET /api/status` (auth'suz) → 401 (doğru).
- **NoNewPrivileges/sudo fix'i doğrudan kanıtlandı:** `systemd-run --property=NoNewPrivileges=yes -- sudo -n systemctl restart relaydesk-web.service` → **status 1**, hata: `sudo: The "no new privileges" flag is set, which prevents sudo from running as root.` Aynı komut `NoNewPrivileges` olmadan (düzeltilmiş `relaydesk-setup-bridge.service` haliyle) → **status 0**, servis gerçekten restart oldu. Bu, bugünkü NoNewPrivileges düzeltmesinin gerçek bir Linux'ta gerçekten gerekli ve doğru olduğunu kanıtlıyor.
- `relaydesk-listener.service`, session dosyası yokken `ConditionPathExists` ile doğru şekilde başlamıyor (tasarım gereği).
- `relaydesk-backup.timer` doğru zamanlamayla enable oldu.

**Bu turda bulunan ve düzeltilen 2 YENİ gerçek bug (ilk kez gerçek Linux'ta ortaya çıktı):**
1. **`provision-relaydesk.sh`: `.env.local` sahipliği bug'ı.** Script önce `.env.local`'i `relaydesk:relaydesk` yapıyor, sonra bir Python bloğuyla dosyayı atomic-replace ile yeniden yazıyor (yeni inode, root olarak oluşturulduğu için root:root sahipli oluyor) — sonraki `runuser -u relaydesk -- npm ci`/`build` adımları bu yüzden `.env.local`'i okuyamayıp `EACCES` ile çöküyordu. Düzeltme: Python bloğundan hemen sonra `chown relaydesk:relaydesk "$env_path"` eklendi.
2. **`provision-relaydesk.sh`: eksik `python3-venv` ön koşul kontrolü.** Taze Ubuntu (bu WSL dahil) `python3-venv`/`ensurepip`'i öntanımlı kurmuyor; `python3 -m venv` sessizce yarım bir venv (pip'siz) üretiyor, sonraki adımlar anlaşılmaz şekilde çöküyordu. Düzeltme: script başına `python3 -c "import ensurepip"` kontrolü eklendi, eksikse net bir hata + `apt install python3-venv` talimatıyla erken çıkıyor.

**Test ortamı notu:** Gerçek `TELEGRAM_BOT_TOKEN` kullanılmadı (sahte/test değerleri üretildi) — `relaydesk-telegram-poller.service` bu yüzden beklenen şekilde "Unauthorized: invalid token specified" ile crash-loop yapıp `StartLimitBurst`'e takıldı; bu bir bug değil, geçersiz kimlik bilgisiyle doğru davranış. Gerçek bot token'ıyla ayrıca test edilmedi.

**Hâlâ NOT RUN kalan CRITICAL-05 alt maddeleri:** fresh cloud VM (WSL paylaşılan çekirdek kullanıyor, gerçek izole bir host değil), reboot/logout kalıcılığı, gerçek Telegram hesabıyla `getUpdates`/MTProto login akışı, SSH tüneliyle setup wizard, eşzamanlı WAL restore, ayrı-host restore.
