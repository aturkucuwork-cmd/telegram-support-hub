import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("builds the RelayDesk support application", async () => {
  const [page, desk, setupWizard, localSetupApi, localSetupBridge, messageLogPanel, messageLogApi, folderPanel, folderApi, folderAssignments, userListener, reply, mediaReply, webhook, configure, status, worker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/support-desk.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/setup-wizard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/local-setup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/local_setup_bridge.py", import.meta.url), "utf8"),
    readFile(new URL("../app/message-log-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/message-logs/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/folder-rules-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/telegram/folders/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/folder-assignments.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/telegram_user_long_poll.py", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reply/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reply/media/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/telegram/webhook/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/telegram/configure/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/status/route.ts", import.meta.url), "utf8"),
    access(new URL("../dist/server/index.js", import.meta.url)),
  ]);

  assert.match(page, /RelayDesk/);
  assert.match(desk, /EKİP GELEN KUTUSU/);
  assert.match(desk, /Kurulum sihirbazını aç/);
  assert.match(setupWizard, /BotFather botunu hazırlayın/);
  assert.match(setupWizard, /Normal Telegram hesabını bağlayın/);
  assert.match(setupWizard, /Business botu hesaba bağla/);
  assert.match(setupWizard, /Grup ve kanal dinleyicisini başlat/);
  assert.match(localSetupApi, /requireAdmin/);
  assert.match(localSetupApi, /LOCAL_SETUP_TOKEN/);
  assert.match(localSetupBridge, /UpdateConnectedBotRequest/);
  assert.match(localSetupBridge, /save_session/);
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
  assert.match(desk, /Klasör atamaları/);
  assert.match(folderPanel, /TELEGRAM · OTOMATİK YÖNLENDİRME/);
  assert.match(folderPanel, /Elle yapılmış kişi atamaları korunur/);
  assert.match(folderApi, /requireAdmin/);
  assert.match(folderApi, /x-telegram-bot-api-secret-token/);
  assert.match(folderApi, /recalculateFolderAssignments/);
  assert.match(folderAssignments, /assignmentSource/);
  assert.match(folderAssignments, /telegram_folder/);
  assert.match(userListener, /GetDialogFiltersRequest/);
  assert.match(userListener, /FOLDERS_URL/);
  assert.match(reply, /reply_parameters/);
  assert.match(reply, /messageLogs/);
  assert.match(mediaReply, /reply_parameters/);
  assert.match(webhook, /x-telegram-bot-api-secret-token/);
  assert.match(webhook, /business_message/);
  assert.match(webhook, /edited_message/);
  assert.match(webhook, /channel_post/);
  assert.match(webhook, /edited_channel_post/);
  assert.match(webhook, /delete\(webhookUpdates\)/);
  assert.match(configure, /channel_post/);
  assert.match(status, /groupMessageAccess/);
  assert.match(status, /userGroupListener/);
  assert.match(desk, /Takip edilen grup akışı bekleniyor/);
  assert.equal(worker, undefined);
});
