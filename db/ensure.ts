import { env } from "cloudflare:workers";

let initialized: Promise<void> | null = null;

const statements = [
  `CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'agent',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS telegram_connections (
    id TEXT PRIMARY KEY,
    telegram_user_id TEXT,
    display_name TEXT NOT NULL DEFAULT 'Telegram hesabı',
    username TEXT,
    rights_json TEXT NOT NULL DEFAULT '{}',
    is_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id TEXT NOT NULL,
    telegram_chat_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'private',
    title TEXT NOT NULL,
    username TEXT,
    avatar_seed TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    assigned_to_email TEXT,
    unread_count INTEGER NOT NULL DEFAULT 0,
    last_message TEXT NOT NULL DEFAULT '',
    last_message_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS conversations_connection_chat_unique
    ON conversations (connection_id, telegram_chat_id)`,
  `CREATE INDEX IF NOT EXISTS conversations_last_message_idx
    ON conversations (last_message_at)`,
  `CREATE INDEX IF NOT EXISTS conversations_assignee_idx
    ON conversations (assigned_to_email)`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    telegram_message_id TEXT NOT NULL,
    update_id TEXT,
    direction TEXT NOT NULL,
    sender_id TEXT,
    sender_name TEXT,
    text TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL DEFAULT 'text',
    file_id TEXT,
    file_name TEXT,
    mime_type TEXT,
    is_edited INTEGER NOT NULL DEFAULT 0,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    sent_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS messages_conversation_telegram_unique
    ON messages (conversation_id, telegram_message_id)`,
  `CREATE INDEX IF NOT EXISTS messages_conversation_sent_idx
    ON messages (conversation_id, sent_at)`,
  `CREATE TABLE IF NOT EXISTS webhook_updates (
    update_id INTEGER PRIMARY KEY,
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER,
    actor_email TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS audit_logs_conversation_idx
    ON audit_logs (conversation_id)`,
];

export async function ensureSchema(): Promise<void> {
  if (initialized) return initialized;

  initialized = (async () => {
    if (!env.DB) throw new Error("DB binding is unavailable");
    await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
  })();

  try {
    await initialized;
  } catch (error) {
    initialized = null;
    throw error;
  }
}
