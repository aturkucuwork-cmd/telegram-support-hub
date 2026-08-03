---
tags: [architecture, relaydesk]
---

# Mimari

## Uygulama katmanları

- `app/`: Next.js/vinext kullanıcı arayüzü ve API route'ları
- `lib/`: kimlik doğrulama, Telegram, konuşma, atama ve veri erişim servisleri
- `db/`: Drizzle şema tanımları
- `drizzle/`: D1/SQLite migration dosyaları
- `tests/`: render edilmiş HTML smoke testleri
- `.openai/hosting.json`: Sites proje ve D1 bağlantı yapılandırması

## Çalışma akışı

Telegram webhook → API route → doğrulama ve iş kuralları → D1 → ortak gelen kutusu arayüzü.

## Ajans geliştirme katmanı

- `AGENTS.md`: araç bağımsız ana workflow
- `.opencode/agent/`: uzman ajan tanımları
- `.opencode/skill/`: ajans workflow, kalite kapıları ve proje hafızası
- `ai-memory/`: brief, karar, spesifikasyon, ilerleme ve teslim kayıtları

Ajans katmanı geliştirme sürecini yönetir; uygulamanın runtime veya hosting bağımlılığı değildir.

## 2026-08-03 Linux self-host remediation durumu

- Runtime veritabanı yerel `better-sqlite3`/SQLite WAL'dir; system-level servisler `User=relaydesk` ile çalışır.
- Web, Bot API long poller, MTProto listener ve setup bridge tek `/opt/relaydesk/.env.local` kaynağını kullanır.
- MTProto session yolu `RELAYDESK_SESSION_PATH` ile `/var/lib/relaydesk/telegram-user-session.enc` olarak provision edilir.
- `/api/healthz` localhost liveness/readiness, `/api/internal/status` localhost + internal secret history status, `/api/status` authenticated panel status endpoint'idir.
- SQLite backup/restore yerel systemd timer ile yapılır; off-host kopya ve ayrı-host restore henüz TODO'dur.
