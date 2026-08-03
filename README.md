# RelayDesk

RelayDesk, tek bir Telegram Business hesabını birden fazla destek çalışanının kullanabildiği ortak ekip gelen kutusuna dönüştürür. Çalışanlar Telegram hesabının şifresini veya oturumunu paylaşmaz; web panelinde kendi kimlikleriyle çalışır.

## Neler var?

- Telegram `business_message`, düzenleme ve silme güncellemelerini webhook ile alma
- Özel sohbetleri ve grupları tek gelen kutusunda gösterme
- Gerçek zamanlıya yakın otomatik yenileme ve güncelleme tekilleştirme
- Sohbet atama, durum ve öncelik yönetimi
- Telegram sohbet klasörlerini çalışanlara otomatik yönlendirme
- Metin, fotoğraf, belge, ses, video ve konum desteği
- Telegram Business hesabı adına yanıt gönderme
- Yerel SQLite üzerinde kalıcı sohbet, mesaj, kullanıcı ve denetim kayıtları
- Yetkili e-posta listesiyle korunan ekip paneli
- Webhook gizli anahtarı doğrulaması

## Üretim kurulumu

1. Telegram'da `@BotFather` ile `/newbot` komutunu çalıştırıp bot oluşturun.
2. BotFather'da botun ayarlarından **Secretary Mode / Business Mode** özelliğini etkinleştirin.
3. Bot token'ını güvenli biçimde `TELEGRAM_BOT_TOKEN` değişkenine ekleyin.
4. Yalnızca `A-Z`, `a-z`, `0-9`, `_` ve `-` karakterlerinden oluşan güçlü bir `TELEGRAM_WEBHOOK_SECRET` belirleyin.
5. Paneli kullanabilecek e-postaları virgülle ayırarak `SUPPORT_ALLOWED_EMAILS` değişkenine yazın.
6. Yayınlanan RelayDesk panelinde **Webhook’u etkinleştir** düğmesine basın.
7. Normal Telegram hesabında **Ayarlar → Telegram Business → Sohbet Botları / Chatbots** bölümünü açın, oluşturduğunuz botu bağlayın.
8. Botun erişeceği mevcut/yeni sohbetleri, kişi/kişi olmayan filtrelerini ve yanıt yetkisini seçin.
9. Grup desteği için aynı botu ilgili gruplara ekleyin. BotFather'da **Group Privacy** ayarını kapatın veya botu grupta yönetici yapın; aksi halde bot yalnızca komut, etiketleme ve kendisine verilen yanıtları görebilir.
10. Başka bir Telegram hesabından destek hesabına ve test grubuna mesaj gönderin; konuşmalar RelayDesk gelen kutusunda görünmelidir.

Özel müşteri sohbetlerinde yanıtlar bağlı normal Business hesabı adına gönderilir. Gruplarda Bot API sınırı nedeniyle yanıt gönderen kimlik bottur. Gruplarda da normal hesap kimliği zorunluysa Bot API yerine telefonla oturum açan ayrı bir TDLib hizmeti gerekir.

Bot token'ı bir parola gibi korunmalıdır. Kaynak dosyaya veya tarayıcı koduna yazmayın.

## Yerel geliştirme

Node.js `>=22.13.0` gerekir.

```bash
Copy-Item .env.example .env.local
npm install
npm run dev
```

Ardından `http://localhost:3000` adresini açın. Yerel veriler `DATABASE_PATH`'in işaret ettiği SQLite dosyasında (varsayılan: `./data/relaydesk.sqlite`) tutulur.

## Premium olmadan Business bot bağlama

Telegram uygulaması bağlı bot ekranını ücretli pakete yönlendiriyorsa, `my.telegram.org` üzerinden alınan `api_id` ve `api_hash` ile tek kullanımlık bağlantı aracı çalıştırılabilir:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\connect-telegram-business.ps1
```

Araç bilgileri yalnızca terminal belleğinde tutar, oturum dosyası oluşturmaz ve bot bağlandıktan sonra Telegram kullanıcı oturumunu kapatır. `api_hash`, giriş kodu ve iki aşamalı doğrulama parolası kaynak dosyalara yazılmaz.

## Public adres olmadan yerel Telegram bağlantısı

Yerel RelayDesk'i başlatmak için:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local-telegram.ps1
```

