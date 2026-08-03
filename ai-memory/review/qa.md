# P0 Linux Remediation — Fix Loop Sonrası QA Retesti

**Rol:** Selim — Yazılım Uzmanı / Mimar  
**Tarih:** 2026-08-03  
**Önceki fix commitleri:** `38b119e`, `f111484`, `3e78c14`  
**Kapsam:** Yalnız CRITICAL-01..05 ile ilişkili bridge, poller/restart/sudoers, restore/WAL, yeni bridge HTTP testi, P0 kabul kriterleri ve Linux evidence. P1/P2/P3 HIGH bulguları yeniden uygulanmadı.

## Kanıt standardı ve komut sonuçları

- `python -m unittest discover -s tests -p "test_p0_fix.py"` → **OK**, 1 test geçti; gerçek `ThreadingHTTPServer` ve gerçek HTTP client kullanılıyor, `systemctl`/Bot API davranışı mock.
- `npm test` → **OK**, build + 6/6 Node testi + 1/1 Python testi geçti.
- `npm run lint` → **OK**.
- `npx tsc --noEmit` → **OK**.
- `python -m py_compile scripts/local_setup_bridge.py scripts/telegram_long_poll.py scripts/telegram_user_long_poll.py scripts/telegram_user_session.py scripts/configure_telegram_user_listener.py` → **OK**; yalnız syntax/bytecode kanıtıdır.
- Git Bash `bash -n deploy/*.sh tests/restore-relaydesk.integration.sh` → **OK**; shell runtime/systemd kanıtı değildir.
- `bash tests/restore-relaydesk.integration.sh` → **NOT RUN**, Windows host; test Linux/systemd semantiği ve root istiyor.
- Linux `systemd-analyze verify/security`, gerçek `systemctl`, fresh-host provision, reboot/logout, Bot API `getUpdates` → SQLite, setup wizard SSH akışı ve concurrent/ayrı-host WAL restore → **NOT RUN**.

## CRITICAL-01..04 kapanış durumu

| Bulgu | Retest sonucu | Kalan kanıt sınırı |
|---|---|---|
| **CRITICAL-01 — bridge `/bot-config` 500** | **Kod düzeyinde ve yerel gerçek HTTP testiyle kapandı.** `scripts/local_setup_bridge.py:107-125` tanımsız `temporary.replace(...)` içermiyor; `:611-613` handler’ı `configure_bot()` sonucunu 200 ile döndürüyor. `tests/test_p0_fix.py:54-70` gerçek HTTP isteğiyle 2xx, `:76-86` env token yazımını ve üç restart çağrısını doğruluyor. | Linux unit altında gerçek sudo/systemd restart ve gerçek Bot API çalıştırılmadı. |
| **CRITICAL-02 — failed/inactive poller başlamıyor** | **Kod düzeyinde ve davranış double’ı ile kapandı.** `scripts/local_setup_bridge.py:111-118` `systemctl restart` kullanıyor; `deploy/relaydesk-sudoers:3-6` listener `start` ve web/poller/listener için exact `restart` imzalarını içeriyor. Testte `tests/test_p0_fix.py:27-38,76-86` failed poller active duruma taşınıyor ve command listesi doğrulanıyor. `systemctl restart` inactive/failed unit’i başlatma semantiğine uygundur. | Gerçek Linux systemd failed/inactive transition, token rotasyonu ve gerçek Telegram `getUpdates` → SQLite akışı çalıştırılmadı. |
| **CRITICAL-03 — restore sonrası servis recovery yok** | **Kod kontratı düzeyinde kapandı.** `deploy/restore-relaydesk.sh:44-59` önceki active servisleri ayırıyor; `:75-118` EXIT trap ile yalnız önceki active servisleri başlatıyor, `is-active` ve web readiness hatalarını non-zero yapıyor; `:122-131` stop başarısızlığını doğruluyor. `|| true` yok. | Linux runtime’da stop/start/readiness hata yolları çalıştırılmadı; mevcut harness web’i inactive başlattığı için readiness dalını doğrulamıyor (bkz. MAJOR-01 ve HIGH-04). |
| **CRITICAL-04 — WAL/SHM restore güvenliği yok** | **Kod kontratı düzeyinde kapandı.** `deploy/restore-relaydesk.sh:140-175` aday DB için integrity/count/smoke kontrolü yapıyor; `:177-197` mevcut `-wal`/`-shm` dosyalarını timestamp’li restore-sidecar klasörüne taşıyıp ana DB’yi ancak sonrasında atomik olarak değiştiriyor; rollback yolu var. | Linux WAL yazıcısı altında gerçek restore ve ayrı-host restore çalıştırılmadı. Harness mevcut haliyle çalıştırılamıyor (MAJOR-01). |

CRITICAL-01..04 için fix kodunda önceki bulguları yeniden üreten bir statik/yerel hata yok. Bunların **production kanıtı** ise aşağıdaki CRITICAL-05 evidence gate nedeniyle tamamlanmış sayılmaz.

## Yeni bulgu

### MAJOR-01 — Linux restore integration harness’ı `tmp_root` tanımsız olduğu için başlatılamıyor

