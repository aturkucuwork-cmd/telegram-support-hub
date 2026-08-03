# RelayDesk Production-Readiness Ops Audit

**Rol:** Selim — Yazılım Uzmanı / Mimar  
**Kapsam:** Yalnızca Linux/self-host, systemd, yedekleme, gözlemleme, güvenlik sertleştirmesi, gerçek çalışma doğrulaması ve dayanıklılık. Uygulama kodu değiştirilmedi.

## Kanıt sınırı ve doğrulama özeti

- `README.md`, `ai-memory/brief.md`, `ai-memory/build/notes.md`, `ai-memory/spec/architecture.md` ve `deploy/` altındaki 8 dosya okundu.
- Build notes; `npm run build`, `npm test`, lint, TypeScript, Fernet self-test ve shell sözdizimi kontrolünün geçmişte geçtiğini kaydediyor (`ai-memory/build/notes.md:52-75`).
- Aynı kayıt, systemd birimlerinin hiç çalıştırılmadığını, Linux `flock`, Telethon ve gerçek Telegram akışının test edilmediğini açıkça belirtiyor (`ai-memory/build/notes.md:77-84`).
- Bu audit ortamında `bash -n deploy/*.sh` yeniden çalıştırılamadı: WSL içinde `/bin/bash` bulunamadı. Bu nedenle shell sonucu için yalnızca build notes'taki geçmiş kanıt kullanıldı; Linux/systemd çalışma kanıtı yoktur.
- **Doğrulanmış bulgu:** Dosya içeriği ve statik akıştan doğrudan çıkarılabilen davranış.
- **Needs validation / varsayım:** Linux sunucuda gerçek servis hesabı, dosya izinleri, proxy ve Telegram hesabı henüz sağlanmadığı için sahada doğrulanması gereken etki.

## Kritik sorunlar

### OPS-01 — Bot API alım servisi Linux dağıtımında yok

- **Önem:** `CRITICAL`
- **Kanıt:** Windows başlatıcısı `telegram_long_poll.py`'yi tanımlayıp son adımda çalıştırıyor (`scripts/start-local-telegram.ps1:7-10,164`). Kurulum köprüsü bot yapılandırılırken webhook'u siliyor (`scripts/local_setup_bridge.py:138-152`). Buna karşılık Linux bootstrap yalnızca web ve MTProto listener birimlerini başlatıyor (`deploy/relaydesk-bootstrap.sh:12-16`); `deploy/` içinde Bot API long-poll için unit veya wrapper yok.
- **Davranış/etki:** Self-host kurulumunda webhook kaldırıldıktan sonra `telegram_long_poll.py` başlatılmıyor. Bu nedenle Business/private bot mesajları `/api/telegram/webhook` akışına ulaşmıyor; ana gelen kutusu akışı çalışmıyor. Bu, brief'teki bağımsız çalışma hedefinin ve wizard'daki “webhook kapatıldı ve yerel long polling hazır” beklentisinin bozulmasıdır (`app/setup-wizard.tsx:297-298`).
- **Aksiyon:** Ya `telegram_long_poll.py` için aynı servis kullanıcısı altında `Restart=always`/log politikası olan gerçek bir systemd unit ve kurulum adımı eklenmeli ya da public HTTPS webhook + reverse proxy/firewall yolu eksiksiz kurulmalı. Seçilen mod için gerçek Telegram mesajı → route → SQLite smoke testi zorunlu.
- **Doğrulama:** `systemctl is-enabled/is-active`, `journalctl`, Telegram `getUpdates`/webhook durumu ve yeni private/business mesajın SQLite'a yazılması.

### OPS-02 — Web ve kurulum bileşenleri farklı EnvironmentFile kullanıyor

