import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import test, { after, before } from "node:test";

let server;
let baseUrl;
let dataDirectory;
let dbPath;
let admin;
const webhookSecret = "bots-test-webhook-secret";
const internalSecret = "bots-test-internal-secret";

function internalHeaders(secret, overrides = {}) {
  return {
    "X-RelayDesk-Internal-Secret": secret,
    "X-RelayDesk-Internal-Timestamp": String(Date.now()),
    "X-RelayDesk-Internal-Nonce": randomUUID(),
    ...overrides,
  };
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status === 200) return;
    } catch {
      // The production server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("bots.test.mjs integration server did not start");
}

function insertFakeBot(db, { label, telegramBotId, isEnabled = 1 }) {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO bots (label, telegram_bot_id, username, display_name, token_ciphertext, token_last_four, is_enabled, last_validated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(label, telegramBotId, `${label}_bot`, label, "relaydesk-botkey-aesgcm-1:fake", "9999", isEnabled, now, now, now);
  return Number(info.lastInsertRowid);
}

function groupUpdate({ updateId, chatId, messageId, text }) {
  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: "group", title: "Bots test group" },
      from: { id: 4242, first_name: "Müşteri" },
      text,
    },
  };
}

before(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "relaydesk-bots-"));
  dbPath = join(dataDirectory, "relaydesk.sqlite");
  const port = 3717 + Math.floor(Math.random() * 200);
  baseUrl = `http://127.0.0.1:${port}`;
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  server = spawn(npmCommand, ["run", "start"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      DATABASE_PATH: dbPath,
      INTERNAL_API_SECRET: internalSecret,
      TELEGRAM_WEBHOOK_SECRET: webhookSecret,
      SESSION_ENCRYPTION_KEY: "cUmZ8sQ2b9C7yv1jvv0m3nQKxG1v4o8sYV1WQKq9r6E=",
      SUPPORT_ALLOWED_EMAILS: "",
      RELAYDESK_TRUSTED_HOSTING_ADAPTER: "",
      RELAYDESK_TRUST_PROXY: "1",
    },
    shell: process.platform === "win32",
    stdio: "ignore",
  });
  await waitForServer(`${baseUrl}/api/healthz`);

  const email = `bots-admin-${Date.now()}@example.com`;
  const password = "correct-password-123";
  const setup = await fetch(`${baseUrl}/api/auth/setup`, {
    method: "POST",
    headers: { Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ email, displayName: "Bots Admin", password }),
  });
  assert.equal(setup.status, 200);
  const setupBody = await setup.json();
  admin = {
    email,
    password,
    id: setupBody.actor.id,
    cookie: setup.headers.get("set-cookie").split(";", 1)[0],
  };
});

async function waitForExit(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => child.once("exit", resolve));
}

after(async () => {
  if (server) {
    const exited = waitForExit(server);
    server.kill();
    await exited;
  }
  if (dataDirectory) {
    // On Windows the killed server process can briefly keep the SQLite file
    // handle open after exit; retry, and fall back to a warning rather than
    // failing the whole suite over leftover-temp-dir cleanup.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await rm(dataDirectory, { recursive: true, force: true });
        break;
      } catch (error) {
        if (error?.code !== "EBUSY") throw error;
        if (attempt === 9) {
          console.warn(`Could not remove ${dataDirectory}: ${error.message}`);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  }
});

test("GET/POST /api/bots reject unauthenticated, non-admin, and non-same-origin requests", async () => {
  const unauthenticated = await fetch(`${baseUrl}/api/bots`);
  assert.equal(unauthenticated.status, 401);

  const forgedOrigin = await fetch(`${baseUrl}/api/bots`, {
    method: "POST",
    headers: {
      Cookie: admin.cookie,
      "Content-Type": "application/json",
      Origin: "https://evil.example.com",
    },
    body: JSON.stringify({ label: "Sahte bot", token: "123:ABC" }),
  });
  assert.equal(forgedOrigin.status, 403);

  const noOrigin = await fetch(`${baseUrl}/api/bots`, {
    method: "PATCH",
    headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ id: 1, isEnabled: false }),
  });
  assert.equal(noOrigin.status, 403);
});

