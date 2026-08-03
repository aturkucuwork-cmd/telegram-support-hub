# opencode "Ajans" Çok Ajanlı Sistemi

Bu klasörde opencode için **ajans gibi çalışan 8 ajan** tanımlıdır. Bir brief verdiğinizde ekip otomatik olarak brief → strateji → tasarım → içerik → build → review → teslim akışını koşturur.

## Kadro

| Emoji | İsim | Ünvan | Internal ID | mode | Renk | Ne yapar |
|---|---|---|---|---|---|---|
| 🦁 | **Barış** | Takım Lideri | `takim-lideri` | primary | accent | Brief alır, ekibe iş dağıtır, sentezler, teslim eder |
| 🎨 | **Cem** | Kreatif Direktör | `creative-director` | subagent | secondary | Marka vizyonu, ton, pozisyonlama |
| 📊 | **Aslı** | Veri Analisti | `veri-analisti` | subagent | info | Hedef kitle, pazar, rakip, KPI |
| 🖌️ | **Zeynep** | UX/UI Tasarımcı | `ux-tasarimci` | subagent | secondary | Bilgi mimarisi, kullanıcı akışı, wireframe |
| 🔎 | **Burak** | SEO Uzmanı | `seo-uzmani` | subagent | success | Anahtar kelime, içerik mimarisi, on-page denetim |
| ✍️ | **Defne** | İçerik Editörü | `icerik-editoru` | subagent | warning | Gerçek metin, mikrokopya, son redaksiyon |
| 🏗️ | **Selim** | Yazılım Uzmanı (Mimar) | `yazilim-uzmani` | subagent | primary | Mimari kararı, stack seçimi, kod review/QA |
| ⚙️ | **Mert** | Yazılım Mühendisi | `yazilim-muhendisi` | subagent | info | Gerçek implementasyon, dosya yazımı, komut çalıştırma |
| 🧪 | **Eda** | Test Uzmanı _(opt-in)_ | `test-uzmani` | subagent | error | Buton/input/edge case testi, bug raporlama (5b) |
| 🚀 | **Murat** | Yayın Uzmanı _(opt-in)_ | `yayin-uzmani` | subagent | secondary | Google Play / App Store submit rehberliği (8) |

Tek kod yazan Mert'tir. Tek kullanıcıyla konuşan Barış'tır. Diğerleri kendi alanlarında karar verir, çıktılarını `ai-memory/` altına yazar, Barış'a rapor verir. **Eda ve Murat opt-in'dir** — standart workflow'a dahil değildir, sadece sen tetiklediğinde devreye girer.

## Taşınabilirlik

Bu proje **kendi kendine yeter** (self-contained). Başka bir bilgisayara, başka bir klasöre veya başka bir makineye taşımak için tüm `ajans/` klasörünü kopyala; ek kurulum gerekmez. opencode gerekli her şeyi proje-scoped konumlardan otomatik yükler.

Klasörün taşınabilir parçaları:

- `opencode.json` — `default_agent: takim-lideri`
- `README.md` — bu dosya
- `.opencode/agent/` — 8 ajan (proje-scoped; global ajanları override eder)
- `.opencode/skill/ajans-workflow/` — SOP + handoff şablonu + STATUS kodları
- `.opencode/skill/ai-memory/` — paylaşımlı hafıza skill'i (ajanlar bunu kullanarak `ai-memory/` klasörünü yönetir)

**Yeni bilgisayarda:** klasörü aç, `opencode` çalıştır, brief ver. Hepsi bu.

**Aynı sistemi başka projelerde de kullanmak istersen:** o projenin köküne sadece `opencode.json` (`default_agent: takim-lideri`) koy. Global ajan ve skill'ler (`~/.config/opencode/agent/` ve `~/.config/opencode/skill/`) zaten kuruluysa otomatik devreye girer; değilse bu `ajans/` klasörünü referans al.

**Aynı ajanı başka projede biraz farklı davranacak şekilde kullanmak istersen:** sadece o projeye özel `~/.config/opencode/agent/` ve `~/.config/opencode/skill/` konumlarını override etmek için, ajan/skill dosyalarını o projenin `.opencode/` altına kopyala ve istediğin gibi düzenle. Proje-scoped olanlar her zaman global'leri geçersiz kılar.

