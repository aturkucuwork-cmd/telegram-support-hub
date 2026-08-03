---
tags: [tasks, relaydesk]
---

# Görevler

## Tamamlandı

- [x] RelayDesk kod tabanını incele
- [x] Yerel uygulamayı aktif et ve HTTP yanıtını doğrula
- [x] Ajans v1.1.0 sistemini proje köküne entegre et
- [x] Kalıcı proje hafızasını başlat
- [x] Genel production-readiness eksiklerini kanıtlarıyla listele

## Bekleyen

- [ ] Üretim `TELEGRAM_BOT_TOKEN` değerini yapılandır
- [ ] Canlı Telegram webhook akışını uçtan uca doğrula
- [ ] Ops audit kritiklerini düzelt ve fresh Linux/systemd hostta yeniden test et
- [x] P0 remediation kod paketlerini uygula: poller, env, provision, bridge, health, backup (Linux E2E retest bekliyor)
- [x] P0 remediation bağımsız QA/security/a11y review'ını tamamla (kritik fix loop bekliyor)
- [x] P0 QA kritik fixlerini uygula: bridge NameError, poller restart, restore servisleri, WAL/SHM (Linux E2E retest bekliyor)
- [ ] P0 fresh Linux/systemd/Telegram/WAL restore E2E retestini çalıştır
- [ ] P1 remediation paketlerini uygula: auth, internal API, secrets, systemd hardening, monitoring
- [ ] P2 remediation paketlerini kullanıcı onayı sonrası uygula: durable queue, reply outbox, pagination/polling
- [ ] P3 kalite paketini uygula: test, CI, A11y, security headers ve dokümantasyon