- **Dosya:satır:** `tests/restore-relaydesk.integration.sh:15-19`; `tmp_root` oluşturulmadan `source_path="$tmp_root/source.sqlite"` ve diğer yollar kullanılıyor. Dosyanın başında `set -u` (`:4`) etkin.
- **Kanıt/davranış:** Windows çalıştırması Linux koşulunda olmadığı için `NOT RUN` döndü; statik akışta Linux dalına girildiğinde tanımsız değişken kullanımı `set -u` nedeniyle test setup’ından önce non-zero sonlanır. `mktemp -d` ile `tmp_root` oluşturulmadığından `f111484` ile eklenen gerçek restore harness’ı hazır olsa da çalıştırılabilir kanıt değildir.
- **Etki:** P0.6 restore servis recovery, WAL/SHM izolasyonu ve integrity smoke kabulü Linux’ta ölçülemiyor; CRITICAL-03/04’ün runtime kapanışı ve CRITICAL-05 evidence gate gecikiyor. Bu production runtime kodunda kanıtlanmış bir veri kaybı değildir, fakat teslim kanıt zincirini kırar.
- **Öneri:** Mert, `tests/restore-relaydesk.integration.sh:15-19` öncesinde güvenli `mktemp -d` setup’ı ve cleanup trap’i eklemeli; ardından Linux root/CI job’ında testin gerçekten PASS çıktısını, servis failure/readiness negatif senaryolarını ve WAL/SHM sonuçlarını kaydetmeli.

## Etkilenen akışların yeniden denetimi

### Setup bridge, bot-config 2xx ve servis restart

- `scripts/local_setup_bridge.py:81-104` env yazımını 0600 temp dosya + atomic replace ile yapıyor; `:107-125` Linux’ta üç managed unit için `sudo -n systemctl restart` çağırıyor.
- `scripts/local_setup_bridge.py:170-202` token doğrulama, Bot API `getMe`/`deleteWebhook`, env güncelleme ve restart sırasını koruyor. Restart başarısızlığı 503 olarak görünür hale geliyor; sessiz başarı raporlanmıyor.
- `tests/test_p0_fix.py:54-86` gerçek loopback HTTP handler’ını çalıştırıyor ve `/bot-config` 2xx, token yazımı, failed poller state transition double’ı ve exact command listesini doğruluyor.
- Test **gerçek bridge HTTP kapsamına** sahiptir; fakat `telegram_bot_api` ve `subprocess.run` mock olduğu için gerçek Telegram, sudoers parse ve systemd state transition kanıtı değildir. Unauthorized/invalid token, restart’ın ortasında kısmi başarısızlık ve env permission/owner negatif testleri de kapsam dışıdır.

### Poller inactive/failed → token sonrası start/restart ve sudoers

- `deploy/relaydesk-sudoers:3-6` allowlist’i bridge’in kullandığı exact komutlarla eşleşiyor: listener için `start`, web/poller/listener için `restart`; wildcard veya genel shell yetkisi yok.
- `deploy/relaydesk-bootstrap.sh:14-18` web ve poller’ı `enable --now`, listener’ı `enable` ediyor. Boş token ile poller fail olduktan sonra bridge’in `restart` çağrısı inactive/failed unit’i yeniden başlatmayı hedefliyor.
- `deploy/relaydesk-telegram-poller.service:11-21` system-level `User=relaydesk`, `.env.local`, `Restart=on-failure` ve web dependency’sini tanımlıyor.
- Linux’ta `visudo`, `systemd-analyze`, failed/inactive unit transition ve gerçek token sonrası `is-active` sonucu alınmadı. Bu nedenle kod uyumu **kısmi**, production kabulü tamamlanmış değildir.

### Restore servis recovery, fail-closed ve WAL/SHM

- `deploy/restore-relaydesk.sh:44-59` unknown service states için fail-closed davranıyor; yalnız önceden active unit’leri restore ediyor.
- `:75-118` EXIT trap start, `is-active` ve web `/api/healthz` readiness başarısızlıklarını non-zero’a çeviriyor.
- `:122-131` service stop doğrulaması, `:140-175` candidate integrity/count/smoke, `:177-197` sidecar taşıma/rollback ve atomik DB replacement akışını kuruyor.
- `tests/rendered-html.test.mjs:153-164` yalnız regex/absence kontrolüdür. `tests/restore-relaydesk.integration.sh:38-39,137-148` success state’i ve poller stop/start’ı hedefliyor; web active/readiness ve stop/start failure dallarını çalıştırmıyor. Ayrıca MAJOR-01 nedeniyle harness Linux’ta fiilen çalıştırılmamıştır.

## P0 kabul kriterleri ve evidence durumu