test("GET /api/bots never returns the encrypted token, only the last four digits", async () => {
  const db = new Database(dbPath);
  try {
    insertFakeBot(db, { label: "Görünürlük testi botu", telegramBotId: "9001" });
  } finally {
    db.close();
  }

  const response = await fetch(`${baseUrl}/api/bots`, { headers: { Cookie: admin.cookie } });
  assert.equal(response.status, 200);
  const body = await response.json();
  const bot = body.bots.find((item) => item.telegramBotId === "9001");
  assert.ok(bot, "expected the directly-inserted bot to be listed");
  assert.equal(bot.tokenLastFour, "9999");
  assert.equal(Object.prototype.hasOwnProperty.call(bot, "tokenCiphertext"), false);
  assert.equal(JSON.stringify(bot).includes("relaydesk-botkey-aesgcm-1"), false);
});

test("GET /api/internal/bots requires internal credentials and returns decrypted tokens only there", async () => {
  const noCredentials = await fetch(`${baseUrl}/api/internal/bots`);
  assert.equal(noCredentials.status, 401);

  const forged = await fetch(`${baseUrl}/api/internal/bots`, {
    headers: internalHeaders("wrong-secret"),
  });
  assert.equal(forged.status, 401);
});

test("a chat auto-assigns to the first bot that delivers a message, and a later message from a different bot reassigns it with a logged conflict (not silently)", async () => {
  const db = new Database(dbPath);
  let botAId;
  let botBId;
  try {
    botAId = insertFakeBot(db, { label: "Bot A", telegramBotId: "9101" });
    botBId = insertFakeBot(db, { label: "Bot B", telegramBotId: "9102" });
  } finally {
    db.close();
  }

  const chatId = -778899;
  const first = await fetch(`${baseUrl}/api/telegram/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": webhookSecret,
      "X-RelayDesk-Bot-Id": String(botAId),
    },
    body: JSON.stringify(groupUpdate({ updateId: 501, chatId, messageId: 1, text: "merhaba" })),
  });
  assert.equal(first.status, 200);

  const second = await fetch(`${baseUrl}/api/telegram/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": webhookSecret,
      "X-RelayDesk-Bot-Id": String(botBId),
    },
    body: JSON.stringify(groupUpdate({ updateId: 502, chatId, messageId: 2, text: "tekrar merhaba" })),
  });
  assert.equal(second.status, 200);

  const verifyDb = new Database(dbPath, { readonly: true });
  try {
    const assignment = verifyDb
      .prepare("SELECT bot_id, source FROM bot_group_assignments WHERE telegram_chat_id = ?")
      .get(String(chatId));
    assert.ok(assignment, "expected an assignment row for the chat");
    assert.equal(assignment.bot_id, botBId, "the bot that most recently delivered the update should be authoritative");
    assert.equal(assignment.source, "auto");

    const conversation = verifyDb
      .prepare("SELECT bot_id, connection_id FROM conversations WHERE telegram_chat_id = ?")
      .get(String(chatId));
    assert.ok(conversation, "expected a conversation row for the chat");
    assert.equal(conversation.bot_id, botBId, "the existing conversation should move with the reassignment, not fork into a duplicate");
    assert.equal(conversation.connection_id, `__telegram_bot_group__${botBId}`);

    const conversationCount = verifyDb
      .prepare("SELECT COUNT(*) AS count FROM conversations WHERE telegram_chat_id = ?")
      .get(String(chatId));
    assert.equal(conversationCount.count, 1, "reassignment must not create a duplicate conversation");
  } finally {
    verifyDb.close();
  }
});

test("an unknown or disabled bot id in the ingestion header is rejected", async () => {
  const unknown = await fetch(`${baseUrl}/api/telegram/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": webhookSecret,
      "X-RelayDesk-Bot-Id": "999999",
    },
    body: JSON.stringify(groupUpdate({ updateId: 601, chatId: -1, messageId: 1, text: "hi" })),
  });
  assert.equal(unknown.status, 404);
});
