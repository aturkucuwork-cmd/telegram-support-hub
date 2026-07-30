# RelayDesk

RelayDesk, tek bir Telegram Business hesabını birden fazla destek çalışanının kullanabildiği ortak ekip gelen kutusuna dönüştürür. Çalışanlar Telegram hesabının şifresini veya oturumunu paylaşmaz; web panelinde kendi kimlikleriyle çalışır.

## Neler var?

- Telegram `business_message`, düzenleme ve silme güncellemelerini webhook ile alma
- Özel sohbetleri ve grupları tek gelen kutusunda gösterme
- Gerçek zamanlıya yakın otomatik yenileme ve güncelleme tekilleştirme
- Sohbet atama, durum ve öncelik yönetimi
- Metin, fotoğraf, belge, ses, video ve konum desteği
- Telegram Business hesabı adına yanıt gönderme
- D1 üzerinde kalıcı sohbet, mesaj, kullanıcı ve denetim kayıtları
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

Ardından `http://localhost:3000` adresini açın. Yerel D1 verisi vinext geliştirme ortamı tarafından sağlanır.

## Premium olmadan Business bot bağlama

Telegram uygulaması bağlı bot ekranını ücretli pakete yönlendiriyorsa, `my.telegram.org` üzerinden alınan `api_id` ve `api_hash` ile tek kullanımlık bağlantı aracı çalıştırılabilir:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\connect-telegram-business.ps1
```

Araç bilgileri yalnızca terminal belleğinde tutar, oturum dosyası oluşturmaz ve bot bağlandıktan sonra Telegram kullanıcı oturumunu kapatır. `api_hash`, giriş kodu ve iki aşamalı doğrulama parolası kaynak dosyalara yazılmaz.

## Public adres olmadan yerel Telegram bağlantısı

Business bot bağlantısı tamamlandıktan sonra yerel RelayDesk'i başlatmak için:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-local-telegram.ps1
```

İlk çalıştırmada BotFather token'ı gizli olarak sorulur. Token yalnızca Git tarafından yok sayılan `.env.local` dosyasına kaydedilir. Araç RelayDesk sunucusunu yeni ayarlarla başlatır ve Telegram güncellemelerini `getUpdates` long polling yöntemiyle yerel webhook'a aktarır.

`RelayDesk Telegram Bağlantısı` terminali açık kaldığı sürece yeni mesajlar alınır. Daha önce botta bir public webhook tanımlıysa araç, onu kaldırmadan önce onay ister ve bekleyen güncellemeleri silmez.

### Eski sohbetleri ve grupları içe aktarma

Bot API geçmiş mesajları geriye dönük vermediği için ilk kurulumdan önceki özel sohbetler ve gruplar tek kullanımlık kullanıcı API oturumuyla içe aktarılır:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-telegram-history.ps1
```

Varsayılan olarak en son 100 uygun sohbetten, sohbet başına son 100 mesaj alınır; bu sayılar terminalde değiştirilebilir. Araç yalnızca özel sohbetleri, normal grupları ve süper grupları aktarır; yayın kanallarını ve bot sohbetlerini atlar. Giriş bilgileri bellekte tutulur, kalıcı kullanıcı oturumu oluşturulmaz ve işlem sonunda oturum kapatılır.

Gruplardaki yeni mesajların senkron kalması ve panelden yanıt verilebilmesi için botun her ilgili gruba eklenmesi gerekir. Tüm normal grup mesajlarını almak için BotFather'da **Group Privacy** kapatılmalı veya bot grupta yönetici olmalıdır.

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

Webhook yolu: `/api/telegram/webhook`