| P0 kriteri | Sonuç |
|---|---|
| **P0.1 Bot API poller:** reboot sonrası active, webhook durumu ve gerçek private/business mesajın SQLite’a yazılması | **PARTIAL/BLOCKED:** unit/bootstrap kodu var; Linux reboot, `getWebhookInfo`, gerçek `getUpdates` → SQLite kanıtı yok. |
| **P0.2 Tek env ve wizard sonrası servis restart** | **PARTIAL:** bridge atomic env + exact restart kodu ve yerel HTTP testi var; Linux `EnvironmentFile`, restart sonrası kalıcılık ve tüm servislerin active kanıtı yok. |
| **P0.3 Fresh Linux provision/systemd/izinler** | **NOT EVIDENCED:** Windows’ta provision, ownership, `systemd-analyze verify/security`, reboot/logout çalıştırılmadı. |
| **P0.4 SSH üzerinden iki-port setup wizard** | **NOT EVIDENCED:** dokümantasyon ve loopback bridge var; uzak browser’da status, bot config, Telegram login ve listener start uçtan uca denenmedi. |
| **P0.5 Health/readiness/history** | **LOCAL ONLY:** local HTTP/build smoke mevcut; Linux bootstrap ve restore sonrası readiness runtime sonucu yok. |
| **P0.6 Backup/restore/WAL ve ayrı-host restore** | **NOT EVIDENCED:** script kontratı ve statik test var; Linux harness çalıştırılmadı, concurrent writer ve ayrı-host tatbikatı yok. |

### CRITICAL-05 — Linux evidence gate açık

- **Dosya/kanıt:** `ai-memory/plan.md:25,44,52,69`, `ai-memory/build/notes.md:151-154`, `ai-memory/build/fix-notes.md:45-49`.
- **Etki:** Windows üzerindeki build, syntax, local HTTP ve mock state testleri Linux systemd, gerçek Telegram ingestion, file ownership/permission, reboot kalıcılığı veya concurrent WAL restore’u kanıtlamıyor. P0 acceptance ve Evidence Standard gereği production readiness kararı verilemez.
- **Öneri:** Temiz Debian/Ubuntu hostta provision + `systemd-analyze verify/security`, boş env → failed poller → token wizard → `is-active` → gerçek Bot API/SQLite, iki-port SSH wizard, active web readiness restore failure cases, concurrent WAL restore ve ayrı-host restore çalıştırılmalı; komut çıktıları acceptance checklist’e eklenmeli. Önce MAJOR-01 test harness’ı düzeltilmeli.

Bu, **Linux evidence gap olarak ayrı bir delivery blocker’dır**; Windows’ta çalışmayan Linux-only kontroller başarılı kabul edilmemiştir.

## Mevcut HIGH bulgularının fix loop kapsamı

- **HIGH-01 internal API credential ayrımı:** Fix brief’te yok; `app/api/telegram/import`, `app/api/telegram/user-listener`, `app/api/telegram/folders` ve ilgili auth modeli bu loop’ta değiştirilmedi. **Açık.**
- **HIGH-02 token argv/env izinleri ve hardcoded allowlist:** Fix brief’te yok; `deploy/configure-local-telegram.sh` bu loop’un değişen dosyaları arasında değil. **Açık.**
- **HIGH-03 systemd/provision hardening:** Fix brief’te yok; `ProtectSystem`/least-privilege/systemd security çalışması bu loop’a alınmadı. **Açık.**
- **HIGH-04 gerçek runtime test eksikliği:** **Kapatılmadı.** `tests/test_p0_fix.py` yalnız bridge handler için gerçek HTTP + mock dependency kapsamı ekliyor; restore harness’ı fake `systemctl` kullanıyor ve Linux’ta çalıştırılmadı. Bu nedenle HIGH-04 yalnızca bridge alt alanında kısmen iyileşti, P0 runtime test açığını kapatmıyor.

P1/P2/P3 ve mevcut HIGH bulguları yanlışlıkla fix loop’a dahil edilmemiştir; `3e78c14` yalnız build/review kanıt dokümantasyonudur.

## Güvenlik ve erişilebilirlik kontrolü — etkilenen alanlar

- **Sudo yetkisi:** `deploy/relaydesk-sudoers:3-6` exact command allowlist kullanıyor; genel `systemctl` veya shell yetkisi görünmüyor. Linux `visudo -cf` çalıştırılmadı.
- **Secret:** Production fix dosyalarında gerçek API key/password hardcode edilmemiş; bridge token’ı env dosyasına atomic/0600 yazar. Test token’ı yalnız `tests/test_p0_fix.py:60` içinde sentetik regresyon verisidir. HIGH-02 kapsamındaki standalone script riski bu loop’ta çözülmedi.
- **SQL/restore input:** `deploy/restore-relaydesk.sh:145-153` tablo adlarını SQLite schema’dan alıp quote ediyor; request girdisinin SQL’e birleştirildiği yeni bir yol görülmedi. `PRAGMA integrity_check`/count kontrolleri mevcut.
- **XSS/A11y:** Bu fix loop’ta UI/HTML bileşeni değiştirilmedi; bridge ve shell akışlarında yeni XSS veya form erişilebilirliği yüzeyi yok. Önceki modal WCAG bulguları bu loop’un dışında kaldı.

## Retest notes

