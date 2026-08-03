# Brief — RelayDesk'i Linux sunucuda tam bağımsız çalışır hale getirme

**Talep eden:** Kullanıcı (proje sahibi)
**Tarih:** 2026-08-01
**Tür:** Altyapı/mimari migrasyon (içerik/tasarım/SEO gerektirmiyor — Barış tarafından doğrudan mimari + build aşamalarıyla yürütülüyor, kreatif/veri/UX/SEO/içerik aşamaları bu görev için uygulanmıyor).

## İstek

Proje şu an Windows'a ve Cloudflare'a bağımlı:
- Veritabanı: Cloudflare D1 (`drizzle-orm/d1`, `env.DB` binding) — sadece Workers runtime'ında çalışır.
- Build zinciri: `vite.config.ts` zorunlu `@cloudflare/vite-plugin` kullanıyor, `worker/index.ts` Cloudflare Worker `fetch` girişi.
- Telegram kullanıcı-oturumu (MTProto): `scripts/telegram_user_session.py` Windows DPAPI'ye kilitli (`os.name != "nt"` → RuntimeError).
- Orkestrasyon: PowerShell (`.ps1`) script'leri.

Kullanıcı hedefi: **Her şeyi (web paneli + MTProto dinleyici + kurulum otomasyonu) tek bir Linux sunucuda, systemd ile kalıcı servisler olarak, dış bulut bağımlılığı olmadan çalıştırmak.** Kullanıcının kendi sözleriyle: "mümkün olduğunda dışarda data olmasın veya dışarda sıkıntı olduğunda çalışmaya devam etmesi gerekiyor."

## Onaylanan kararlar (kullanıcıyla netleştirildi)

1. **Kapsam:** Cloudflare D1/Workers tamamen kaldırılıyor, yerel SQLite (better-sqlite3) kullanılıyor. Web app + MTProto dinleyici + setup bridge hepsi aynı Linux sunucuda.
2. **Şifreleme:** DPAPI yerine `SESSION_ENCRYPTION_KEY` ortam değişkeninden anahtarlı **Fernet** (cryptography kütüphanesi) — OS anahtarlığı (keyring/dbus) reddedildi çünkü headless sunucuda ek bağımlılık gerektiriyor.

## Kapsam dışı (bilinçli olarak bu turda yapılmıyor)

`app/api/reply/route.ts`'de Telegram `sendMessage` başarısız olursa mesaj hiçbir yere kaydedilmeden 502 dönülüyor — bu ayrı bir dayanıklılık boşluğu (outbox tablosu + retry gerektirir), bu migration'ın kapsamı MTProto dinleyicisinin kendi reconnect/backoff davranışıyla sınırlı. Sadece dokümantasyonda bilinen sınırlama olarak not düşülecek, kod değişmeyecek.

## Detaylı mimari plan

Bkz. `ai-memory/spec/architecture.md` (Selim rolü Barış tarafından, Explore + Plan ajanlarının doğrulanmış araştırmasıyla dolduruldu) ve onaylı plan dosyası: `C:\Users\aturk\.claude\plans\projeyi-incele-ve-bana-smooth-orbit.md`.

## STATUS: READY_FOR_BUILD