- **Önem:** `CRITICAL`
- **Kanıt:** Web unit `/opt/relaydesk/.env.production` okuyor (`deploy/relaydesk-web.service:8-10`). Listener ve setup bridge `.env.local` okuyor (`deploy/relaydesk-listener.service:8-10`, `deploy/relaydesk-setup-bridge.service:6-8`). Bridge'in yazma yolu sabit olarak `.env.local` (`scripts/local_setup_bridge.py:33-35,76-93`) ve bot token/webhook secret güncellemesi de yalnızca bu dosyada (`scripts/local_setup_bridge.py:146-152`). Webhook ve listener API route'ları kendi web process environment'ındaki `TELEGRAM_WEBHOOK_SECRET` değerini kullanıyor (`app/api/telegram/webhook/route.ts:39-47`, `app/api/telegram/user-listener/route.ts:13-21`).
- **Davranış/etki:** SSH üzerinden açılan setup wizard bot ayarlarını `.env.local`'e yazsa da web servisi `.env.production` içindeki eski/boş değerlerle çalışır. Web route'ları 503/401 dönebilir; listener'ın gönderdiği secret web'in beklediği secret ile eşleşmeyebilir. Sadece iki dosyayı elle aynı doldurmak da çalışan web process'i yeniden başlatılmadığı sürece değişiklikleri yüklemez.
- **Aksiyon:** Web, bridge ve listener için tek, sahipliği/izinleri tanımlı bir secret kaynağı belirlenmeli veya bridge güncellemesi kontrollü biçimde web EnvironmentFile'ına uygulanıp web servisi yeniden başlatılmalı. Bu akışta token/secret rotasyonu ve restart davranışı tasarlanmalı; iki farklı dosya kopyalama talimatı kaldırılmalı ya da senkronizasyon açıkça uygulanmalı.
- **Doğrulama:** Temiz Linux hostta wizard ile token yazıldıktan sonra `systemctl show ... --property=EnvironmentFiles`, `/api/status`, `/api/telegram/user-listener` ve gerçek import isteği aynı secret ile başarılı olmalı.

### OPS-03 — Kurulum, `relaydesk` servis hesabını ve sahiplikleri provision etmiyor

- **Önem:** `CRITICAL`
- **Kanıt:** Web unit doğrudan `User=relaydesk` ile çalışıyor (`deploy/relaydesk-web.service:5-10`). README kurulumunda `/opt/relaydesk` clone, env kopyalama ve unit kopyalama var; `useradd`, `groupadd`, `chown`, env izinleri veya proje dizini sahipliği yok (`README.md:125-148`). Bootstrap yalnızca daemon reload ve enable/start yapıyor (`deploy/relaydesk-bootstrap.sh:12-16`). Listener/bridge ise kurulum yapan kullanıcının user-systemd alanına kopyalanıyor (`README.md:143-150`).
- **Davranış/etki:** `relaydesk` hesabı önceden yoksa web unit hiç başlayamaz. Hesap varsa fakat `/opt/relaydesk`, `.env.production`, `DATABASE_PATH` dizini veya `.env.local` başka kullanıcıya aitse servis dosya/SQLite/session erişiminde başarısız olur. User-level listener ile system-level web'in aynı proje kökü ve secret dosyaları üzerinde hangi kullanıcıyla çalışacağı da belirsizdir.
- **Aksiyon:** Desteklenen dağıtım modelinde özel kullanıcı/grup, `/opt/relaydesk` read-only sahipliği, `/var/lib/relaydesk` writable data dizini, env/session sahipliği ve listener kullanıcısı açıkça provision edilmeli. System unit ile user unit arasında tek servis kullanıcısı veya bilinçli ACL modeli seçilmeli. Kurulum dokümanı fresh host üzerinde baştan sona uygulanmalı.
- **Doğrulama:** Yeni Debian/Ubuntu hostta `systemd-analyze verify`, `namei -l`, `systemctl start`, `systemctl --user start`, SQLite yazma ve session okuma testleri.

### OPS-04 — SSH talimatı setup bridge portunu tünellemiyor

