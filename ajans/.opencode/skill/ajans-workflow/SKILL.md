---
name: ajans-workflow
description: Use ONLY when opencode'un ajans (agency) çok-ajanlı sistemi aktif — yani `takim-lideri` (Barış) veya onun alt-ajanlarından biri görev aldığında. Brief'ten teslim'e kadar 7 aşamalı SOP, dosya yapısı (ai-memory/), her rolün handoff şablonu ve STATUS kodlarını tanımlar. "Brief al", "proje başlat", "ajans modu", "strateji/spec/build/review", "handoff" gibi ifadeler geçtiğinde tetiklenir.
---

# Ajans Workflow

Bu skill, opencode içinde tanımlı 8 ajanın (Barış + 7 uzman) birlikte bir "ajans gibi" çalışması için ortak yordamı (SOP), dosya yapısını ve handoff şablonunu tanımlar. Yüklendiğinde ajan bu kurallara uyar.

## Ekip

| Rol | Ajan | mode | Ünvan |
|---|---|---|---|
| Takım Lideri | `takim-lideri` (Barış 🦁) | primary | Brief → plan → dağıtım → sentez → teslim |
| Kreatif Direktör | `creative-director` (Cem 🎨) | subagent | Vizyon, ton, marka, pozisyonlama |
| Veri Analisti | `veri-analisti` (Aslı 📊) | subagent | Hedef kitle, pazar, rakip, KPI |
| UX/UI Tasarımcı | `ux-tasarimci` (Zeynep 🖌️) | subagent | Bilgi mimarisi, akış, wireframe tarifi |
| SEO Uzmanı | `seo-uzmani` (Burak 🔎) | subagent | Anahtar kelime, içerik mimarisi, on-page |
| İçerik Editörü | `icerik-editoru` (Defne ✍️) | subagent | Gerçek metin, mikrokopya, redaksiyon |
| Yazılım Uzmanı | `yazilim-uzmani` (Selim 🏗️) | subagent | Mimari, stack, kod review/QA |
| Yazılım Mühendisi | `yazilim-muhendisi` (Mert ⚙️) | subagent | Gerçek implementasyon |
| **Test Uzmanı** | **`test-uzmani` (Eda 🧪)** | subagent (opt-in) | Buton, input, edge case testi, bug raporlama |
| **Yayın Uzmanı** | **`yayin-uzmani` (Murat 🚀)** | subagent (opt-in) | Google Play / App Store submit rehberliği |

## 7 aşamalı SOP (Takım Lideri uygular)

```
0. BRIEF            — Barış kullanıcıyla 1-3 soru ile brief'i netleştirir
                       → ai-memory/brief.md
1. STRATEJİ (∥)     — Cem + Aslı paralel
                       → ai-memory/strategy/creative.md
                       → ai-memory/strategy/data.md
2. TASARIM (∥)      — Zeynep + Burak + Selim paralel
                       → ai-memory/spec/ux.md
                       → ai-memory/spec/seo.md
                       → ai-memory/spec/architecture.md
3. İÇERİK           — Defne (strateji+tasarım+SEO çıktılarını okur)
                       → ai-memory/content/copy.md
4. ONAY             — Barış sentezi kullanıcıya sunar
5. BUILD            — Mert (tüm çıktıları okur, kaynak kodu yazar)
                       → ai-memory/build/notes.md + çalışma alanı dosyaları
5b. TEST (opt-in)   — Eda (kullanıcı "test et" derse)
                       → ai-memory/test/eda-report.md
6. REVIEW (∥)       — Selim (kod QA) + Burak (SEO audit) + Defne (redaksiyon)
                       → ai-memory/review/qa.md
                       → ai-memory/review/seo-audit.md
                       → ai-memory/review/copy-edit.md
7. TESLİM           — Barış progress.md'yi günceller, kullanıcıya rapor verir
8. PUBLISH (opt-in) — Murat (kullanıcı "yayınla" derse)
                       → ai-memory/publish/murat-checklist.md
```

`∥` = paralel aşama; Takım Lideri tek mesajda birden fazla `task` çağrısı yaparak gerçek paralelde koşturur. Diğer aşamalar seri.

`5b` ve `8` **opt-in** aşamalardır — sadece kullanıcı tetiklediğinde çalışır.

## Dosya yapısı

Tüm ajan çıktıları proje kökünde `ai-memory/` altında:

```
ai-memory/
├── brief.md                     # Barış yazar
├── plan.md                      # Barış yazar (zaman planı + riskler)
├── strategy/
│   ├── creative.md              # Cem yazar
│   └── data.md                  # Aslı yazar
├── spec/
│   ├── ux.md                    # Zeynep yazar
│   ├── seo.md                   # Burak yazar
│   └── architecture.md          # Selim yazar
├── content/
│   └── copy.md                  # Defne yazar
├── build/
│   └── notes.md                 # Mert yazar
├── review/
│   ├── qa.md                    # Selim yazar (QA)
│   ├── seo-audit.md             # Burak yazar
│   └── copy-edit.md             # Defne yazar
├── progress.md                  # Barış her aşamada günceller
└── decisions.md                 # Barış kararların gerekçesini yazar
```

Mevcut `ai-memory` skill'i (zaten yüklü) `progress.md`, `decisions.md`, `brief.md` yaşam döngüsünü yönetir. Bu skill o yaşam döngüsüne `strategy/`, `spec/`, `content/`, `build/`, `review/` alt klasörlerini ekler; çakışmaz, birlikte çalışır.