1. MAJOR-01 düzeltildikten sonra gerçek Linux restore harness’ını çalıştır; web active/readiness ve stop/start failure senaryolarını ayrıca zorla.
2. CRITICAL-01/02 için Linux bridge service altında `/bot-config` 2xx, `.env.local` mode/owner, `systemctl is-active` ve gerçek Bot API transition kanıtını al.
3. CRITICAL-03/04 için active web/poller/listener restore, readiness failure, stop failure, WAL/SHM taşıma, integrity/count ve concurrent writer sonuçlarını kaydet.
4. CRITICAL-05 için fresh Debian/Ubuntu provision, reboot/logout/network restart, SSH iki-port wizard, gerçek Telegram ingestion ve ayrı-host restore acceptance çıktısını ekle.
5. HIGH-01..04 için ayrı P1/P3 fix loop planı ve test kapsamı korunmalı; bu P0 loop tamamlandı olarak işaretlenmemeli.

STATUS: BLOCKED

## FIX-06 / a98b052 + d9f47ba — Son harness QA yeniden denetimi — 2026-08-03

**Rol:** Selim — Yazılım Uzmanı / Mimar  
**Kapsam:** Yalnız MAJOR-01/02, CRITICAL-01..05 regresyonu, WSL harness kanıt sınırı ve son fix dokümantasyonu. Uygulama kodu değiştirilmedi.

### Kanıt standardı ve çalıştırılan komutlar

- `git show a98b052` → yalnız `tests/restore-relaydesk.integration.sh` değişmiş; `git show d9f47ba` → yalnız build/progress/task dokümantasyonu değişmiş. CRITICAL-01..04 runtime dosyalarında bu iki commit sonrası değişiklik yok.
- `wsl.exe -d Ubuntu -- bash -lc "cd /mnt/c/Users/aturk/telegram-support-hub && bash tests/restore-relaydesk.integration.sh"` → **PASS**; gerçek SQLite fixture, beklenen stop/start/readiness failure sonuçları ve final PASS çıktısı alındı.
- Aynı WSL komutuyla `bash -n tests/restore-relaydesk.integration.sh deploy/restore-relaydesk.sh` → **OK**.
- `python -m unittest discover -s tests -p "test_p0_fix.py"` → **OK**, 1 test.
- `npm test` → **OK**, build + 6/6 Node testi + 1/1 Python testi.
- `npm run lint` → **OK**; `npx tsc --noEmit` → **OK**.
- WSL kontrolünde `uname -s=Linux`, `id -u=0`, `systemctl is-system-running=running` görüldü; fakat harness çağrısı `PATH` başına kendi fake binary dizinini koyduğu için restore sırasında gerçek `systemctl` kullanılmadı.

### MAJOR bulguları

#### MAJOR-01 — Active listener recovery kapsamı: KAPANDI (WSL/fake-systemctl harness kapsamı)

- **Dosya/davranış:** `tests/restore-relaydesk.integration.sh:87` ana fixture’ı web, poller ve listener’ı `active` başlatıyor. `:242-249` restore akışını çalıştırıyor; `:255-264` üç servisin final active durumunu ve altı komutluk stop/start sırasını assert ediyor.
- **Kanıt:** Bağımsız WSL çalıştırması final `PASS` verdi. `:326-333` poller start failure sırasında listener recovery’yi de kontrol ediyor; bu senaryo beklenen non-zero ile tamamlanıyor.
- **Inactive listener korunması:** `:335-344` readiness-failure fixture’ı listener’ı `inactive` başlatıyor ve restore sonrası hâlâ `inactive` olduğunu assert ediyor. Listener’ın önceden inactive olduğu durumda başlatıldığına dair false positive görülmedi.
- **Sınır:** Inactive listener için temiz, başarılı restore case’i yok; mevcut assertion readiness-failure case’inde çalışıyor. Bu, production davranış kanıtını genişletmeyen küçük test kapsamı eksikliğidir; MAJOR-01’i harness seviyesinde yeniden açmaz.

#### MAJOR-02 — Gerçek SQLite WAL/SHM sidecar preservation: KAPANDI (WSL harness kapsamı; concurrency hariç)

- **Dosya/davranış:** `tests/restore-relaydesk.integration.sh:51-68` ayrı Python process’i ile `journal_mode=WAL`, `wal_autocheckpoint=0`, gerçek SQLite commit’i ve gerçek `destination.sqlite-wal`/`destination.sqlite-shm` dosyalarını üretir. `:81-86` dosyaların oluştuğunu ve WAL SHA-256 değerini kaydeder.
- **Kanıt:** `:274-294` restore-sidecars dizinini, iki sidecar adını, WAL’ın byte düzeyinde SHA-256 eşleşmesini, SHM’nin aynı boyut ve non-empty olmasını doğruluyor. `:296-307` restored DB için `integrity_check`, kayıt sayısı ve gövdeyi doğruluyor; `:312-315` destination yanında sidecar kalmadığını assert ediyor. WSL çalıştırması bu akışla **PASS** verdi.
- **Önemli sınır:** SHM içeriği byte/hash olarak karşılaştırılmıyor; yalnızca boyut ve non-empty kontrolü var (`:286-289`). Bu nedenle “iki sidecar’ın tam içeriği korundu” iddiası WAL için güçlü, SHM için sınırlıdır. En güçlü kanıt için SHM de `cmp`/SHA-256 ile karşılaştırılmalı; bu kalan küçük assertion iyileştirmesidir.
- Writer process `:65-67` restore sırasında yeni veri yazmıyor. Script son satırda bunu açıkça `NOT RUN` bildiriyor (`:346`). Gerçek concurrent writer/restore ve ayrı-host restore bu harness ile kapanmış değildir.

