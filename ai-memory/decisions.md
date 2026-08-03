---
tags: [decisions, relaydesk]
---

# Kararlar

- 2026-07-31: Ajans paketi iç içe `ajans/` klasöründen çalıştırılmak yerine gerekli yapıların proje köküne kurulmasına karar verildi; AI araçları yalnızca proje kökündeki talimatları otomatik keşfediyor.
- 2026-07-31: Kurulumda paket `VERSION` değeri olan v1.1.0 esas alındı; eski `.ajans-version` değeri kullanılmadı.
- 2026-07-31: Subagent destekli Codex oturumlarının gerçek paralel Ajans akışını kullanması etkinleştirildi.
- 2026-08-03: Linux self-host build'i sonrasında kritik production-readiness bulguları nedeniyle kapsam genişletme ihtiyacı tespit edildi; `ai-memory/plan.md` içinde remediation iş paketleri çıkarıldı. Karar: Planlama şimdi dahil, kod uygulaması kullanıcı onayı ve yeni Mert build turu sonrasına ertelendi. Etkilenen alanlar: `deploy/`, auth/internal API, backup/monitoring, test ve dokümantasyon.
- 2026-08-03: `reply` outbox/retry ve durable MTProto queue mevcut migration brief'inin kapsam dışı kararlarını etkiliyor. Karar: Ayrı Change Request olarak tutulacak; kullanıcı açıkça onaylamadan build'e alınmayacak.
- 2026-08-03: P0 remediation'da tüm servisler system-level `User=relaydesk` unit olarak tekleştirildi; önceki listener user-level modelinden sapıldı. Gerekçe: fresh host provision, tek env kaynağı ve reboot/logout kalıcılığını aynı servis modeliyle garanti etmek.
- 2026-08-03: Bot API alım modeli webhook yerine long polling olarak sabitlendi; bridge webhook'u pending update'leri düşürmeden siliyor, poller `getUpdates` ile yerel webhook route'una iletiyor.
- 2026-08-03: Public `/api/status` auth'suz açılmadı. Bootstrap için localhost `/api/healthz`, history için localhost + `INTERNAL_API_SECRET` `/api/internal/status` seçildi.
- 2026-08-03: Backup bu turda yalnız local SQLite online backup + restore temelidir; off-host provider ve ayrı-host tatbikatı TODO bırakıldı.
