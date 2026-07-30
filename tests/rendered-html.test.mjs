import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("builds the RelayDesk support application", async () => {
  const [page, desk, messageLogPanel, messageLogApi, reply, mediaReply, webhook, worker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/support-desk.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/message-log-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/message-logs/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reply/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reply/media/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/telegram/webhook/route.ts", import.meta.url), "utf8"),
    access(new URL("../dist/server/index.js", import.meta.url)),
  ]);

  assert.match(page, /RelayDesk/);
  assert.match(desk, /EKİP GELEN KUTUSU/);
  assert.match(desk, /Webhook’u etkinleştir/);
  assert.match(desk, /↩ Yanıtla/);
  assert.match(desk, /replyToMessageId/);
  assert.match(desk, /Mesaj logları/);
  assert.match(messageLogPanel, /KİŞİ BAZLI · SON 30 GÜN/);
  assert.match(messageLogPanel, /Bir ekip üyesi seçin/);
  assert.match(messageLogPanel, /dayGroups/);
  assert.match(messageLogApi, /requireAdmin/);
  assert.match(messageLogApi, /MESSAGE_LOG_RETENTION_DAYS/);
  assert.match(messageLogApi, /actor_email/);
  assert.match(messageLogApi, /listMessageLogUsers/);
  assert.match(reply, /reply_parameters/);
  assert.match(reply, /messageLogs/);
  assert.match(mediaReply, /reply_parameters/);
  assert.match(webhook, /x-telegram-bot-api-secret-token/);
  assert.match(webhook, /business_message/);
  assert.match(webhook, /edited_message/);
  assert.equal(worker, undefined);
});