## Diğer AI araçları ile çalışma

Bu proje sadece opencode için değil, **birden fazla AI aracıyla birlikte** çalışacak şekilde yapılandırılmıştır. Kaynak dosyalar `.opencode/agent/` altındadır; diğer araçlara yaymak için `setup-other-ai.ps1` script'ini çalıştır:

```bash
.\setup-other-ai.ps1
```

Bu komut her seferinde aşağıdaki dosyaları sıfırdan üretir (idempotent, istediğin kadar tekrar çalıştırabilirsin).

### Üretilen/var olan talimat dosyaları

| Dosya | AI aracı | Ne yapar |
|---|---|---|
| `AGENTS.md` | OpenAI Codex, Cursor, Gemini CLI, Aider, diğerleri | Universal standart; aracın yeteneğine göre rolleri gerçek subagent'lara veya sıralı role dağıtır |
| `CLAUDE.md` | Claude Code | Claude Code'a özel; subagent'larla paralel `Task` çağrılarını zorunlu kılar |
| `.github/copilot-instructions.md` | GitHub Copilot | Repo genelinde tüm Copilot önerileri için talimat |
| `.claude/agents/<8 dosya>` | Claude Code | 7 subagent (Cem, Aslı, Zeynep, Burak, Defne, Selim, Mert) + Barış primary olarak CLAUDE.md'de |
| `.github/agents/<8 dosya>` | GitHub Copilot | Sohbet içinde `@<isim>` ile seçilebilen chat agent'ları |
| `.cursor/rules/ajans.mdc` | Cursor | Cursor kural dosyası (always-on) |

### Hangi dosyayı hangi araç okur?

| AI aracı | Birincil dosya | Ek dosya |
|---|---|---|
| **opencode** | `.opencode/agent/*.md` | (otomatik) |
| **Claude Code** | `CLAUDE.md` | `.claude/agents/*.md` (subagent) |
| **OpenAI Codex** | `AGENTS.md` | — |
| **GitHub Copilot** | `.github/copilot-instructions.md` | `.github/agents/*.md` (chat) |
| **Cursor** | `AGENTS.md` | `.cursor/rules/ajans.mdc` |
| **Gemini CLI** | `AGENTS.md` (veya `GEMINI.md`) | — |
| **Aider** | `AGENTS.md` (veya `CONVENTIONS.md`) | — |

### Subagent destekli vs tek AI

- **Subagent destekli (Claude Code, opencode ve bu projedeki subagent özellikli OpenAI Codex):** 7 subagent + 1 primary (Barış) ayrı konuşmalardır. Her biri kendi dosyasına yazar, paralel koşarlar. Ajans-workflow **gerçek çoklu-ajan** deneyimidir.
- **Tek AI (Copilot, Cursor, Gemini, Aider ve subagent özelliği kapalı Codex oturumları):** Aynı AI oturumu tüm rolleri sırayla oynar. Her rol geçişinde **"Şimdi X rolüne geçiyorum"** der, çıktıyı uzmana atanan dosyaya yazar. Ajans-workflow **sıralı simülasyon** olarak çalışır.

Her iki durumda da `ai-memory/` aynı dosya yapısını kullanır, böylece bir araçla başlayıp diğeriyle devam edebilirsin.

### Yeni bir brief ver

1. İstediğin AI aracını aç (Claude Code, opencode, Cursor, vb.)
2. Proje kökünde `cd` yap
3. Brief ver

Araç `AGENTS.md` (veya kendi talimat dosyasını) okur, Barış rolünü benimser, workflow'u uygular.

### Bir ajanı güncellediğinde

`.opencode/agent/<isim>.md`'yi düzenledikten sonra:

```bash
.\setup-other-ai.ps1
```

Claude Code ve Copilot için olan kopyalar otomatik güncellenir. Universal `AGENTS.md`'yi ayrıca düzenlemen gerekmez (script onu otomatik üretmiyor, çünkü o üst-düzey talimat dosyası).

## Kurulum

Bu ajanlar zaten `~/.config/opencode/agent/` altında tanımlı. **Aşağıdaki adımlardan birini uyguladıktan sonra opencode'u yeniden başlat** (config hot-reload olmaz).

