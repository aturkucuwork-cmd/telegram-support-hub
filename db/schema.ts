import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const agents = sqliteTable("agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("agent"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const telegramConnections = sqliteTable("telegram_connections", {
  id: text("id").primaryKey(),
  telegramUserId: text("telegram_user_id"),
  displayName: text("display_name").notNull().default("Telegram hesabı"),
  username: text("username"),
  rightsJson: text("rights_json").notNull().default("{}"),
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const conversations = sqliteTable(
  "conversations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    connectionId: text("connection_id").notNull(),
    telegramChatId: text("telegram_chat_id").notNull(),
    type: text("type").notNull().default("private"),
    title: text("title").notNull(),
    username: text("username"),
    avatarSeed: text("avatar_seed"),
    status: text("status").notNull().default("open"),
    assignedToEmail: text("assigned_to_email"),
    unreadCount: integer("unread_count").notNull().default(0),
    lastMessage: text("last_message").notNull().default(""),
    lastMessageAt: text("last_message_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("conversations_connection_chat_unique").on(
      table.connectionId,
      table.telegramChatId,
    ),
    index("conversations_last_message_idx").on(table.lastMessageAt),
    index("conversations_assignee_idx").on(table.assignedToEmail),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: integer("conversation_id").notNull(),
    telegramMessageId: text("telegram_message_id").notNull(),
    updateId: text("update_id"),
    direction: text("direction").notNull(),
    senderId: text("sender_id"),
    senderName: text("sender_name"),
    text: text("text").notNull().default(""),
    contentType: text("content_type").notNull().default("text"),
    fileId: text("file_id"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    isEdited: integer("is_edited", { mode: "boolean" }).notNull().default(false),
    isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
    sentAt: text("sent_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("messages_conversation_telegram_unique").on(
      table.conversationId,
      table.telegramMessageId,
    ),
    index("messages_conversation_sent_idx").on(table.conversationId, table.sentAt),
  ],
);

export const webhookUpdates = sqliteTable("webhook_updates", {
  updateId: integer("update_id").primaryKey(),
  receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: integer("conversation_id"),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    detail: text("detail"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("audit_logs_conversation_idx").on(table.conversationId)],
);
