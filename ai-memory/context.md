---
tags: [context, relaydesk]
---

# Teknik Bağlam

## Stack

- Node.js 22+
- Next.js 16, React 19, vinext ve Vite
- Drizzle ORM, Cloudflare Worker ve D1

## Komutlar

- Geliştirme: `npm run dev`
- Build: `npm run build`
- Test: `npm test`
- Lint: `npm run lint`

## Gerekli ortam değişkenleri

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `SUPPORT_ALLOWED_EMAILS`
- `LOCAL_SETUP_TOKEN` (yerel kurulum)

Gizli değerler hafıza dosyalarına yazılmaz.

## Ajans

- Varsayılan OpenCode ajanı: `takim-lideri`
- Workflow: `.opencode/skill/ajans-workflow/SKILL.md`
- Kalite kapıları: `.opencode/skill/ajans-quality-gates/SKILL.md`
- Sürüm: `.ajans-version`