### Yanlış pozitif ve Linux-only sınırı

- **Fake runtime:** `:89-150` fake `systemctl`, `:177-183` fake `curl`, `:153-175` no-op/eksik izin uygulayan `install` ve `chown`, `:185-189` no-op `sleep` kullanıyor. Bu nedenle PASS; gerçek unit lifecycle, web health endpoint’i, `relaydesk` owner/mode veya readiness süresi kanıtı değildir.
- **Linux-only guard:** `:6-13` Linux/root dışındaki ortamda `NOT RUN` yazıp exit code `0` döndürüyor. CI bunu yalnız exit code ile PASS sayarsa yanlış pozitif oluşur; evidence raporlaması `NOT RUN` çıktısını başarısız/kanıtsız kabul etmelidir. Mevcut Windows ve build notları bunu doğru biçimde `NOT RUN` olarak sınıflandırıyor.
- **Sidecar kapsamı:** Gerçek SQLite WAL/SHM dosyaları üretiliyor; fakat canlı yazıcı ile restore eşzamanlı değil ve temiz başka hostta restore yapılmıyor. Bu iki sınır production evidence kapısına taşınmıştır.

### CRITICAL-01..04 regresyon retesti

| Bulgu | Durum | Kanıt / kabul sınırı |
|---|---|---|
| **CRITICAL-01 — `/bot-config` 500** | **Regresyon yok; mevcut local kapsamda kapalı.** | `a98b052` ve `d9f47ba` bridge koduna dokunmuyor. `python -m unittest discover -s tests -p "test_p0_fix.py"` → 1 test **OK**; gerçek loopback HTTP regression testi önceki kapsamı koruyor. Telegram API ve gerçek sudo/systemd mock olduğu için production E2E değildir. |
| **CRITICAL-02 — failed/inactive poller recovery** | **Regresyon yok; mevcut kod/test-double kapsamda kapalı.** | Son iki commit production bridge/sudoers kodunu değiştirmiyor. `tests/test_p0_fix.py` state transition ve exact restart trace’ini yeniden geçti. Gerçek systemd failed/inactive transition, sudoers parse ve gerçek `getUpdates` → SQLite akışı yok. |
| **CRITICAL-03 — restore service recovery/readiness** | **Regresyon yok; harness kapsamı genişledi, production kanıtı yok.** | `deploy/restore-relaydesk.sh:75-120` recovery/is-active/readiness fail-closed akışı değişmedi. WSL PASS active listener recovery, stop failure, start failure ve readiness failure yollarını çalıştırdı. Fake `systemctl`/`curl` nedeniyle gerçek systemd kanıtı değildir. |
| **CRITICAL-04 — WAL/SHM restore safety** | **Regresyon yok; harness kanıtı iyileşti, production/concurrent kanıtı yok.** | `deploy/restore-relaydesk.sh:140-197` integrity/count/smoke, sidecar taşıma ve atomik replacement değişmedi. WSL PASS gerçek SQLite sidecar üretimi, WAL hash, SHM size/non-empty, sidecar backup ve destination cleanup doğruladı. Concurrent writer, rollback altında gerçek dosya/izin davranışı ve ayrı-host restore çalıştırılmadı. |

Bu nedenle CRITICAL-01..04 için son iki commit sonrasında yeniden üretilen bir runtime regresyonu yoktur; “kapalı” ifadeleri local/WSL harness kapsamı içindir.

### CRITICAL-05 — Fresh Linux/systemd/Telegram/SSH/ayrı-host evidence gate: AÇIK — Critical / BLOCKED

- **Fresh Linux/systemd:** Gerçek fresh Debian/Ubuntu provision, `systemd-analyze verify/security`, gerçek unit ownership/permission, systemd transition, reboot/logout/network recovery kanıtı yok. WSL’de systemd’nin `running` olması ve fake harness PASS’i bu kabul kriterlerinin yerine geçmez.
- **Gerçek Telegram:** Gerçek bot token ile `getWebhookInfo`/`getUpdates`, private/business mesajın poller → API → SQLite zinciri doğrulanmadı.
- **SSH wizard:** Temiz uzak host ve browser üzerinde iki port (`3000` + `8765`) ile status, bot config, Telegram login ve listener start uçtan uca doğrulanmadı.
- **Restore saha kanıtı:** Canlı concurrent WAL writer/restore ve ayrı temiz host restore + integrity/count karşılaştırması yok. `ai-memory/architecture.md:31-35` ve `ai-memory/decisions.md:15` off-host/ayrı-host kapsamının hâlâ TODO olduğunu gösteriyor.
- **Kabul kriteri etkisi:** P0.1, P0.2, P0.3, P0.4 ve P0.6’nın production evidence kutuları tamamlanmış değildir. WSL fake-systemctl PASS yalnız test harness kabulünü kapatır; delivery gate’i kapatmaz.

### Minor / iyileştirmeler