- **Önem:** `CRITICAL`
- **Kanıt:** Bridge yalnızca server loopback'inde `127.0.0.1:8765` dinliyor (`scripts/local_setup_bridge.py:43-44,622-626`). Browser, route'tan aldığı `http://127.0.0.1:8765` adresine doğrudan istek gönderiyor (`app/api/local-setup/route.ts:15-20`, `app/setup-wizard.tsx:68-78`). README yalnızca web portunu tünelliyor: `ssh -L 3000:localhost:3000` (`README.md:152-156`).
- **Davranış/etki:** Kullanıcının workstation tarayıcısındaki `127.0.0.1:8765`, sunucunun değil workstation'ın loopback'idir. README'deki SSH akışıyla wizard web'e ulaşsa bile bridge'e ulaşamaz; Telegram token/login adımları çalışmaz.
- **Aksiyon:** `8765` için ikinci SSH forward dokümante edilmeli (`-L 8765:localhost:8765`) veya bridge aynı-origin web proxy'si üzerinden sunucuya alınmalı. Bridge token'ın tarayıcıya taşınmasının bu tasarımda kabul edilen risk olduğu ayrıca sınırlandırılmalı.
- **Doğrulama:** Uzak sunucuda bridge aktifken temiz yerel tarayıcıdan wizard açılıp `/status`, bot-config ve Telegram login adımlarının tamamı çalıştırılmalı.

### OPS-05 — SQLite için yedekleme ve geri yükleme yolu yok

- **Önem:** `CRITICAL`
- **Kanıt:** `DATABASE_PATH` yalnızca “kalıcı/yedeklenen dizine işaret etmeli” şeklinde öneriliyor (`.env.example:6-8`); README de yalnızca dizinin önceden oluşturulmasını söylüyor (`README.md:136`). `deploy/relaydesk-bootstrap.sh` sadece unit start ve health-check yapıyor (`deploy/relaydesk-bootstrap.sh:12-31`); backup script, systemd timer, retention, off-host kopya veya restore komutu bulunmuyor. SQLite WAL açılıyor (`db/index.ts:11-15`), dolayısıyla yalnızca ana `.sqlite` dosyasını kopyalamak WAL'daki son yazıları güvenilir biçimde kapsamayabilir.
- **Davranış/etki:** Sunucu/disk arızasında müşteri mesajları, agent oturumları ve audit kayıtları için belgelenmiş geri dönüş noktası yok. Yedek alınıp alınmadığı, ne kadar tutulduğu ve geri yüklemenin çalıştığı kanıtlanamıyor.
- **Aksiyon:** WAL uyumlu SQLite online backup veya kontrollü stop/checkpoint yöntemiyle systemd timer kurulmalı; şifreli off-host kopya, retention, disk doluluğu alarmı ve belgeli restore drill eklenmeli. Yedek secret/session dosyalarının kapsamı ve anahtar kurtarma prosedürü ayrıca tanımlanmalı.
- **Doğrulama:** Yazma devam ederken backup, ayrı boş hosta restore, `PRAGMA integrity_check`, kayıt sayısı karşılaştırması ve uygulama açılış testi.

## Yüksek önem taşıyan sorunlar

### OPS-06 — Bootstrap health-check daima yetkisiz kalıyor

- **Önem:** `HIGH`
- **Kanıt:** Bootstrap auth header/cookie olmadan `curl -fsS http://localhost:3000/api/status` çağırıyor (`deploy/relaydesk-bootstrap.sh:20-30`). `/api/status` ilk satırlarda `requireActor` çağırıyor ve actor yoksa 401 döndürüyor (`app/api/status/route.ts:36-39`, `lib/auth.ts:152-160`).
- **Davranış/etki:** Web process'i sağlıklı olsa ve `/api/status` route'u doğru çalışsa bile bootstrap 30 saniye bekleyip exit 1 verir. Deploy otomasyonu yanlış negatif üretir.
- **Aksiyon:** Auth gerektirmeyen, dışarı açılmayan bir process/readiness endpoint'i kullanılmalı veya health-check systemd state + auth'suz `/api/auth/setup` ile ayrıştırılmalı. Kullanıcı status endpoint'ine anon erişim açılmamalı.
- **Doğrulama:** Yeni hostta bootstrap çıktısı, exit code ve `systemctl status` birlikte kontrol edilmeli.

