# RelayDesk Genel Proje Denetimi

**Tarih:** 2026-08-03  
**Kapsam:** Uygulama kodu, API/auth, Telegram akışları, self-host/systemd, testler, erişilebilirlik ve operasyon  
**Kod değişikliği:** Yapılmadı; bu dosya yalnızca denetim çıktısıdır.

## Doğrulama özeti

- `npm run lint` → geçti.
- `npx tsc --noEmit` → geçti.
- `npm test` → geçti; ancak test yalnızca build ve statik kaynak eşleşmeleri yapıyor.
- `npm audit --omit=dev` → npm registry HTTP kullandığı için `426 Upgrade Required` ile tamamlanamadı; bağımlılık güvenlik sonucu elde edilemedi.
- Linux systemd, gerçek Telegram hesabı, webhook/poller, backup/restore ve reverse proxy akışları bu Windows ortamında doğrulanamadı.
- Ayrıntılı self-host bulguları: `ai-memory/review/ops-audit.md`.

## Kritik / yüksek öncelikli eksikler

### 1. Bot API poller Linux servis zincirinde yok — CRITICAL

- `scripts/telegram_long_poll.py` mevcut ve Windows başlangıcında çalıştırılıyor (`scripts/start-local-telegram.ps1:7-10,164`).
- Linux bootstrap yalnızca web ve MTProto listener'ı başlatıyor (`deploy/relaydesk-bootstrap.sh:12-16`); Bot API poller için unit/wrapper yok.
- Kurulum köprüsü webhook'u sildiği için (`scripts/local_setup_bridge.py:145`) Business/private mesajların Linux'ta web'e ulaşacağı bir alım yolu kalmıyor.
- **Eklenmeli:** `telegram_long_poll.py` için systemd unit, restart/log politikası ve gerçek private/business mesaj → route → SQLite testi.

### 2. Ortam dosyaları birbirinden kopuk — CRITICAL

- Web `.env.production`, listener ve setup bridge `.env.local` okuyor (`deploy/*.service`).
- Wizard bot token/webhook secret'i `.env.local`'e yazıyor (`scripts/local_setup_bridge.py:33-35,146-152`).
- Web process'i eski/boş `.env.production` ile çalışmaya devam ediyor; route'lar 503/401 dönebilir.
- **Eklenmeli:** Tek secret kaynağı veya kontrollü senkronizasyon + servis restart/rotasyon prosedürü.

### 3. Self-host kurulumunda servis hesabı ve dosya sahipliği provision edilmiyor — CRITICAL

- Web unit `User=relaydesk` bekliyor (`deploy/relaydesk-web.service:5-10`).
- README/bootstrap `relaydesk` hesabını, `/opt/relaydesk` sahipliğini, `/var/lib/relaydesk` yazma izinlerini veya env dosyası izinlerini oluşturmuyor.
- **Eklenmeli:** Fresh Debian/Ubuntu host kurulumu; `relaydesk` kullanıcı/grup, data dizini, sahiplik/ACL, env/session izinleri ve `systemd-analyze verify`.

### 4. Setup bridge SSH tünelinde eksik port — CRITICAL

- Bridge sunucuda `127.0.0.1:8765` dinliyor (`scripts/local_setup_bridge.py:43-44`).
- Browser `http://127.0.0.1:8765` adresine gider (`app/api/local-setup/route.ts:18`, `app/setup-wizard.tsx:72`).
- README yalnızca `3000` portunu tünelliyor (`README.md:152-156`). Kullanıcının bilgisayarındaki `127.0.0.1:8765`, sunucunun bridge'i değildir.
- **Eklenmeli:** `ssh -L 3000:localhost:3000 -L 8765:localhost:8765 ...` dokümantasyonu veya aynı-origin proxy.

### 5. Bootstrap health-check yanlış endpoint'i kullanıyor — HIGH

- `deploy/relaydesk-bootstrap.sh:20-30`, auth/cookie olmadan `/api/status` çağırıyor.
- `/api/status` `requireActor` ile 401 döndürüyor (`app/api/status/route.ts:36-39`).
- Sağlıklı servis bile bootstrap'ta 30 saniye sonra başarısız görünür.
- **Eklenmeli:** Auth gerektirmeyen yalnızca localhost readiness endpoint'i veya `/api/auth/setup` gibi uygun bir liveness kontrolü.

### 6. Login ve session auth brute-force/rate-limit korumasız — HIGH

- `/api/auth/login` için IP/hesap başına rate limit, lockout, audit veya gecikmeli başarısızlık mekanizması yok (`app/api/auth/login/route.ts:8-30`).
- PBKDF2 doğrulaması pahalı olduğundan endpoint DoS ve parola denemelerine açık.
- **Eklenmeli:** reverse-proxy/app rate limit, başarısız deneme sayacı, güvenli audit ve gerekirse MFA/SSO kararı.