Ardından `http://localhost:3000` adresini açın. İlk yönetici hesabını oluşturduktan sonra kurulum sihirbazı otomatik açılır ve aşağıdaki adımları tek ekranda tamamlatır:

1. BotFather'da bot oluşturma ve Business Mode'u açma
2. Bot token'ını doğrulama ve yerel long polling ayarı
3. `my.telegram.org` API bilgileriyle normal Telegram hesabını bağlama
4. Telegram giriş kodu ve varsa iki aşamalı doğrulama
5. Business bot okuma/yanıtlama yetkilerini bağlama
6. Takip edilen grup, forum ve kanalların canlı dinleyicisini başlatma

Token, `api_hash`, giriş kodu ve 2FA parolası kurulum sırasında yalnızca yerel bilgisayarda işlenir. Telegram kullanıcı oturumu `SESSION_ENCRYPTION_KEY` ile anahtarlanan Fernet şifrelemesiyle korunur; SQLite mesaj veritabanına veya ekip tarayıcılarına yazılmaz.

`RelayDesk Telegram Bağlantısı` terminali açık kaldığı sürece bot mesajları alınır. Yerel kurulum köprüsü yalnızca `127.0.0.1` adresinde çalışır, rastgele kurulum anahtarı ister ve ayar uçları yalnızca yönetici hesabına açılır.

### Takip edilen grup ve kanalları canlı bağlama

Normal Telegram hesabınızda takip ettiğiniz grup, süpergrup, forum konusu ve kanalların bot eklemeden panele akması için panelde **Kurulum → Grup ve kanal akışı** adımını tamamlayın.

Terminal tabanlı yedek kurulum gerekirse aşağıdaki araç hâlâ kullanılabilir:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\configure-telegram-user-listener.ps1
```

1. `my.telegram.org` üzerinden aldığınız `api_id` değerini girin.
2. `api_hash` değerini girin; yazarken terminalde görünmez.
3. Telefon numaranızı ülke koduyla yazın ve Telegram uygulamasına gelen giriş kodunu girin.
4. Hesapta iki aşamalı doğrulama varsa parolayı girin; bu değer de terminalde görünmez.
5. Başarılı bağlantıdan sonra `RelayDesk Grup ve Kanal Akışı` penceresini açık bırakın.

Oturum `.telegram-user-session.enc` dosyasında `SESSION_ENCRYPTION_KEY` ile anahtarlanan Fernet şifrelemesiyle korunur; Git tarafından yok sayılır. `api_hash`, Telegram oturumu ve giriş bilgileri SQLite veritabanına veya tarayıcıya yazılmaz. Daha sonraki RelayDesk başlangıçlarında dinleyici otomatik açılır.

İlk bağlantıda daha önce panele hiç gelmemiş her uygun sohbetin son 100 mesajı alınır. Sonraki başlangıçlarda panelde kayıtlı son Telegram mesaj kimliğinden sonraki iletiler tamamlanır; ardından yeni mesajlar ve düzenlemeler canlı aktarılır.

Takip edilen sohbetleri **okumak** için botun gruba eklenmesi gerekmez. Bu sohbetlere panelden **yanıt göndermek** için mevcut sürümde botun ilgili grupta bulunması ve gönderme yetkisine sahip olması gerekir.

### Telegram klasörlerini çalışanlara yönlendirme

1. Normal Telegram hesabında **Ayarlar → Sohbet Klasörleri** bölümünden klasör oluşturun.
2. İlgili özel sohbetleri, grupları veya kanalları bu klasöre ekleyin.
3. RelayDesk'te yönetici hesabıyla **Klasör atamaları** ekranını açın.
4. Telegram klasörünün karşısından sorumlu çalışanı seçin.

Klasör üyelikleri çalışan dinleyici tarafından en geç 30 saniyede bir yenilenir. Klasöre sonradan eklenen konuşmalar otomatik atanır; klasörden çıkarılan konuşmaların yalnızca klasör kaynaklı ataması kaldırılır. RelayDesk'te elle yapılmış kişi atamaları klasör senkronu tarafından değiştirilmez. Bir sohbet birden fazla atanmış klasörde bulunuyorsa en son değiştirilen klasör kuralı geçerlidir.

### Eski sohbetleri ve grupları içe aktarma

Bot API geçmiş mesajları geriye dönük vermediği için ilk kurulumdan önceki özel sohbetler ve gruplar tek kullanımlık kullanıcı API oturumuyla içe aktarılır:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-telegram-history.ps1
```