- `tests/restore-relaydesk.integration.sh:286-289` SHM için byte/hash karşılaştırması eklenmeli; mevcut boyut/non-empty assertion gerçek içeriğin değişmediğini tek başına kanıtlamaz.
- `tests/restore-relaydesk.integration.sh:335-344` inactive listener için readiness failure dışı, başarılı restore case’i eklenmeli; böylece “inactive kalmalı” davranışı failure path’e bağlı olmadan ölçülür.
- `:6-13` Linux guard’ın exit `0` ile `NOT RUN` döndürmesi CI entegrasyonunda yanlış pozitif riski taşır; CI evidence parser’ı bu çıktıyı açıkça kanıtsız saymalı veya test runner seviyesinde ayrı sonuç kodu kullanılmalıdır.

### Security / A11y / spec alignment

- **SQL:** Bu iki commit test harness/dokümantasyonla sınırlı; yeni request-parametreli SQL yolu yok. Restore scriptindeki schema-derived table name quoting (`deploy/restore-relaydesk.sh:145-153`) korunuyor; bu retestte SQL injection regresyonu görülmedi.
- **XSS/A11y:** UI veya form değişmedi; yeni XSS, label/semantik HTML, keyboard/focus yüzeyi oluşmadı. Önceki P1 A11y/security bulguları bu fix loop’un kapsamı dışında kaldı.
- **Secret:** Commitlerde gerçek API key/password yok; test verisi sentetik. `build/notes.md` ve `fix-notes.md` gerçek Telegram/fresh-host kanıtının alınmadığını doğru bildiriyor.
- **Spec alignment:** FIX-06, architecture’daki SQLite WAL/servis recovery hedefiyle harness düzeyinde uyumlu; ancak architecture/acceptance production hedefi gerçek systemd, Telegram, reboot ve ayrı-host restore kanıtı gerektirdiğinden tam spec uyumu yoktur.

### Retest notes

1. MAJOR-01 ve MAJOR-02 harness kapsamı **kapandı**; sonraki test turunda inactive-success ve SHM byte/hash assertion’ları güçlendirilmeli.
2. CRITICAL-01/02 için gerçek Linux bridge service altında `/bot-config` 2xx, env mode/owner, `systemctl is-active` ve gerçek Bot API transition kanıtı alınmalı.
3. CRITICAL-03/04 için gerçek systemd stop/start/readiness failure, active/inactive listener, rollback ve canlı WAL writer sonuçları kaydedilmeli.
4. CRITICAL-05 kapanışı için fresh Linux provision, reboot/logout/network recovery, SSH iki-port wizard, gerçek Telegram ingestion ve ayrı-host restore acceptance çıktıları eklenmeli.

STATUS: BLOCKED

## Önceki P0 restore harness takip retesti — tarihsel kayıt

> Bu bölüm `a98b052`/`d9f47ba` öncesindeki retest kaydıdır. Güncel ve otoritatif karar için yukarıdaki FIX-06 bölümü ve aşağıdaki son karar geçerlidir.

**İncelenen son fixler:** `1b4d2ee`, `0050bf8`, `ed3d902`  
**Kapsam:** Yalnız `tmp_root`/cleanup harness düzeltmesi, restore harness kapsamı ve CRITICAL-01..05 kapanış kanıtı. P1/P2/P3 yeniden incelenmedi.

### FIX-05 harness sonucu: KAPANDI

- **Dosya:satır:** `tests/restore-relaydesk.integration.sh:15-20`.
- `tmp_root="$(mktemp -d)"`, tüm geçici yollar kullanılmadan önce oluşturuluyor; `trap cleanup EXIT` tanımlı kök üzerinde çalışıyor. Önceki `set -u` kaynaklı `tmp_root: unbound variable` yolu artık yok.
- **Komut kanıtı:** `wsl.exe -d Ubuntu -- bash -lc "cd /mnt/c/Users/aturk/telegram-support-hub && bash tests/restore-relaydesk.integration.sh"` → **PASS**. Harness gerçek Linux Bash/Python/SQLite ile çalıştı ve beklenen failure case'lerinden non-zero dönüp final PASS verdi.
- **Ek komut:** WSL üzerinde `bash -n tests/restore-relaydesk.integration.sh deploy/restore-relaydesk.sh` → **SHELL_SYNTAX_PASS**.
- Bu nedenle **harness başlatma/cleanup bulgusu kapanmıştır**. `1b4d2ee` içindeki temp-root/cleanup ve Ubuntu awk uyumluluğu, `0050bf8` içindeki failure senaryoları çalışır durumdadır.

### WSL PASS kanıtının gerçek kapsamı

PASS aşağıdaki sentetik akışları kapsıyor:

1. Geçici SQLite source/destination oluşturma, restore scriptinin online backup çağrısı, candidate/source `PRAGMA integrity_check`, tablo kayıt sayısı eşleşmesi ve restored kayıt gövdesi.
2. Destination yanındaki sentetik `-wal` ve `-shm` dosyalarının restore sonrası destination yanında kalmaması.
3. Fake `systemctl` state machine ile başlangıçta active olan web/poller servislerinin stop → restore → start durum geçişi; başlangıçta inactive listener'ın başlatılmaması.
4. Fake `curl` ile active web readiness kontrolünün çağrılması.
5. Beklenen non-zero hata yolları: web stop failure, poller start failure ve web readiness failure.