### 7. Self-host'ta güvenilmeyen workspace header auth fallback'i var — HIGH/CRITICAL (deployment modeline bağlı)

- `lib/auth.ts:113-145`, `oai-authenticated-user-email` header'ını doğrulanmış bir proxy kaynağı kontrol etmeden actor'a dönüştürüyor.
- Self-host public erişimde header gönderen bir istemci, allowlist uygunsa parola oturumu olmadan kullanıcı kimliğine bürünebilir.
- **Eklenmeli:** Bu fallback'i yalnızca açıkça etkinleştirilmiş ve güvenilir hosting proxy arkasında çalıştırmak; self-host'ta yalnızca session auth kullanmak.

### 8. İç servisler public route + ortak webhook secret kullanıyor — HIGH

- `/api/telegram/import`, `/api/telegram/user-listener` ve klasör POST akışı yalnızca `TELEGRAM_WEBHOOK_SECRET` ile korunuyor; browser/admin session gerektirmiyor.
- Aynı secret Telegram webhook'u, MTProto listener'ı ve iç import/heartbeat için paylaşılıyor (`app/api/telegram/*.ts`, `scripts/telegram_user_long_poll.py`).
- Secret'ı bilen biri sahte mesaj, heartbeat veya klasör ataması gönderebilir.
- **Eklenmeli:** Ayrı `INTERNAL_API_SECRET`, localhost/firewall kısıtı, imzalı istek/nonce ve mümkünse internal route'ları dış ingress'ten ayırma.

### 9. SQLite backup/restore ve disaster recovery yok — CRITICAL

- Backup script/timer, retention, off-host kopya veya restore prosedürü yok (`deploy/`, `README.md:121-160`).
- WAL modu kullanılıyor (`db/index.ts:11-15`); yalnızca `.sqlite` dosyasını kopyalamak güvenilir backup değildir.
- **Eklenmeli:** online backup/checkpoint, şifreli kopya, retention, disk alarmı, `PRAGMA integrity_check` ve ayrı host restore provası.

### 10. User-level listener reboot/logout sonrası kalıcılığı garanti edilmiyor — HIGH

- Listener `WantedBy=default.target` ile user service (`deploy/relaydesk-listener.service:14-15`).
- `loginctl enable-linger` kurulumu yok; systemd üzerinde gerçek reboot/logout testi yapılmamış.
- **Eklenmeli:** linger provision veya system-level `User=` unit; reboot/network restart ve 90 saniyelik heartbeat testi.

### 11. Secret dosyaları ve token aktarımı güvenli biçimde zorlanmıyor — HIGH

- `configure-local-telegram.sh:28-44`, bot token'ı Python process argv'sine koyuyor.
- `.env.local` yazımında `umask 077`, `chmod 600`, owner ve başarısızlık cleanup garantisi yok (`deploy/configure-local-telegram.sh:52-62`).
- Bridge'in `update_env` yolu da yeni env dosyasını güvenli izinle oluşturmuyor (`scripts/local_setup_bridge.py:76-93`).
- **Eklenmeli:** stdin/credential kullanımı, `umask 077`, atomic replace sonrası `chmod/chown`, temp cleanup ve `/proc` kontrolü.

### 12. Mesaj alım kuyruğu process belleğinde — HIGH

- MTProto listener `asyncio.Queue(maxsize=5000)` kullanıyor (`scripts/telegram_user_long_poll.py:453`).
- Import başarısızlığında sonsuz retry var; process kill/OOM/reboot sırasında henüz SQLite'a yazılmamış öğeler kaybolabilir (`:418-433`).
- **Eklenmeli:** disk tabanlı durable outbox/spool, idempotent replay, queue-depth alarmı ve graceful drain.

### 13. Reply outbox/retry eksikliği bilinçli kapsam dışı ama üretim riski — HIGH

- `app/api/reply/route.ts:41-85`, Telegram gönderimi hata verince metni kaydetmeden 502 dönüyor.
- Bu durum README'de belirtilmiş, ancak destek çalışanının yazdığı yanıt kalıcı olarak kayboluyor.
- **Eklenmeli:** outbox tablosu, retry/backoff, durum takibi ve kullanıcıya “beklemede/tekrar denenecek” UX'i.

### 14. Reverse proxy arkasında webhook URL'si güvenilir/canonical değil — HIGH

- `app/api/telegram/configure/route.ts:16-20`, webhook URL'sini gelen request origin'inden üretiyor.
- Proxy iç origin'i dış URL yerine kullanıyorsa Telegram yanlış adrese webhook kurabilir.
- **Eklenmeli:** güvenilir `PUBLIC_BASE_URL`/canonical origin ve trusted proxy doğrulaması; `getWebhookInfo` ile gerçek uçtan uca test.