Varsayılan olarak en son 100 uygun sohbetten, sohbet başına son 100 mesaj alınır; bu sayılar terminalde değiştirilebilir. Araç özel sohbetleri, normal grupları, süper grupları ve yayın kanallarını aktarır; bot sohbetlerini atlar. Giriş bilgileri bellekte tutulur, kalıcı kullanıcı oturumu oluşturulmaz ve işlem sonunda oturum kapatılır.

Yeni grup ve kanal mesajlarını bot üyeliği olmadan senkron tutmak için yukarıdaki kalıcı kullanıcı dinleyicisini kullanın. Panelden Bot API ile grup yanıtı göndermek için botun ilgili grupta bulunması gerekir.

## Linux/systemd ile bağımsız çalıştırma (self-host)

RelayDesk artık Cloudflare D1/Workers'a bağımlı değil: veritabanı yerel SQLite'dır (`better-sqlite3`) ve web paneli Node sunucusu olarak çalışır. Desteklenen servis modeli web, Bot API poller, MTProto listener ve kurulum bridge'inin **aynı `relaydesk` kullanıcısıyla system-level systemd unit** olarak çalışmasıdır.

### Fresh host kurulumu

```bash
sudo mkdir -p /opt
sudo git clone <repo> /opt/relaydesk
cd /opt/relaydesk
sudo bash deploy/provision-relaydesk.sh
sudo bash deploy/relaydesk-bootstrap.sh
```

`provision-relaydesk.sh` `relaydesk` kullanıcı/grubunu, `/opt/relaydesk`, `/var/lib/relaydesk` ve 600 izinli `.env.local` dosyasını oluşturur; native `better-sqlite3`, Python venv/Telethon bağımlılıklarını kurar; unit'leri yükler ve `systemd-analyze verify` çalıştırır. Node.js 22+, Python 3/venv ve systemd hostta önceden bulunmalıdır. Windows'tan `node_modules` kopyalamayın; `npm ci` native binding'i Linux'ta kurar.

### Tek env ve polling modeli

Tüm servislerin tek yapılandırma kaynağı `/opt/relaydesk/.env.local` dosyasıdır; `.env.production` kullanılmaz. Bridge bot tokenı ve secret'ları atomic olarak bu dosyaya yazar, ardından web, poller ve listener'ı yeniden başlatır. Manuel secret rotasyonundan sonra:

```bash
sudo chmod 600 /opt/relaydesk/.env.local
sudo systemctl restart relaydesk-web.service relaydesk-telegram-poller.service relaydesk-listener.service
```

Bot alım modeli bilinçli olarak **webhook değil, Bot API long polling**'dir. Bridge `deleteWebhook(drop_pending_updates=false)` çağırır; `relaydesk-telegram-poller.service` `getUpdates` ile private/business mesajları alır ve yerel `/api/telegram/webhook` route'una iletir. Poller `Restart=on-failure` ve exponential backoff kullanır. `getWebhookInfo`'da URL boş olmalıdır.