### OPS-07 — User-level listener reboot/logout sonrasında kalıcı olduğu kanıtlanmamış

- **Önem:** `HIGH`
- **Kanıt:** Listener user unit `WantedBy=default.target` ile kuruluyor (`deploy/relaydesk-listener.service:14-15`) ve bootstrap yalnızca mevcut user manager'da `enable --now` yapıyor (`deploy/relaydesk-bootstrap.sh:15-16`). README “kalıcı systemd servisleri” diyor (`README.md:121-123`) ancak `loginctl enable-linger` veya boot sonrası user manager kurulumu yok (`README.md:143-150`). Build notes systemd üzerinde hiç start/reboot testi yapılmadığını belirtiyor (`ai-memory/build/notes.md:80-81`).
- **Davranış/etki:** User manager yalnızca interaktif oturumla çalışıyorsa SSH logout/reboot sonrası MTProto listener durur; uygulamanın “kalıcı servis” hedefi karşılanmaz.
- **Aksiyon:** Listener hesabı için `loginctl enable-linger <user>` provision edilmeli ve bunun güvenlik etkisi belgelenmeli; alternatif olarak listener system-level unit olarak `User=` ile çalıştırılmalı. Bridge'in intentionally manual olması ayrı tutulmalı.
- **Doğrulama:** Logout, reboot ve network restart sonrası listener'ın otomatik başlaması; heartbeat'in 90 saniye içinde güncellenmesi (`app/api/status/route.ts:54-56`).

### OPS-08 — Secret dosyaları için izin zorlaması ve token argv sızıntısı yok

- **Önem:** `HIGH`
- **Kanıt:** `configure-local-telegram.sh` tokenı `read -s` ile alıyor (`deploy/configure-local-telegram.sh:20`), fakat doğrulama Python process'ine command-line argümanı olarak geçiriyor (`deploy/configure-local-telegram.sh:28-44`). Aynı script env dosyasını oluşturup değiştiriyor ancak `umask`, `chmod 600`, owner veya cleanup trap uygulamıyor (`deploy/configure-local-telegram.sh:52-62`). README ve template 600 öneriyor ama bunu zorlayan komut yok (`README.md:138`, `.env.example:10-13`).
- **Davranış/etki:** Token kısa süreliğine `/proc` process command line'ında görülebilir. `.env.local`, `.env.production`, `.local-setup-state.json` ve geçici env dosyaları varsayılan umask ile başka local kullanıcılarca okunabilir; Fernet key ve bot token bununla aynı risk alanındadır.
- **Aksiyon:** Secret doğrulamasını stdin veya güvenli process input ile yapmalı; env ve temp dosyaları `umask 077`, explicit owner/mode, trap cleanup ve atomic replace ile yazılmalı. systemd `LoadCredential`/secret store alternatifi değerlendirilip erişim matrisi belgelenmeli.
- **Doğrulama:** `stat`, farklı local user ile read denemesi, `ps`/`/proc` gözlemi ve başarısız script adımında temp dosya kalıp kalmadığı.

### OPS-09 — Systemd servisleri operasyonel sertleştirme olmadan çalışıyor

- **Önem:** `HIGH`
- **Kanıt:** Web unit yalnızca `User`, `WorkingDirectory`, `EnvironmentFile`, `ExecStart`, `Restart` tanımlıyor (`deploy/relaydesk-web.service:5-12`); listener da aynı şekilde (`deploy/relaydesk-listener.service:6-12`); bridge'de `RestartSec` dahi yok (`deploy/relaydesk-setup-bridge.service:4-9`). `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem`, `ProtectHome`, `ReadWritePaths`, `RestrictAddressFamilies`, capability sınırı, resource limit ve watchdog tanımı yok.
- **Davranış/etki:** Uygulama veya Telethon bağımlılığı ele geçirilirse servis kullanıcılarının erişebildiği proje/env/session alanı geniş kalır. Bridge hatasında restart loop ve log/disk baskısı oluşabilir; process hang'i systemd tarafından sağlıklı sanılabilir.
- **Aksiyon:** Her unit için minimum privilege ve gerekli writable path'leri açıkça tanımla; `NoNewPrivileges`, filesystem/network sandbox, `RestartSec`, `StartLimit*`, timeout/resource limit ve gerekirse watchdog ekle. Native Node/Python ve SQLite davranışıyla birlikte `systemd-analyze security` sonucu yayımlanmalı.
- **Doğrulama:** `systemd-analyze security relaydesk-*.service`, `systemd-analyze verify`, crash/hang, disk doluluğu ve SQLite yazma testleri.