### 1) Belirli bir projede ajans modunu aktif et (önerilen)

Proje köküne `opencode.json` koy:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "takim-lideri"
}
```

Artık o projeyi açtığında otomatik Barış'la başlarsın.

### 2) Tüm projelerde varsayılan yap

`~/.config/opencode/opencode.jsonc` dosyasına `"default_agent": "takim-lideri"` ekle.

> DİKKAT: Bu global değişikliktir. Her projeyi Barış'la açarsın. Diğer ajanlara (`build`, `plan` vb.) geçmek için `/agent build` ya da `opencode --agent build` kullan.

### 3) Sadece o an için Barış ol

```bash
opencode --agent takim-lideri
```

Ya da opencode içinde `/agent takim-lideri` yaz.

## Workflow (Barış'ın uyguladığı 7+1+1 aşama)

```
0. BRIEF         — Barış kullanıcıyla brief'i netleştirir
1. STRATEJİ ∥    — Cem (🎨) + Aslı (📊) paralel
2. TASARIM ∥     — Zeynep (🖌️) + Burak (🔎) + Selim (🏗️) paralel
3. İÇERİK        — Defne (✍️) strateji+tasarım+SEO'yu okuyup metinleri yazar
4. ONAY          — Barış sentezler, kullanıcıya sunar
5. BUILD         — Mert (⚙️) gerçek kodu yazar
5b. TEST (opt)   — Eda (🧪) kullanıcı "test et" derse devreye girer
6. REVIEW ∥      — Selim (QA) + Burak (SEO audit) + Defne (redaksiyon) paralel
7. TESLİM        — Barış progress.md günceller, rapor verir
8. PUBLISH (opt) — Murat (🚀) kullanıcı "yayınla" derse devreye girer
```

`∥` işaretli aşamalar gerçek paralel: Barış tek mesajda birden çok `task` çağrısı yapar.

### Opt-in ajanlar (Eda & Murat)

| Ajan | Tetikleyici | Ne zaman | Çıktısı |
|---|---|---|---|
| 🧪 **Eda** (test-uzmani) | "test et", "QA yap", "smoke test", "hata ara" | Build sonrası, review öncesi | `ai-memory/test/eda-report.md` |
| 🚀 **Murat** (yayin-uzmani) | "yayınla", "publish", "Google Play", "App Store" | Teslim sonrası | `ai-memory/publish/murat-checklist.md` |

Eda buton/input/edge case'leri sistematik tarar, kritik/orta/düşük kategorize bug raporu yazar. Murat Google Play ve App Store için platform-spesifik checklist oluşturur, sık red nedenlerini önceden listeler.

## Paylaşımlı hafıza: `ai-memory/`

Her ajan çıktısını çalışma alanının kökündeki `ai-memory/` altına yazar. Bu sayede:
- Sonraki ajan önceki ajanın dosyalarını okuyup üstüne devam eder (sohbet hafızası dışında kalıcı bağlam).
- Aynı brief'i sonradan sıfırdan koşturduğunuzda bile tüm ajanlar bağlamı dosyadan alır.
- `progress.md` ve `decisions.md` ajanlar arası durum ve gerekçe defteri olur.

Mevcut `ai-memory` skill'i `progress.md` / `decisions.md` / `brief.md` yaşam döngüsünü yönetir. **ajans-workflow** skill'i ise `strategy/`, `spec/`, `content/`, `build/`, `review/` alt klasörlerini ekler. İki skill birlikte çalışır.

## Handoff ve STATUS

Her ajan dosyasının sonunda `STATUS: <KOD>` satırı vardır. Aşama geçişinde Barış bu kodu okuyup bir sonraki aşamayı başlatır. Kodlar:

`READY_FOR_STRATEGY` · `READY_FOR_DESIGN` · `READY_FOR_CONTENT` · `READY_FOR_APPROVAL` · `READY_FOR_BUILD` · `READY_FOR_REVIEW` · `READY_FOR_DELIVERY` · `BLOCKED`

## İzinler

opencode default'ları kullanılır. Her ajan kendi rolünün gerektirdiği araçlara erişir. İzin modelini sıkılaştırmak istersen her `.md` dosyasına `permission:` bloğu ekleyebilirsin.

## Test

Kurulumun çalıştığını doğrulamak için Barış'a geç ve şöyle bir brief ver:

> "Küçük işletmeler için online randevu sistemi SaaS'ı için tek sayfalık bir landing page istiyorum. Hedef kitle kuaförler ve küçük klinikler. Modern, sade, güvenilir bir ton olsun."

Barış 7 aşamayı koşturacak, `ai-memory/` altında tüm çıktılar oluşacak, sonunda Mert gerçek kodu yazacak.


## GitHub ile versiyon senkronizasyonu

Bu repo GitHub'da canonical kaynak olarak yaşar. Ajan/skill geliştirmeleri semver ile versiyonlanır; projeler sync-ajans.ps1 ile sadece değişen dosyaları çeker.

### Mimarî

- **Canonical repo:** github.com/aturkucuwork-cmd/ajans-system (private)
- **Versiyon şeması:** Semver (1.0.0, 1.1.0, ...)
  - Yeni ajan/skill → minor bump
  - Kırıcı değişiklik → major bump
  - Bug fix / typo → patch
- **Proje tarafı:** her projede .ajans-version dosyası mevcut versiyonu tutar

### Push tarafı (canonical ajans geliştirildiğinde)

`ash
# 1. Değişiklikleri yap (ajan .md, skill SKILL.md, vb.)
# 2. CHANGELOG.md'ye yeni versiyon bloğu ekle
# 3. Bilinçli commit
git add <değişen dosyalar> CHANGELOG.md
git commit -m "v1.1.0: kısa açıklama"
# 4. Tag at
git tag v1.1.0
# 5. Push
git push && git push --tags
`

### Pull tarafı (uygulama ajansı güncellerken)

Bir uygulamanın kökünde:

`powershell
# Public repo ise direkt çalışır. Private repo için:
 = "ghp_xxxxxxxxxxxx"