## Handoff şablonu (her ajan çıktısının sonuna koy)

```
---
STATUS: <aşağıdakilerden biri>
READY_FOR_STRATEGY | READY_FOR_DESIGN | READY_FOR_CONTENT
READY_FOR_APPROVAL | READY_FOR_BUILD | READY_FOR_REVIEW
READY_FOR_DELIVERY | BLOCKED
---
```

| Aşama bittiğinde | STATUS |
|---|---|
| 0 Brief | `READY_FOR_STRATEGY` |
| 1 Strateji | `READY_FOR_DESIGN` |
| 2 Tasarım | `READY_FOR_CONTENT` |
| 3 İçerik | `READY_FOR_APPROVAL` |
| 5 Build | `READY_FOR_REVIEW` |
| 6 Review (üçü de bitti) | `READY_FOR_DELIVERY` |
| Brief eksik, takım durduruldu | `BLOCKED` |

`BLOCKED` durumunda ajan dosyanın başına nedenini ve kimin ne yapması gerektiğini yazar. Barış (Takım Lideri) kullanıcıya iletir.

## Bir ajana iş atarken Takım Lideri'nin vereceği minimum bağlam

- Brief özeti (brief.md'den)
- Bu ajanın **okuması gereken** önceki çıktıların dosya yolları
- Bu ajanın **yazacağı** dosya yolu
- Beklenen STATUS kodu

Örnek:
```
Cem (creative-director) — strateji aşaması
Önce oku: ai-memory/brief.md
Yaz: ai-memory/strategy/creative.md
Şablon: [konsept, ton, hedef duygu, pozisyonlama, görsel yön, kelime dağarcığı, STATUS]
Bitiş: STATUS: READY_FOR_DESIGN
```

## Paralel aşamalar

- Strateji (Cem + Aslı), Tasarım (Zeynep + Burak + Selim), Review (Selim QA + Burak SEO + Defne redaksiyon) **paralel** çalışır.
- Barış tek mesajda birden çok `task` çağrısı yapar.
- Aynı dosyaya paralel yazım yoktur; her ajan kendi dosya yoluna yazar.

## Sıralı aşamalar

- Brief → Strateji: bloklayıcı.
- Tasarım → İçerik: Defne, üçünü birden okur.
- İçerik → Build: kullanıcı onayı beklenir (4. aşama).
- Build → Review: üçü paralel.
- Review → Teslim: Barış'ın sentezi.

## Opt-in ajanlar (kullanıcı isteğine bağlı)

İki uzman standart workflow'a dahil değildir; sadece kullanıcı istediğinde devreye girer.

### Eda — Test Uzmanı (🧪)

**Tetikleyici kelimeler:** "test et", "QA yap", "hata ara", "smoke test", "regression", "bug bul", "test çalıştır", "denedin mi".

**Ne zaman çağrılır:** Build (aşama 5) bittikten sonra, review'dan önce. Kullanıcı kodu kendi test etmeden önce Eda'nın sistematik taramasından geçmesini isterse.

**Yapar:**
- `spec/ux.md`'deki her UI element için statik analiz + manuel test planı
- Mevcut test suite varsa çalıştırır, sonuçları raporlar
- Build & smoke test
- Bug'ları kategorize eder (kritik / orta / düşük)
- Raporu `ai-memory/test/eda-report.md`'ye yazar

**STATUS:** Kritik bug yoksa `READY_FOR_REVIEW`, varsa `BLOCKED` (Mert'e düzeltme listesi gider).

### Murat — Yayın Uzmanı (🚀)

**Tetikleyici kelimeler:** "yayınla", "publish", "Google Play", "App Store", "store'a gönder", "release al", "submit", "mağazaya yükle".

**Ne zaman çağrılır:** Teslim (aşama 7) bittikten sonra. Kullanıcı uygulamayı mağazaya göndermek istediğinde.

**Yapar:**
- Platform-spesifik (Google Play / App Store / her ikisi) checklist oluşturur
- Binary hazırlığı, store listing, görseller, içerik derecelendirmesi, yasal uyum, submit öncesi smoke test
- Her madde için somut dosya/menü yolu verir
- Sık red nedenlerini önceden listeler
- Checklist'i `ai-memory/publish/murat-checklist.md`'ye yazar, ilerleme kaydeder

**STATUS:** Tüm zorunlu adımlar tamamlandıysa `READY_FOR_REVIEW`, eksik varsa `BLOCKED` (kullanıcıya ne yapması gerektiğini söyler).

## Çakışma / sapma yönetimi

- Bir uzman, başka bir uzmanın çıktısında **çelişki** görürse (örn. Cem'in tonu Defne'nin metniyle uyuşmuyor), bunu kendi çıktısında ayrı bir "**ÇAKIŞMA**" bölümünde yazar. Barış sentezde karar verir.
- Mimari sapma (Mert, Selim'in kararından farklı bir şey yaptıysa) Mert bunu build notes'a yazar. Selim review'da bunu ilk QA maddesi olarak işler.

## Sürüm

Bu skill ajan setiyle birlikte versiyonlanır. Ajan dosyalarından herhangi biri değişirse, bu skill'in güncellenmesi gerekebilir.
