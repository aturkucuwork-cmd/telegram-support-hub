# RelayDesk Remediation Planı

**Tarih:** 2026-08-03  
**Amaç:** Genel denetimde bulunan kritik eksikleri kapatıp Linux self-host dağıtımını production-ready hale getirmek.  
**Kaynaklar:** `ai-memory/review/general-audit.md`, `ai-memory/review/ops-audit.md`  
**Kod durumu:** Bu plan hazırlanırken uygulama kodu değiştirilmedi.

## Uygulama kuralı

- Önce P0 tamamlanmadan production deploy yapılmayacak.
- Her iş paketi TDD/incremental implementation ile Mert tarafından uygulanacak.
- Her dilim sonrası build/test ve Git checkpoint alınacak.
- P0/P1 tamamlandıktan sonra fresh Linux host üzerinde gerçek E2E review tekrarlanacak.
- `reply outbox`, durable listener queue ve public deployment modeli mevcut brief'in kapsamını genişletir; uygulanmadan önce Change Request olarak onaylanmalıdır.

## P0 — Production blokajlarını kaldır

### P0.1 Bot API alımını Linux'a taşı

- `scripts/telegram_long_poll.py` için `deploy/relaydesk-telegram-poller.service` oluştur.
- Poller'ı bootstrap'a ekle; webhook/polling modunun tek ve açık kararını ver.
- `Restart=on-failure`, `RestartSec`, log ve start-limit ayarlarını ekle.
- Bot/private/business mesajı → webhook route → SQLite zincirini gerçek Telegram mesajıyla doğrula.

**Kabul:** Linux reboot sonrası poller aktif; `getWebhookInfo` beklenen durumda; yeni private/business mesaj SQLite'a yazılıyor.

### P0.2 Tek yapılandırma ve secret kaynağı oluştur

- Web, poller, MTProto listener ve bridge için tek EnvironmentFile/credential modeli seç.
- Wizard'ın yazdığı token/secret değişikliklerinin ilgili servisleri güvenli şekilde reload/restart etmesini sağla.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `SESSION_ENCRYPTION_KEY`, `LOCAL_SETUP_TOKEN`, `SUPPORT_ALLOWED_EMAILS` erişim matrisi yaz.
- Secret rotasyonu ve servis restart prosedürünü dokümante et.

**Kabul:** Wizard sonrası web, poller, listener ve import/heartbeat route'ları aynı secret ile çalışıyor; servis restart sonrası ayarlar korunuyor.

### P0.3 Fresh Linux provision script'i yaz

- `relaydesk` servis kullanıcısı/grubu oluştur.
- `/opt/relaydesk` kod, `/var/lib/relaydesk` SQLite/backup ve secret dizinlerini oluştur.
- Sahiplik, ACL ve `chmod 600/700` izinlerini zorla.
- Node, Python venv, native `better-sqlite3` ve Telethon bağımlılıklarını sunucuda kur.
- Web/listener/poller/bridge servis modelini system-level veya user-level olarak tekleştir.

**Kabul:** Temiz Debian/Ubuntu makinede tek kurulum komutu servisleri başlatıyor; `systemd-analyze verify` geçiyor; SQLite/session yazılıp okunuyor.

### P0.4 Setup wizard uzak erişimini düzelt

- README'ye iki portlu SSH tünelini ekle: `-L 3000:localhost:3000 -L 8765:localhost:8765`.
- Alternatif olarak bridge'i aynı-origin web proxy arkasına taşı.
- Bridge'in yalnızca loopback/private network'ten erişildiğini test et.

**Kabul:** Temiz uzak tarayıcıdan wizard status, bot config, Telegram login ve listener start adımları tamamlanıyor.

### P0.5 Readiness/health akışını düzelt

- Auth gerektirmeyen, yalnızca localhost/firewall arkasında çalışan `/api/healthz` veya `/api/ready` endpoint'i ekle.
- Bootstrap'ı `/api/status` yerine bu endpoint'i kontrol edecek şekilde değiştir.
- History sync için auth'suz public status yerine ayrı local/internal status akışı oluştur.

**Kabul:** Fresh kurulumda bootstrap 0 exit code ile bitiyor; history sync ilk status adımında 401 almıyor; `/api/status` anonim erişime açılmıyor.

### P0.6 Backup ve restore temelini kur

- WAL uyumlu SQLite online backup script'i yaz.
- Systemd timer, retention ve şifreli off-host kopya politikasını ekle.
- Secret/session backup kapsamını ve Fernet anahtar kurtarma prosedürünü tanımla.
- Restore script'i, `PRAGMA integrity_check` ve ayrı host restore testi ekle.

**Kabul:** Yazma devam ederken backup alınabiliyor; ayrı hostta restore açılıyor; kayıt sayıları ve integrity check eşleşiyor.

