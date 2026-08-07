import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("builds the RelayDesk support application", async () => {
  const [page, desk, setupWizard, localSetupApi, localSetupBridge, messageLogPanel, messageLogApi, folderPanel, folderApi, folderAssignments, userListener, reply, mediaReply, webhook, configure, statusLogic, botsPanel, botsApi, worker] = await Promise.all([
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
    readFile(new URL("../lib/status.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/bots-panel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/bots/route.ts", import.meta.url), "utf8"),
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
   assert.match(folderApi, /requireInternalApi/);
  assert.match(folderApi, /recalculateFolderAssignments/);
  assert.match(folderAssignments, /assignmentSource/);
  assert.match(folderAssignments, /telegram_folder/);
  assert.match(userListener, /GetDialogFiltersRequest/);
  assert.match(userListener, /FOLDERS_URL/);
  assert.match(reply, /reply_parameters/);
  assert.match(reply, /messageLogs/);
  assert.match(mediaReply, /reply_parameters/);
  assert.match(webhook, /x-telegram-bot-api-secret-token/);
  assert.match(webhook, /x-relaydesk-bot-id/);
  assert.match(webhook, /business_message/);
  assert.match(webhook, /edited_message/);
  assert.match(webhook, /channel_post/);
  assert.match(webhook, /edited_channel_post/);
  assert.match(webhook, /delete\(webhookUpdates\)/);
  assert.match(configure, /channel_post/);
  assert.match(statusLogic, /groupMessageAccess/);
  assert.match(statusLogic, /userGroupListener/);
  assert.match(desk, /Takip edilen grup akışı bekleniyor/);
  assert.match(desk, /botsOpen && actor\?\.role === "admin"/);
  assert.match(desk, /<BotsPanel/);
  assert.match(botsPanel, /TELEGRAM · BOT PERSONA’LARI/);
  assert.match(botsApi, /requireAdmin/);
  assert.match(botsApi, /tokenLastFour/);
  assert.doesNotMatch(botsApi, /tokenCiphertext:\s*bots\.tokenCiphertext/);
  assert.equal(worker, undefined);
});

test("P0 Linux services use one env source and start Bot API polling", async () => {
  const [pollerUnit, webUnit, listenerUnit, bridgeUnit, bootstrap, envExample] = await Promise.all([
    readFile(new URL("../deploy/relaydesk-telegram-poller.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/relaydesk-web.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/relaydesk-listener.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/relaydesk-setup-bridge.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/relaydesk-bootstrap.sh", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  for (const unit of [webUnit, listenerUnit, bridgeUnit, pollerUnit]) {
    assert.match(unit, /User=relaydesk/);
    assert.match(unit, /EnvironmentFile=\/opt\/relaydesk\/\.env\.local/);
  }
  assert.match(pollerUnit, /telegram_long_poll\.py/);
  assert.match(pollerUnit, /Restart=on-failure/);
  assert.match(bootstrap, /relaydesk-telegram-poller\.service/);
  assert.doesNotMatch(bootstrap, /systemctl --user/);
  assert.match(
    bootstrap,
    /systemctl restart relaydesk-web\.service relaydesk-telegram-poller\.service/,
    "bootstrap must restart (not just start) already-running units on redeploy, or a rebuild leaves the old process/assets running",
  );
  assert.match(envExample, /INTERNAL_API_SECRET=/);
});

test("P0 readiness and history status keep authenticated status private", async () => {
  const [healthz, internalStatus, status, history, envExample] = await Promise.all([
    readFile(new URL("../app/api/healthz/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/internal/status/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/status/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/sync_telegram_history.py", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(healthz, /api\/healthz|ready/);
   assert.match(internalStatus, /requireInternalApi/);
  assert.match(internalStatus, /localhost|127\.0\.0\.1/);
  assert.match(history, /INTERNAL_API_SECRET/);
  assert.match(history, /X-RelayDesk-Internal-Secret/);
  assert.match(status, /requireActor/);
  assert.doesNotMatch(status, /export async function healthz/);
  assert.match(envExample, /INTERNAL_API_SECRET=/);
});

test("P0 fresh-host provisioning and remote setup bridge are documented", async () => {
  const [provision, sudoers, readme, bridge, listenerUnit] = await Promise.all([
    readFile(new URL("../deploy/provision-relaydesk.sh", import.meta.url), "utf8"),
    readFile(new URL("../deploy/relaydesk-sudoers", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../scripts/local_setup_bridge.py", import.meta.url), "utf8"),
    readFile(new URL("../deploy/relaydesk-listener.service", import.meta.url), "utf8"),
  ]);

  assert.match(provision, /useradd|groupadd/);
  assert.match(provision, /\/var\/lib\/relaydesk/);
  assert.match(provision, /chmod|install/);
  assert.match(sudoers, /relaydesk/);
  assert.match(readme, /-L 3000:localhost:3000 -L 8765:localhost:8765/);
  assert.match(readme, /long polling|long-polling/i);
  assert.match(readme, /\.env\.local/);
  assert.match(bridge, /systemctl/);
  assert.doesNotMatch(bridge, /systemctl", "--user/);
  assert.match(listenerUnit, /ConditionPathExists=\/var\/lib\/relaydesk\/telegram-user-session\.enc/);
});

test("P0 backup and restore use SQLite online backup with integrity checks", async () => {
  const [backup, restore, service, timer, readme] = await Promise.all([
    readFile(new URL("../deploy/backup-relaydesk.sh", import.meta.url), "utf8"),
    readFile(new URL("../deploy/restore-relaydesk.sh", import.meta.url), "utf8"),
    readFile(new URL("../deploy/relaydesk-backup.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/relaydesk-backup.timer", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(backup, /backup|sqlite/i);
  assert.match(backup, /\.backup\(|PRAGMA integrity_check/);
  assert.match(backup, /retention|mtime/i);
  assert.match(restore, /PRAGMA integrity_check/);
  assert.match(service, /Type=oneshot/);
  assert.match(timer, /OnCalendar/);
  assert.match(readme, /WAL|online backup/i);
  assert.match(readme, /restore|geri yük/i);
});

test("P0 restore fails closed around service state and SQLite sidecars", async () => {
  const restore = await readFile(new URL("../deploy/restore-relaydesk.sh", import.meta.url), "utf8");

  assert.match(restore, /systemctl show/);
  assert.match(restore, /systemctl is-active --quiet/);
  assert.match(restore, /systemctl start/);
  assert.match(restore, /-wal/);
  assert.match(restore, /-shm/);
  assert.match(restore, /PRAGMA integrity_check/);
  assert.match(restore, /SELECT COUNT\(\*\)/);
  assert.match(restore, /api\/healthz/);
  assert.doesNotMatch(restore, /\|\| true/);
});