.\sync-ajans.ps1
`

Script:
1. Projedeki .ajans-version'ı okur
2. GitHub'daki son tag/release'i çeker
3. İkisi arasındaki delta'yı hesaplar (eklenecek/güncellenecek/silinecek dosyalar)
4. Sana onay ekranı gösterir
5. Onay verirsen sadece delta dosyaları indirir
6. .ajans-version'ı günceller
7. Otomatik git add + commit + push yapar

### sync-ajans.ps1 parametreleri

`powershell
.\sync-ajans.ps1                              # default: aturkucuwork-cmd/ajans-system
.\sync-ajans.ps1 -Repo "user/ajans-system"    # farklı repo
.\sync-ajans.ps1 -ProjectRoot "C:\proje"      # farklı klasör
`

### Versiyon takibi

- **Canonical:** VERSION (repo kökünde, tek satır: 1.0.0)
- **Proje:** .ajans-version (proje kökünde, tek satır: 1.0.0)
- **Geçmiş:** CHANGELOG.md (insan-okunabilir, ne değişti listesi)

### Neden bu yapı?

| Eski yaklaşım (full replace) | Yeni yaklaşım (delta + semver) |
|---|---|
| Her sync'te tüm dosyalar değişir | Sadece gerçekten değişen dosyalar değişir |
| "Ne değişti?" bilinmez | CHANGELOG ve onay ekranıyla görünür |
| Yanlış dosya override riski | Dokunulmamış dosyalar el sürmez |
| Projeler farklı versiyonlarda kayar | Her proje kendi versiyonunu sabit tutar veya günceller |

## Dizin

```
~/.config/opencode/agent/                    # bu klasör
├── README.md                                # bu dosya
├── takim-lideri.md                          # Barış (primary)
├── creative-director.md                     # Cem
├── veri-analisti.md                         # Aslı
├── ux-tasarimci.md                          # Zeynep
├── seo-uzmani.md                            # Burak
├── icerik-editoru.md                        # Defne
├── yazilim-uzmani.md                        # Selim
└── yazilim-muhendisi.md                     # Mert

~/.config/opencode/skill/ajans-workflow/
└── SKILL.md                                 # ortak SOP + handoff şablonu
```