## P1 — Güvenlik ve dayanıklılık

### P1.1 Auth hardening

- Self-host'ta `oai-authenticated-*` header fallback'ini kapat veya yalnızca doğrulanmış hosting adapter'ına bağla.
- Login için IP + hesap bazlı rate limit, başarısız deneme sayacı ve audit ekle.
- Tüm cookie-authenticated mutation route'larında origin/CSRF kontrolünü zorunlu kıl.
- Session invalidation, expiry ve parola değişimi testlerini ekle.

### P1.2 Internal API güvenliği

- `INTERNAL_API_SECRET` veya imzalı nonce/timestamp protokolü ekle.
- Import, listener heartbeat ve folder sync route'larını public ingress'ten ayır.
- Webhook secret ile internal secret'ı birbirinden ayır.
- Replay, sahte heartbeat ve sahte import negatif testleri yaz.

### P1.3 Secret sızıntılarını kapat

- Token doğrulamasını argv yerine stdin/credential ile yap.
- Tüm temp/env dosyalarında `umask 077`, atomic replace, `chmod 600`, owner kontrolü ve cleanup trap uygula.
- `ps`, `/proc`, farklı local user ve başarısız kurulum senaryolarıyla doğrula.

### P1.4 Systemd hardening ve kalıcılık

- User-level yerine seçilen servis modelini netleştir; gerekiyorsa `loginctl enable-linger` provision et.
- `NoNewPrivileges`, `ProtectSystem`, `PrivateTmp`, `ProtectHome`, `ReadWritePaths`, `RestrictAddressFamilies`, resource limit ve start-limit ayarlarını ekle.
- `systemd-analyze security` ve reboot/logout/network restart testlerini çalıştır.

### P1.5 Gözlemleme ve alarm

- Journald log politikası ve merkezi log/alert prosedürü ekle.
- Web/poller/listener restart, stale heartbeat, disk/inode, WAL büyümesi, backup freshness ve Telegram API hata alarmları ekle.
- Queue depth ve başarısız import metriği oluştur.

## P2 — Mesaj kaybı ve ölçekleme

### P2.1 MTProto durable queue

- RAM kuyruğu yerine SQLite/disk tabanlı durable spool/outbox ekle.
- Idempotent replay, queue depth, graceful drain ve kill/reboot testleri ekle.

### P2.2 Reply outbox/retry (Change Request)

- `reply/route.ts` için outbox tablosu ve durum modeli oluştur.
- Retry/backoff, duplicate önleme, başarısız gönderim görünümü ve audit ekle.
- Bu madde mevcut migration brief'inde kapsam dışıdır; ayrı kullanıcı onayı gerekir.

### P2.3 Veri erişimi ve polling

- Conversations/messages için cursor pagination ve server-side search/filter ekle.
- 250/500 sabit limitlerinin UX etkisini kaldır.
- Visibility-aware polling, backoff, ETag veya SSE/WebSocket değerlendir.

## P3 — Kalite, erişilebilirlik ve dokümantasyon

- Auth/DB/webhook/parser/media/retry için unit + integration testleri yaz.
- Playwright ile login, setup, mesaj alma, yanıt, medya ve ekip akışlarını smoke test et.
- Linux CI job'ı: lint, typecheck, test, build, shellcheck, `systemd-analyze verify`.
- Modal focus trap, initial focus, Escape ve focus restore ekle; WCAG 2.2 AA testi yap.
- CSP, HSTS, frame-ancestors/X-Frame-Options, Referrer-Policy ve nosniff header'larını ekle.
- Hardcoded `SUPPORT_ALLOWED_EMAILS` değerini kaldır; kullanıcıdan veya secret manager'dan al.
- “Windows kasasında” metnini platform bağımsız metinle değiştir.
- Public URL/TLS/firewall/backup/restore/runbook dokümantasyonunu tamamla.

## Final kabul kapısı

Aşağıdaki maddeler kanıtlanmadan `READY_FOR_DELIVERY` verilmeyecek:

- [ ] Bot API poller Linux'ta aktif ve gerçek mesaj akışı çalışıyor.
- [ ] Tüm servisler aynı config/secret modelini kullanıyor.
- [ ] Fresh Linux provision ve izinler doğrulandı.
- [ ] SSH bridge veya same-origin proxy akışı çalışıyor.
- [ ] Readiness/bootstrap/history sync başarılı.
- [ ] Backup + restore + integrity check tamamlandı.
- [ ] Auth/internal API/CSRF/security testleri geçti.
- [ ] Reboot/logout/network failure sonrası servisler geri geliyor.
- [ ] Test suite kritik akışları kapsıyor.
- [ ] QA, security, A11y ve operasyon review'larında kritik bulgu kalmadı.

STATUS: BLOCKED
