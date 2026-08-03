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
let admin;

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
  throw new Error("P1 security integration server did not start");
}

before(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "relaydesk-p1-"));
  const port = 3417 + Math.floor(Math.random() * 200);
  baseUrl = `http://127.0.0.1:${port}`;
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  server = spawn(npmCommand, ["run", "start"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      DATABASE_PATH: join(dataDirectory, "relaydesk.sqlite"),
      INTERNAL_API_SECRET: "p1-internal-test-secret",
      TELEGRAM_WEBHOOK_SECRET: "p1-webhook-test-secret",
      SUPPORT_ALLOWED_EMAILS: "",
      RELAYDESK_TRUSTED_HOSTING_ADAPTER: "",
      RELAYDESK_TRUST_PROXY: "1",
    },
    shell: process.platform === "win32",
    stdio: "ignore",
  });
  await waitForServer(`${baseUrl}/api/healthz`);

  const email = `p1-admin-${Date.now()}@example.com`;
  const password = "correct-password-123";
  const setup = await fetch(`${baseUrl}/api/auth/setup`, {
    method: "POST",
    headers: { Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ email, displayName: "P1 Admin", password }),
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

after(async () => {
  server?.kill();
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
});

test("internal API rejects webhook credentials, stale timestamps, replayed nonces, and forged payloads", async () => {
  const payload = {
    items: [{
      source: "group",
      outgoing: false,
      message: {
        message_id: 901,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -901, type: "group", title: "P1 test" },
        text: "internal message",
      },
    }],
  };

  const webhookCredential = await fetch(`${baseUrl}/api/telegram/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": "p1-webhook-test-secret",
    },
    body: JSON.stringify(payload),
  });
  assert.equal(webhookCredential.status, 401);

  const forged = await fetch(`${baseUrl}/api/telegram/import`, {
    method: "POST",
    headers: { ...internalHeaders("wrong-secret"), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(forged.status, 401);

  const stale = await fetch(`${baseUrl}/api/telegram/import`, {
    method: "POST",
    headers: {
      ...internalHeaders("p1-internal-test-secret", {
        "X-RelayDesk-Internal-Timestamp": String(Date.now() - 10 * 60 * 1000),
      }),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  assert.equal(stale.status, 401);

  const validHeaders = { ...internalHeaders("p1-internal-test-secret"), "Content-Type": "application/json" };
  const accepted = await fetch(`${baseUrl}/api/telegram/import`, {
    method: "POST",
    headers: validHeaders,
    body: JSON.stringify(payload),
  });
  assert.equal(accepted.status, 200);

  const replay = await fetch(`${baseUrl}/api/telegram/import`, {
    method: "POST",
    headers: validHeaders,
    body: JSON.stringify(payload),
  });
  assert.equal(replay.status, 401);

  const internalCursor = await fetch(`${baseUrl}/api/telegram/import`, {
    headers: internalHeaders("p1-internal-test-secret"),
  });
  assert.equal(internalCursor.status, 200);
});

test("listener and folder sync use the internal credential while webhook stays separate", async () => {
  const heartbeat = {
    telegramUserId: "12345",
    displayName: "P1 test listener",
    username: "p1_test",
  };
  const webhookHeader = await fetch(`${baseUrl}/api/telegram/user-listener`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "p1-webhook-test-secret" },
    body: JSON.stringify(heartbeat),
  });
  assert.equal(webhookHeader.status, 401);

  const listener = await fetch(`${baseUrl}/api/telegram/user-listener`, {
    method: "POST",
    headers: { ...internalHeaders("p1-internal-test-secret"), "Content-Type": "application/json" },
    body: JSON.stringify(heartbeat),
  });
  assert.equal(listener.status, 200);

  const folders = await fetch(`${baseUrl}/api/telegram/folders`, {
    method: "POST",
    headers: { ...internalHeaders("p1-internal-test-secret"), "Content-Type": "application/json" },
    body: JSON.stringify({ telegramUserId: "12345", folders: [] }),
  });
  assert.equal(folders.status, 200);

  const folderRead = await fetch(`${baseUrl}/api/telegram/folders`, {
    headers: internalHeaders("p1-internal-test-secret"),
  });
  assert.equal(folderRead.status, 200);

  const webhook = await fetch(`${baseUrl}/api/telegram/webhook`, {
    method: "POST",
    headers: { "X-RelayDesk-Internal-Secret": "p1-internal-test-secret", "Content-Type": "application/json" },
    body: JSON.stringify({ update_id: 902 }),
  });
  assert.equal(webhook.status, 401);
});

test("self-host ignores workspace identity headers and rate-limits repeated login failures", async () => {
  const workspace = await fetch(`${baseUrl}/api/status`, {
    headers: { "oai-authenticated-user-email": "attacker@example.com" },
  });
  assert.equal(workspace.status, 401);

  const email = `p1-${Date.now()}@example.com`;
  const statuses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        Origin: baseUrl,
        "X-Forwarded-For": "198.51.100.10",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password: "wrong-password" }),
    });
    statuses.push(response.status);
  }
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);

  const sameIpDifferentAccount = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      Origin: baseUrl,
      "X-Forwarded-For": "198.51.100.10",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: `other-${Date.now()}@example.com`, password: "wrong-password" }),
  });
  assert.equal(sameIpDifferentAccount.status, 401);

  const differentIpSameAccount = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      Origin: baseUrl,
      "X-Forwarded-For": "198.51.100.11",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password: "wrong-password" }),
  });
  assert.equal(differentIpSameAccount.status, 401);

  const database = new Database(join(dataDirectory, "relaydesk.sqlite"), { readonly: true });
  const auditRows = database
    .prepare("SELECT action, detail FROM audit_logs WHERE actor_email = ?")
    .all(email);
  database.close();
  assert.ok(auditRows.length >= 5);
  assert.ok(auditRows.every((row) => row.action === "login_failed"));
  assert.ok(auditRows.every((row) => row.detail === null));
  assert.ok(!JSON.stringify(auditRows).includes("wrong-password"));
});

async function login(email, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return {
    response,
    cookie: response.headers.get("set-cookie")?.split(";", 1)[0],
  };
}

test("expired sessions are rejected in the real HTTP flow", async () => {
  const session = await login(admin.email, admin.password);
  assert.equal(session.response.status, 200);
  assert.ok(session.cookie);

  const database = new Database(join(dataDirectory, "relaydesk.sqlite"));
  database
    .prepare("UPDATE agent_sessions SET expires_at = ? WHERE agent_id = ?")
    .run("2000-01-01T00:00:00.000Z", admin.id);
  database.close();

  const status = await fetch(`${baseUrl}/api/status`, {
    headers: { Cookie: session.cookie },
  });
  assert.equal(status.status, 401);
});

test("logout deletes the session and clears the cookie in the real HTTP flow", async () => {
  const session = await login(admin.email, admin.password);
  assert.equal(session.response.status, 200);
  assert.ok(session.cookie);

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { Origin: baseUrl, Cookie: session.cookie },
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);

  const status = await fetch(`${baseUrl}/api/status`, {
    headers: { Cookie: session.cookie },
  });
  assert.equal(status.status, 401);
});

test("changing a password invalidates the previous session in the real HTTP flow", async () => {
  const session = await login(admin.email, admin.password);
  assert.equal(session.response.status, 200);
  assert.ok(session.cookie);
  const nextPassword = "new-correct-password-456";

  const change = await fetch(`${baseUrl}/api/auth/users`, {
    method: "PATCH",
    headers: {
      Origin: baseUrl,
      Cookie: session.cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: admin.id, password: nextPassword }),
  });
  assert.equal(change.status, 200);

  const oldSession = await fetch(`${baseUrl}/api/status`, {
    headers: { Cookie: session.cookie },
  });
  assert.equal(oldSession.status, 401);

  const nextLogin = await login(admin.email, nextPassword);
  assert.equal(nextLogin.response.status, 200);
  assert.ok(nextLogin.cookie);
  admin.password = nextPassword;
});

test("cookie mutation routes reject cross-origin requests before authentication", async () => {
  const routes = [
    ["/api/reply", "POST", { conversationId: 1, text: "csrf" }],
    ["/api/reply/media", "POST", null],
    ["/api/conversations", "PATCH", { conversationId: 1, status: "open" }],
    ["/api/telegram/configure", "POST", {}],
    ["/api/telegram/folders", "PATCH", { folderId: 1, assignedToEmail: null }],
    ["/api/auth/users", "POST", {}],
    ["/api/auth/users", "PATCH", { id: 1 }],
    ["/api/auth/logout", "POST", null],
    ["/api/auth/setup", "POST", {}],
  ];
  for (const [path, method, body] of routes) {
    const headers = { Origin: "https://evil.example" };
    if (body !== null) headers["Content-Type"] = "application/json";
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      ...(body === null ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(response.status, 403, path);
  }
});