`SESSION_ENCRYPTION_KEY` Fernet anahtarı, `INTERNAL_API_SECRET` ve `LOCAL_SETUP_TOKEN` gerçek secret'lardır: `/opt/relaydesk/.env.local` yalnızca `relaydesk` tarafından okunabilir (`chmod 600`) ve secret rotasyonunda ilgili servisler restart edilmelidir. Şifreli MTProto session `/var/lib/relaydesk/telegram-user-session.enc` altında tutulur; session ve anahtar birlikte korunmadan restore edilemez.

### Setup wizard ve SSH tüneli

Kurulum bridge'i `127.0.0.1:8765` üzerinde kalır ve public açılmaz. Web paneli `127.0.0.1:3000` üzerinde ise iki portu birlikte tünelleyin:

```bash
sudo systemctl start relaydesk-setup-bridge.service
ssh -L 3000:localhost:3000 -L 8765:localhost:8765 kullanici@sunucu
```

Ardından yerel tarayıcıda `http://localhost:3000` adresini açın. Telegram kullanıcı hesabı bağlandıktan sonra bridge `relaydesk-listener.service`'i systemd üzerinden başlatır. Session yokken listener unit'i `ConditionPathExists=/var/lib/relaydesk/telegram-user-session.enc` nedeniyle başlatılmaz; anlamsız restart loop oluşmaz.

### Readiness ve history sync

Bootstrap yalnızca localhost'a bağlı `/api/healthz` endpoint'ini kontrol eder. Panel durumunu veren `/api/status` anonim değildir ve auth gerektirir. History sync, localhost ile sınırlı ve `INTERNAL_API_SECRET` header'ı isteyen `/api/internal/status` endpoint'ini kullanır; bu nedenle status adımında 401 ile kesilmez.

### DPAPI → Fernet geçişi (tek seferlik yeniden giriş)

Eski Windows `.telegram-user-session.dpapi` dosyaları Linux'ta çalışmaz ve otomatik göç edilmez. Yeni dosya `.telegram-user-session.enc` olduğundan Linux sunucusunda Telegram hesabına bir kez daha giriş yapmanız gerekir.

### Reverse proxy notu

SSH-only modelde 3000/8765 portlarını firewall ile dışarı kapalı tutun. nginx/Caddy arkasında TLS sonlandırıyorsanız `VINEXT_TRUST_PROXY=1` (veya `VINEXT_TRUSTED_HOSTS`) ayarlayın.

### Bilinen sınırlama (bu migrasyonun kapsamı dışında)

`app/api/reply/route.ts`'de Telegram `sendMessage` çağrısı başarısız olursa istek `502` ile döner ve mesaj hiçbir yere (ne `messages`, ne `auditLogs`, ne `messageLogs`) kaydedilmeden **sunucu tarafında kaybolur** — çalışanın yazdığı metin kurtarılamaz. Bu gerçek bir dayanıklılık boşluğudur ama bir `outbox` tablosu + retry/backoff mekanizması gerektirir; bu Linux self-host migrasyonunun kapsamı yalnızca MTProto dinleyicisinin kendi reconnect/backoff davranışıyla sınırlıdır ve `reply/route.ts` bu turda değiştirilmemiştir.

## Kontroller

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

## Sunucu değişkenleri

| Değişken | Açıklama |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather tarafından verilen gizli bot token'ı |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram webhook isteklerini doğrulayan gizli değer |
| `SUPPORT_ALLOWED_EMAILS` | Panele girebilecek virgülle ayrılmış e-posta listesi |
| `LOCAL_SETUP_TOKEN` | Yalnızca localhost kurulum köprüsünü yetkilendiren rastgele yerel anahtar |
| `DATABASE_PATH` | Yerel SQLite veritabanı dosya yolu (örn. `/var/lib/relaydesk/relaydesk.sqlite`) |
| `SESSION_ENCRYPTION_KEY` | Telegram kullanıcı oturumunu şifreleyen Fernet anahtarı — bir SSH private key gibi korunmalı |

Webhook yolu: `/api/telegram/webhook`