Bu PASS **gerçek systemd veya production E2E kanıtı değildir**: fake `systemctl`, fake `curl`, no-op `chown`/`install`, sentetik/stale sidecar dosyaları ve tek süreçli SQLite fixture kullanılıyor. Gerçek WAL yazıcısı, eşzamanlı restore, servis izinleri ve systemd state transition test edilmiyor.

### CRITICAL-01..04 regresyon retesti

| Bulgu | Sonuç | Kanıt ve sınır |
|---|---|---|
| **CRITICAL-01 — bridge `/bot-config` 500** | **Regresyon gözlenmedi; mevcut kapsamda kapalı.** | `scripts/local_setup_bridge.py:107-125` tanımsız `temporary.replace(...)` içermiyor. `python -m unittest discover -s tests -p "test_p0_fix.py"` → **1 test OK**; `tests/test_p0_fix.py:54-70` gerçek loopback HTTP 2xx, `:76-86` env token ve üç restart çağrısını doğruluyor. Bot API ve sudo/systemd mock olduğu için production kapanışı değildir. |
| **CRITICAL-02 — failed/inactive poller başlamıyor** | **Regresyon gözlenmedi; mevcut kapsamda kapalı.** | `scripts/local_setup_bridge.py:111-118` `systemctl restart` kullanıyor; `deploy/relaydesk-sudoers:3-6` exact restart/start imzalarını içeriyor. Test failed poller state'ini active'e taşıyor. Gerçek Linux `systemctl`, sudoers parse ve gerçek Bot API `getUpdates` → SQLite akışı çalıştırılmadı. |
| **CRITICAL-03 — restore sonrası servis recovery/readiness** | **Kod regresyonu gözlenmedi; harness kapsamı kısmi.** | `deploy/restore-relaydesk.sh:44-59,75-120,122-131` active snapshot, stop doğrulaması, EXIT recovery, `is-active` ve web readiness fail-closed akışını koruyor. WSL PASS web/poller active recovery ile stop/start/readiness failure yollarını çalıştırdı. Harness tüm senaryolarda listener'ı inactive başlatıyor (`tests/restore-relaydesk.integration.sh:148-170,239-260`); active listener recovery kanıtı yok. |
| **CRITICAL-04 — WAL/SHM restore güvenliği** | **Kod regresyonu gözlenmedi; harness kanıtı kısmi.** | `deploy/restore-relaydesk.sh:140-197` candidate integrity/count/smoke, sidecar taşıma ve atomik replacement akışını koruyor. WSL PASS destination yanında `-wal`/`-shm` kalmadığını ve restored kaydı doğruladı. Harness sidecar'ları gerçek WAL olarak üretmiyor (`tests/restore-relaydesk.integration.sh:42-44`) ve taşınan backup içeriğini doğrulamıyor; concurrent writer/ayrı-host restore kanıtı yok. |

CRITICAL-01..04 için son fix commitlerinden sonra hedef kodda önceki hatayı yeniden üreten bir bulgu görülmedi. Bu ifade yalnızca kod/statik, local HTTP ve fake-systemctl kapsamı içindir; aşağıdaki CRITICAL-05 production evidence kapısı nedeniyle P0 teslimi kapanmış sayılmaz.

### Yeni MAJOR kanıt bulguları

#### MAJOR-01 — Harness active listener recovery'yi kapsamıyor

- **Dosya:satır:** `tests/restore-relaydesk.integration.sh:42,148-170,239-260`.
- **Davranış:** Başlangıç state'i her ana ve failure fixture'ında `active\nactive\ninactive\n`; listener hiçbir case'te önceden active değil. Dolayısıyla `deploy/restore-relaydesk.sh:82-95` içindeki active listener stop/start ve `is-active` recovery yolu PASS ile kanıtlanmıyor.
- **Etkisi:** P0 restore servis recovery kabulü tüm yönetilen servisleri kapsıyorsa, mevcut PASS yalnız web/poller için kanıttır.
- **Düzeltme önerisi:** En az bir fixture'ı `active\nactive\nactive\n` yapıp listener stop/start, final active state ve log sırasını assert et; inactive-listener davranışını ayrı case olarak koru.

#### MAJOR-02 — Harness gerçek WAL/sidecar preservation'ı doğrulamıyor

- **Dosya:satır:** `tests/restore-relaydesk.integration.sh:42-44,205-207`; ilgili runtime `deploy/restore-relaydesk.sh:177-192`.
- **Davranış:** `-wal`/`-shm` dosyaları yalnızca `printf` ile oluşturulmuş sentetik metinlerdir; assertion yalnız destination yanında artık bulunmadıklarını kontrol ediyor. `destination.restore-sidecars-*` dizininin oluştuğu, iki dosyanın doğru içerikle taşındığı veya canlı WAL yazımı sırasında restore güvenliği doğrulanmıyor.
- **Etkisi:** WSL PASS, sidecar cleanup/izolasyon yolunu gösterir; WAL veri bütünlüğünü, concurrent writer davranışını veya restore backup'ının korunmasını göstermez.
- **Düzeltme önerisi:** Gerçek SQLite `journal_mode=WAL` fixture ve canlı writer kullan; restore sonrası sidecar backup dizini, dosya adları/içerikleri, `integrity_check`, kayıt sayısı ve writer/restore eşzamanlılık sonucunu assert et. Ayrı-host restore'u gerçek temiz hostta ayrıca çalıştır.

