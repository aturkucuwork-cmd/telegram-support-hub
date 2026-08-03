# P0 Linux retest runbook

Bu runbook gerçek Debian/Ubuntu host içindir. `p0-linux-retest.sh` güvenli
varsayılanlarla yalnızca doğrulama yapar; provision, restart, Telegram mesajı
gönderme veya secret yazdırma yapmaz.

## 1. Fresh host hazırlığı

Temiz hostta, gerçek secret'ları terminal geçmişine koymadan:

```bash
sudo git clone <repo-url> /opt/relaydesk
cd /opt/relaydesk
sudo bash deploy/provision-relaydesk.sh
```

Provision sonrası `/opt/relaydesk/.env.local` dosyasını yalnız `relaydesk`
okuyacak şekilde doldurun (`chmod 600`, gerçek değerleri loglara yazmayın).
Ardından:

```bash
sudo bash deploy/relaydesk-bootstrap.sh
sudo bash deploy/p0-linux-retest.sh --security --harness --telegram
```

Runner `FAIL` veya `NOT RUN` sayısını özetler ve bunlardan biri varsa exit 2
döner. `PASS` sonucu yalnız çalıştırılan kontrolün kanıtıdır; gerçek Telegram
mesajı, fresh-host ve ayrı-host restore adımları ayrıca tamamlanmalıdır.

## 2. Beklenen systemd ve readiness kanıtı

```bash
sudo systemd-analyze verify /etc/systemd/system/relaydesk-*.service /etc/systemd/system/relaydesk-backup.timer
sudo systemctl is-system-running
sudo systemctl is-enabled relaydesk-web.service relaydesk-telegram-poller.service relaydesk-listener.service
sudo systemctl is-active relaydesk-web.service relaydesk-telegram-poller.service relaydesk-listener.service
curl -fsS http://127.0.0.1:3000/api/healthz
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/status
```

Son komut `401` dönmelidir; `/api/status` anonim erişime açılmamalıdır.
`/api/healthz` `200` ve `{"ok":true,"ready":true}` dönmelidir.

## 3. SSH wizard ve iki port

Bridge yalnız loopback'te çalıştırılır:

```bash
sudo systemctl start relaydesk-setup-bridge.service
ssh -L 3000:localhost:3000 -L 8765:localhost:8765 kullanici@sunucu
```

Temiz uzak tarayıcıda `http://localhost:3000` açın ve sırayla status, bot
config, Telegram kullanıcı girişi ve listener start adımlarını tamamlayın.
Bridge adresi veya secret tarayıcı çıktısında görünmemelidir.

## 4. Gerçek Bot API → SQLite kanıtı

`--telegram` yalnız `getWebhookInfo` çağırır ve webhook URL'sinin boş olduğunu
kontrol eder. Gerçek ingestion için operatör, test private/business mesajını
göndermeli; sonra uygulamanın SQLite kaydını ve journal logunu eşleştirmelidir:

```bash
sudo journalctl -u relaydesk-telegram-poller.service --since '5 minutes ago'
sudo sqlite3 /var/lib/relaydesk/relaydesk.sqlite \
  'SELECT id, chat_id, substr(body,1,80) FROM messages ORDER BY id DESC LIMIT 5;'
```

Mesaj metni ve chat bilgisi kanıt dosyasına yazılacaksa secret değil sentetik
test içeriği kullanılmalıdır. Gerçek token veya kullanıcı verisi commit/loglara
eklenmemelidir.

## 5. Backup, restore ve ayrı-host tatbikatı

Önce online backup ve bütünlük kontrolü:

```bash
sudo systemctl start relaydesk-backup.service
sudo journalctl -u relaydesk-backup.service --no-pager
sudo sqlite3 /var/lib/relaydesk/backup/relaydesk-<timestamp>.sqlite \
  'PRAGMA integrity_check;'
```

Restore tatbikatı, üretim hostundan farklı temiz bir Debian/Ubuntu hostta
yapılmalıdır. Kaynak backup'ı güvenli kanaldan kopyalayıp `integrity_check`,
kayıt sayısı/gövde karşılaştırması ve uygulama açılışını doğrulayın. Üretim
restore için servis durumunu koruyan script kullanılır:

```bash
sudo /opt/relaydesk/deploy/restore-relaydesk.sh \
  /var/lib/relaydesk/backup/relaydesk-<timestamp>.sqlite
```

Canlı WAL writer/restore testi yalnızca bakım penceresinde, geri dönüş planı ve
ayrı backup kopyası ile yapılmalıdır. `tests/restore-relaydesk.integration.sh`
gerçek systemd değildir; fake-systemctl harness'ıdır ve production kanıtı
olarak sınıflandırılamaz.

## 6. Kanıt sınıflandırması

| Kontrol | Bu Windows makinesinde | Gerçek Linux hostta gerekli |
|---|---|---|
| Node build/lint/tsc/Python/shell syntax | Çalıştırılabilir | Tekrar çalıştırılmalı |
| WSL fake-systemctl restore harness | Çalıştırılabilir | Ek kanıt, production değil |
| `systemd-analyze` ve gerçek unit geçişleri | **NOT RUN** | Zorunlu |
| Fresh provision, izinler, reboot/logout/network recovery | **NOT RUN** | Zorunlu |
| Telegram `getWebhookInfo` ve gerçek mesaj → SQLite | **NOT RUN** | Zorunlu |
| SSH iki-port wizard | **NOT RUN** | Zorunlu |
| Concurrent WAL ve ayrı-host restore | **NOT RUN** | Zorunlu |

Gerçek `TELEGRAM_BOT_TOKEN`, `SESSION_ENCRYPTION_KEY` ve
`INTERNAL_API_SECRET` bu Windows process'inde mevcut değil. Bu nedenle bu
makinedeki sonuçlar gerçek Telegram/fresh-host başarısı olarak raporlanamaz.