## Orta / düşük öncelikli eksikler

### 15. Test kapsamı yetersiz — HIGH

- Tek test `tests/rendered-html.test.mjs` statik dosya eşleşmeleri ve build çıktısını kontrol ediyor.
- Auth, session expiry, webhook idempotency, DB migration, Telegram parser, reply failure, media limits, internal secret, Python listener ve systemd için unit/integration/e2e test yok.
- **Eklenmeli:** TDD ile route/auth/DB testleri, Telegram fixture testleri, Playwright smoke ve Linux CI matrix.

### 16. Liste ve mesaj pagination yok — MEDIUM

- Conversations 250, messages 500 satırla sınırlı; `/api/messages` eski mesajları döndürüyor (`app/api/conversations/route.ts:11-16`, `app/api/messages/route.ts:27-32`).
- Büyüyen ekip/veri hacminde eski konuşmalar görünmez, mesaj yükleme pahalı olur.
- **Eklenmeli:** cursor pagination, server-side search/filter ve indeks/retention politikası.

### 17. Polling ölçeklenebilir değil — MEDIUM

- Her browser conversation listesi için 2 sn, seçili mesajlar için 1.2 sn polling yapıyor (`app/support-desk.tsx:148-172`).
- Çoklu ekipte gereksiz SQLite/read yükü ve yarışan istekler oluşabilir.
- **Eklenmeli:** visibility-aware/backoff polling, ETag/Last-Modified veya SSE/WebSocket.

### 18. CSRF koruması tüm state-changing endpoint'lerde tutarlı değil — MEDIUM

- Bazı route'lar `isSameOriginRequest` kullanırken reply/media, conversations PATCH ve Telegram configure gibi route'larda aynı kontrol yok.
- `SameSite=Lax` tek savunma olarak bırakılmamalı.
- **Eklenmeli:** tüm cookie-authenticated mutation route'larında origin/CSRF kontrolü ve negatif testler.

### 19. A11y modal davranışları tamamlanmamış — MEDIUM

- Dialog'larda `role="dialog"` var; fakat statik incelemede focus trap, açılışta focus, Escape ile kapanma ve kapanınca önceki elemana focus dönüşü yok (`app/setup-wizard.tsx`, `app/account-ui.tsx`, `app/folder-rules-panel.tsx`, `app/message-log-panel.tsx`).
- **Eklenmeli:** WCAG 2.2 AA keyboard/screen-reader testi.

### 20. Sistem güvenlik başlıkları tanımlı değil — MEDIUM

- `next.config.ts` yalnızca native package externalization içeriyor; CSP, HSTS, frame-ancestors/X-Frame-Options, Referrer-Policy ve nosniff başlıkları için yapılandırma yok.
- **Eklenmeli:** proxy veya uygulama katmanında güvenlik başlıkları ve Telegram medya Content-Disposition/nosniff politikası.

### 21. Üretim allowlist'i hardcode ediliyor — HIGH / kullanıcı teyidi gerekli

- `deploy/configure-local-telegram.sh:52-61` `SUPPORT_ALLOWED_EMAILS` değerini `demo@relaydesk.local,indafelhayat@gmail.com` olarak sabitliyor.
- Gerçek üretim ekibini dışarıda bırakabilir veya istenmeyen hesabı yetkilendirebilir.
- **Eklenmeli:** mevcut değeri koru veya interaktif/secret-managed allowlist iste; adresler kullanıcı tarafından onaylanmalı.

### 22. UI metni Linux migrasyonuyla çelişiyor — LOW

- `app/setup-wizard.tsx:204` “Windows kasasında şifrelendi” diyor; hedef Linux self-host.
- **Düzeltilmeli:** platformdan bağımsız “sunucuda şifreli oturum olarak saklandı” metni.

## Önerilen uygulama sırası

1. Bot API poller unit'i + env/secret modelini tekleştirme.
2. Fresh Linux provision: servis hesabı, izinler, data/env/session dizinleri, bridge için iki port tüneli.
3. Auth hardening: workspace fallback kararı, rate limit, internal secret ayrımı, CSRF.
4. Bootstrap/readiness, history sync ve reverse proxy canonical URL düzeltmeleri.
5. Backup/restore ve systemd hardening/monitoring.
6. Outbox/durable queue ve pagination/polling ölçekleme.
7. Gerçek Linux E2E + güvenlik/erişilebilirlik testleri.

## Sonuç

Kod kalite kontrolleri geçse de proje şu an **production-ready değil**. En az 1–5 ve 9–11 maddeleri düzeltilip fresh Linux hostta doğrulanmadan build teslimi onaylanmamalı.

STATUS: READY_FOR_DELIVERY