### OPS-10 — Gözlemleme yalnızca UI heartbeat'ine bırakılmış

- **Önem:** `HIGH`
- **Kanıt:** Listener heartbeat'i her 20 saniyede gönderiliyor (`scripts/telegram_user_long_poll.py:469-485`) ve UI status yalnızca son 90 saniyeyi hesaplıyor (`app/api/status/route.ts:54-77`). Deploy'de tek kontrol bootstrap'ın hatalı auth'lı curl'ü (`deploy/relaydesk-bootstrap.sh:18-31`); alerting, dış health monitor, metric/exporter, disk/WAL büyümesi, backup freshness veya Telegram/API failure alarmı yok. Build notes gerçek systemd çalışmasını doğrulamıyor (`ai-memory/build/notes.md:80-81`).
- **Davranış/etki:** Listener process'i, web process'i veya disk doluluğu sessizce bozulabilir; ekip yalnızca paneli açtığında fark eder. Heartbeat'in veritabanına yazılması alarm üretmez.
- **Aksiyon:** systemd/journald için merkezi log ve alert, auth'suz localhost readiness, listener heartbeat freshness alarmı, process restart alarmı, disk/inode/WAL/SQLite integrity metrikleri ve backup freshness alarmı eklenmeli.
- **Doğrulama:** Process kill, Telegram erişim kesintisi, web durdurma, disk threshold ve stale heartbeat senaryolarında alarmın belirlenen sürede oluşması.

### OPS-11 — MTProto aktarım kuyruğu process belleğinde; crash'te kayıp mümkün

- **Önem:** `HIGH`
- **Kanıt:** Listener queue'su `asyncio.Queue(maxsize=5000)` olarak bellekte tutuluyor (`scripts/telegram_user_long_poll.py:453`). Import başarısızlığında `post_with_retry` sonsuz retry yapıyor (`scripts/telegram_user_long_poll.py:418-433`); event handler queue dolunca `await queue.put` üzerinde bloklanıyor (`scripts/telegram_user_long_poll.py:509-529`). Kalıcı outbox/spool yok.
- **Davranış/etki:** Web/SQLite geçici olarak kapalıyken 5000 öğeye kadar RAM'de bekleyen, process kill/reboot/OOM durumunda kalıcılaşmamış mesajlar kaybolur. `Restart=on-failure` process'i geri getirse de bellekteki kuyruğu geri getirmez.
- **Aksiyon:** En azından disk tabanlı durable spool/outbox, idempotent replay ve queue-depth alarmı eklenmeli; graceful shutdown'da drain/checkpoint yapılmalı. Brief'te kapsam dışı bırakılan reply outbox boşluğu ile bu listener import kuyruğu ayrı değerlendirilmelidir.
- **Doğrulama:** Web'i kapatıp 5000 üstü mesaj/kill -9/reboot sonrası tekrar açarak kayıp, duplicate ve cursor davranışını ölçme.

### OPS-12 — Belgelenen history sync akışı auth nedeniyle çalışmıyor