### CRITICAL-05 — Linux production evidence gap hâlâ açık

- **Durum:** **KAPANMADI — Critical / BLOCKED.** WSL fake-systemctl harness'ı geçmiştir; bu CRITICAL-05 kanıtının yalnızca bir alt parçasıdır.
- **Fresh host/systemd:** `systemd-analyze verify/security`, `provision-relaydesk.sh`, `relaydesk` sahiplik/izinleri, gerçek `systemctl` active/failed/inactive transitions, reboot/logout/network recovery çalıştırılmadı.
- **Gerçek Telegram ingestion:** Bot token ile gerçek `getWebhookInfo`/`getUpdates`, private/business mesajın poller → API → SQLite zinciri doğrulanmadı.
- **SSH wizard:** Temiz uzak tarayıcıda `-L 3000` + `-L 8765` ile status, bot config, Telegram login ve listener start uçtan uca çalıştırılmadı.
- **Concurrent/ayrı-host restore:** Canlı WAL writer altında restore ve ayrı temiz hostta restore + integrity/kayıt karşılaştırması çalıştırılmadı; off-host/ayrı-host politika hâlâ TODO'dur (`ai-memory/architecture.md:31-35`, `ai-memory/decisions.md:15`).
- **Kabul kriteri etkisi:** `ai-memory/plan.md:137-148` içindeki poller, fresh provision, SSH bridge, backup/restore, reboot ve QA kanıt kutuları tamamlanmış değildir. Windows build/local HTTP ve WSL fake harness bu kanıtların yerine geçmez.
- **Düzeltme önerisi:** Temiz Debian/Ubuntu hostta yukarıdaki akışları gerçek komut çıktıları, `systemctl`/journal kayıtları, gerçek Telegram mesajı ve restore karşılaştırmalarıyla kaydet; sonra CRITICAL-05 ve MAJOR-01/02 yeniden test edilsin.

### Güvenlik / erişilebilirlik / spec alignment

- **SQL:** `deploy/restore-relaydesk.sh:145-153` tablo adlarını SQLite schema'dan alıp quote ediyor; yeni request-parametreli SQL yolu görülmedi. Bu retestte SQL injection bulgusu yok.
- **Secret:** Fix commitlerinde gerçek API key/password hard-code edilmedi; test tokenı sentetik (`tests/test_p0_fix.py:60`). Önceki standalone secret/argv ve hardcoded allowlist bulguları bu P0 fix kapsamına alınmadı.
- **XSS/A11y:** Bu fixler UI/HTML değiştirmiyor; yeni XSS veya form yüzeyi oluşmadı. Önceki WCAG modal/focus bulguları kapanmış değildir.
- **Spec:** FIX-05 harness gereksinimi karşılandı; P0.6 restore runtime kanıtı WSL/fake-systemctl seviyesinde kaldı. Mimari/brief production kabulü için gerçek Linux/systemd/Telegram/restore kanıtı hâlâ zorunlu.

### Retest notes

1. MAJOR-01 için active listener recovery case'i ve MAJOR-02 için gerçek WAL/sidecar preservation assertion'ı yeniden çalıştır.
2. CRITICAL-01/02'yi gerçek Linux bridge service altında `/bot-config` 2xx, env mode/owner, `systemctl is-active` ve Bot API transition ile doğrula.
3. CRITICAL-03/04 için gerçek systemd stop/start/readiness failure, active listener, WAL writer ve rollback sonuçlarını kaydet.
4. CRITICAL-05 için fresh host provision, reboot/logout, SSH wizard, gerçek Telegram ingestion ve ayrı-host restore acceptance çıktısını ekle.

STATUS: BLOCKED

## Son otoritatif karar — a98b052 + d9f47ba

- **MAJOR-01:** **KAPANDI (WSL/fake-systemctl harness kapsamı).** Active listener stop/start recovery, final active state, exact log sırası ve inactive listener’ın başlatılmaması doğrulandı.
- **MAJOR-02:** **KAPANDI (WSL/fake-systemctl harness kapsamı; concurrency hariç).** Gerçek SQLite WAL/SHM dosyaları üretildi; WAL içeriği hash ile, SHM boyut/non-empty ile ve sidecar taşıma/cleanup ile doğrulandı. SHM byte/hash ve canlı concurrent writer kanıtı yoktur.
- **CRITICAL-01..04:** **Regresyon yok; local/WSL kapsamında kapalı.** Son iki commit runtime kodunu değiştirmedi; gerçek production systemd/Telegram kanıtı alınmadı.
- **CRITICAL-05:** **AÇIK Critical / BLOCKED.** Fresh Linux/systemd provision ve security doğrulaması, gerçek Telegram ingestion, SSH wizard, concurrent WAL restore ve ayrı-host restore kanıtları yok.

STATUS: BLOCKED
