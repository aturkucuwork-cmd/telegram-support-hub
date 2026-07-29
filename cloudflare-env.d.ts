declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_WEBHOOK_SECRET?: string;
    SUPPORT_ALLOWED_EMAILS?: string;
  }
}