- **Önem:** `HIGH`
- **Kanıt:** `sync_telegram_history.py` ilk olarak auth header/cookie olmadan `STATUS_URL` çağırıyor (`scripts/sync_telegram_history.py:23-27,307-321`). Bu URL `/api/status`; route auth zorunlu kılıyor (`app/api/status/route.ts:36-39`). Linux wrapper scripti bu aracı doğrudan çalıştırıyor (`deploy/sync-telegram-history.sh:21-24`).
- **Davranış/etki:** Geçmiş senkronizasyonu, kullanıcıdan giriş alıp Telegram'a bağlanmadan önce 401 ile durur; README'deki history import prosedürü self-host'ta tamamlanamaz (`README.md:109-119`).
- **Aksiyon:** History tool için auth'suz yalnızca-local readiness/config endpoint'i veya webhook secret ile imzalı internal status kullan; uygulama status route'una anonim erişim açma.
- **Doğrulama:** Temiz env ile wrapper çalıştırıldığında status adımının geçmesi ve en az bir sohbet/mesajın SQLite'a import edilmesi.

### OPS-13 — Üretim allowlist'i kurulum scripti tarafından sabit değerle eziliyor

- **Önem:** `HIGH` — **Needs validation:** Bu iki adresin üretimde gerçekten yetkili olup olmadığı proje sahibinden doğrulanmadı.
- **Kanıt:** Script mevcut `SUPPORT_ALLOWED_EMAILS` satırını filtreleyip her çalışmada `demo@relaydesk.local,indafelhayat@gmail.com` yazıyor (`deploy/configure-local-telegram.sh:52-61`). Build notes bu davranışın bilerek taşındığını ve üretimde teyit gerektiğini kaydediyor (`ai-memory/build/notes.md:38-40,82`).
- **Davranış/etki:** Kullanıcının üretim allowlist'i sessizce değişir; yetkisiz hesap erişimi veya gerçek destek ekibinin dışarıda kalması mümkün olur.
- **Aksiyon:** Production allowlist'i scriptte hardcode etme; mevcut değeri koru veya interaktif/secret-managed zorunlu değer iste. İki adresin yetkisi ve kabul kriteri yazılı olarak onaylanmalı.
- **Doğrulama:** Script öncesi/sonrası env diff, allowlist dışı hesap 401 ve allowlist içi hesap login testi.

## Orta/düşük önem taşıyan iyileştirmeler

### OPS-14 — Reverse proxy/TLS ve firewall konfigürasyonu teslimatın parçası değil

- **Önem:** `MEDIUM` — **Needs validation:** Sunucunun yalnızca SSH tüneliyle mi, yoksa dış kullanıcılar/webhook ile mi erişileceği brief'te netleştirilmemiş.
- **Kanıt:** README yalnızca reverse proxy arkasında `VINEXT_TRUST_PROXY` ayarını not ediyor (`README.md:160`); `deploy/` içinde nginx/Caddy, TLS sertifika yenileme veya firewall unit/scripti yok. Architecture da bunu zorunlu kod değil not olarak bırakıyor (`ai-memory/spec/architecture.md:77-79`).
- **Davranış/etki:** SSH tüneli dışındaki erişimde HTTPS, forwarded-host/proto, HSTS, inbound port ve Telegram webhook reachability garantisi yok. Public webhook seçilirse mevcut local-polling kararından ayrıca sapılır.
- **Aksiyon:** Desteklenen ingress modelini tek olarak seç; SSH-only ise firewall ile 3000/8765'i kapalı tut, public ise TLS/reverse proxy, trusted proxy, firewall ve certificate renewal prosedürünü ekle.
- **Doğrulama:** Dış ağdan port taraması, HTTPS cookie kontrolü, Telegram webhook `getWebhookInfo` ve proxy header testi.

### OPS-15 — Listener bootstrap, session olmadan servisi başlatıyor

- **Önem:** `MEDIUM`
- **Kanıt:** Bootstrap listener'ı hemen enable/start ediyor (`deploy/relaydesk-bootstrap.sh:15-16`); listener ise session'ı yüklemeden önce `.env.local` ve encrypted session okumaya çalışıyor (`scripts/telegram_user_long_poll.py:435-445`). İlk kurulum session üretmeden başlıyor (`README.md:143-150`).
- **Davranış/etki:** İlk kurulumda beklenen şekilde fail/restart döngüsü ve systemd start-limit oluşabilir; wizard'in sonradan `systemctl --user start` çağrısına güvenmesi gerçek hostta doğrulanmamıştır.
- **Aksiyon:** Session yoksa listener'ı enable etme veya unit'i `ConditionPathExists` ile koşullandır; wizard tamamlandıktan sonra enable/start et. Start-limit ve kullanıcıya görünen hata mesajını test et.

