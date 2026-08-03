# Ajans Changelog

Tüm ajans sistemi değişiklikleri burada. Semver (vMAJOR.MINOR.PATCH):
- **MAJOR** — kırıcı değişiklik (workflow değişimi, dosya silme, dosya yolu değişimi)
- **MINOR** — yeni ajan, yeni skill, yeni opt-in ajan, ajan yetenek genişletmesi
- **PATCH** — bug fix, typo, mevcut ajan/skill üzerinde küçük düzeltme

---

## v1.1.0 (2026-06-13) — Agent Skills Entegrasyonu

**YENİ/DEĞİŞEN:**
- ~ Mert (yazilim-muhendisi) — TDD (Test-Driven Development), Incremental Implementation ve Git commit checkpoints eklendi.
- ~ Selim (yazilim-uzmani) — Güvenlik (OWASP 10), Erişilebilirlik (WCAG AA/A11y) ve Kod Sadeleştirme kontrolleri QA yönergelerine entegre edildi.
- ~ Eda (test-uzmani) — TDD doğrulama adımları ve test anti-rationalization yönergeleri eklendi.
- ~ Barış (takim-lideri) — Interactive Interview-Me (soru-cevap ile brief netleştirme) ve Git checkpoint denetim kuralları eklendi.
- ~ `ajans-quality-gates/SKILL.md` — Stage gates, Build verification ve Final checklist'e yeni TDD, Git, Güvenlik ve A11y kapıları entegre edildi.
- ~ Genel `AGENTS.md` ve `.cursor/rules/ajans.mdc` kuralları güncellendi.
- ~ Claude Code subagents ve GitHub Copilot agents derleme çıktıları başarıyla güncellendi.
- ~ `VERSION` — v1.0.1 → v1.1.0

---

## v1.0.1 (2026-06-06) — Backup mekanizması

**DEĞİŞEN:**
- ~ `sync-ajans.ps1` — sync öncesi yerelde değişecek/silinecek dosyalar otomatik yedekleniyor
- ~ `.gitignore` — `backup/` klasörü eklendi (yedekler commit'lenmez)
- ~ `VERSION` — v1.0.0 → v1.0.1

**YENİ davranış:**

Sync çalıştırıldığında, dosya değişikliği uygulanmadan önce:
1. Eklenecek / güncellenecek / silinecek dosya listesi hesaplanır
2. Onay ekranında "Yedeklenecek: N dosya (backup/ klasörüne)" bilgisi gösterilir
3. Kullanıcı onaylarsa (E/h):
   - `backup/2026-06-06/` (aynı gün 2. sync ise `backup/2026-06-06-2/`) klasörü oluşturulur
   - Yerelde olup üzerine yazılacak/silinecek dosyalar bu klasöre kopyalanır (orijinal yapı korunur)
4. Delta uygulanır
5. Sync sonunda kullanıcı yedeğin yolunu görür

**Neden:**
- Ajan dosyalarını projede özelleştirmiş kullanıcılar sync sırasında çalışmalarını kaybetmesin
- Yanlışlıkla üzerine yazılan dosyalar geri alınabilsin
- Hata ayıklama kolaylığı: "önceki hali neydi?" sorusu kolay cevaplanır

**Yedekten geri yükleme (örnek):**
```powershell
# Eğer sync sonrası bir şey bozulduysa
Copy-Item "backup\2026-06-06\.opencode\agent\takim-lideri.md" `
          ".opencode\agent\takim-lideri.md" -Force
```

**KIRICI:** yok (geriye dönük uyumlu)

**ETKİ:** v1.0.0 projeleri sync edince patch alır. Yeni davranış.

---

## v1.0.0 (2026-06-06) — İlk sürüm

**YENİ:**
- 8 standart ajan
  - 🦁 Barış (takim-lideri) — primary, brief → plan → dağıtım → sentez → teslim
  - 🎨 Cem (creative-director) — vizyon, ton, marka, pozisyonlama
  - 📊 Aslı (veri-analisti) — hedef kitle, pazar, rakip, KPI
  - 🖌️ Zeynep (ux-tasarimci) — bilgi mimarisi, kullanıcı akışı, wireframe
  - 🔎 Burak (seo-uzmani) — anahtar kelime, içerik mimarisi, on-page denetim
  - ✍️ Defne (icerik-editoru) — gerçek metin, mikrokopya, son redaksiyon
  - 🏗️ Selim (yazilim-uzmani) — mimari kararı, stack seçimi, kod review/QA
  - ⚙️ Mert (yazilim-muhendisi) — gerçek implementasyon, dosya yazımı, komut çalıştırma

- 2 skill
  - `.opencode/skill/ajans-workflow/SKILL.md` — SOP, handoff şablonu, STATUS kodları
  - `.opencode/skill/ai-memory/SKILL.md` — paylaşımlı hafıza yönetimi (progress, decisions)

- Multi-AI desteği
  - `AGENTS.md` (universal standard — Codex, Cursor, Gemini, Aider)
  - `CLAUDE.md` (Claude Code)
  - `.github/copilot-instructions.md` + `.github/agents/*.md` (GitHub Copilot)
  - `.cursor/rules/ajans.mdc` (Cursor)
  - `setup-other-ai.ps1` (Claude Code subagent ve Copilot agent üretici script)

- Altyapı
  - `opencode.json` (default_agent: takim-lideri)
  - `README.md` (kullanım kılavuzu)
  - `VERSION` (mevcut versiyon)
  - `CHANGELOG.md` (bu dosya)
  - `.gitignore`
  - `sync-ajans.ps1` (projelerden ajans güncelleme scripti)

**7 aşamalı workflow:**
```
0. BRIEF         — Barış kullanıcıyla brief'i netleştirir
1. STRATEJİ ∥    — Cem + Aslı paralel
2. TASARIM ∥     — Zeynep + Burak + Selim paralel
3. İÇERİK        — Defne strateji+tasarım+SEO çıktılarını okuyup metinleri yazar
4. ONAY          — Barış sentezler, kullanıcıya sunar
5. BUILD         — Mert gerçek kodu yazar
6. REVIEW ∥      — Selim (QA) + Burak (audit) + Defne (redaksiyon) paralel
7. TESLİM        — Barış progress.md günceller, rapor verir
```

**KIRICI:** yok

**ETKİ:** Yeni repo. İlk push.