## Spec uyumu

| Alan | Durum | Kanıt ve sapma |
|---|---|---|
| SQLite + Fernet | Kısmi uyum | Build notes native binding, SQLite WAL ve Fernet self-testini doğruluyor (`ai-memory/build/notes.md:59-75`); Linux native binding ve gerçek session akışı doğrulanmamış (`ai-memory/build/notes.md:79-81`). |
| Üç systemd servisi | Kısmi uyum | Üç unit mevcut; ancak bot polling servisi yok, env dosyaları kullanıcı akışıyla uyumsuz (`deploy/relaydesk-bootstrap.sh:12-16`, `deploy/relaydesk-web.service:9`, `deploy/relaydesk-listener.service:9`). |
| Kalıcı çalışma | Uyum kanıtlanmadı | Listener user unit'i mevcut; linger, reboot ve gerçek systemd start testi yok (`deploy/relaydesk-listener.service:14-15`, `ai-memory/build/notes.md:80-81`). |
| Reverse proxy güvenliği | Eksik | Spec `.env.example`'a trust-proxy notu eklenmesini istiyor (`ai-memory/spec/architecture.md:79`), fakat template'te bu değişken/not yok (`.env.example:1-13`). |
| Yerel setup akışı | Sapma | Spec/README SSH üzerinden wizard öngörüyor; bridge `8765` tüneli dokümante edilmemiş ve web/bridge env'leri ayrışmış (`README.md:152-156`, `app/api/local-setup/route.ts:15-20`). |
| Yedekleme/gözlemleme | Eksik | Architecture/README'de uygulanmış backup, restore, timer veya alert kanıtı yok; deploy sadece start/health-check içeriyor (`deploy/relaydesk-bootstrap.sh:12-31`). |

## Retest planı / kabul edilmeden önce çalıştırılacak testler

1. Fresh Linux host: kullanıcı, sahiplik, env izinleri, `/var/lib/relaydesk`, `systemd-analyze verify/security`, `loginctl enable-linger` ve reboot testi.
2. Bot ingestion: setup wizard sonrası webhook'un silindiğini ve Bot API poller unit'inin aktif olduğunu doğrula; private/business message → SQLite uçtan uca test et.
3. Setup tunnel: `-L 3000` ve `-L 8765` ile temiz workstation browser'ında tüm wizard adımlarını tamamla.
4. Env consistency: wizard token/secret yazdıktan sonra web, listener, import ve heartbeat route'larının aynı değerle başarı verdiğini; web restart sonrası da korunduğunu test et.
5. Bootstrap/history: bootstrap exit code'unu; `/api/status` auth davranışını bozmadan readiness check'i; history sync'in status adımını test et.
6. Backup/restore: WAL altında online backup, `integrity_check`, ayrı host restore ve kayıt karşılaştırması; retention/off-host kopya ve alarmı test et.
7. Resilience: Telegram/API/web kesintisi, queue overflow, listener kill/reboot, disk/inode doluluğu ve stale heartbeat alarmı test et.
8. Security: env/session `stat`, farklı local user erişimi, token doğrulama sırasında `/proc` argv, firewall/TLS/cookie ve journald log redaction kontrolü.

## Sonuç

Kritik bulgular gerçek teslim akışını etkiliyor: Linux'ta Bot API poller yok, setup değişiklikleri web process'ine taşınmıyor, servis hesabı/sahiplik provision edilmiyor, SSH bridge portu tünellenmiyor ve backup/restore yolu bulunmuyor. Bunlar audit kapsamında raporlanmış teslim riskleridir; kullanıcının talimatı gereği kritik bulgular raporun durum satırını `BLOCKED` yapmıyor.

STATUS: READY_FOR_DELIVERY
