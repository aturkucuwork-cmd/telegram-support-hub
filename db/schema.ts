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
  passwordHash: text("password_hash"),
  passwordSalt: text("password_salt"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const agentSessions = sqliteTable(
  "agent_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    agentId: integer("agent_id").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("agent_sessions_agent_idx").on(table.agentId),
    index("agent_sessions_expires_idx").on(table.expiresAt),
  ],
);

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

export const telegramUserListeners = sqliteTable("telegram_user_listeners", {
  id: text("id").primaryKey(),
  telegramUserId: text("telegram_user_id").notNull(),
  displayName: text("display_name").notNull(),
  username: text("username"),
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
  lastHeartbeatAt: text("last_heartbeat_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const telegramFolders = sqliteTable(
  "telegram_folders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    telegramUserId: text("telegram_user_id").notNull(),
    telegramFolderId: integer("telegram_folder_id").notNull(),
    title: text("title").notNull(),
    assignedToEmail: text("assigned_to_email"),
    mappingUpdatedAt: text("mapping_updated_at"),
    memberCount: integer("member_count").notNull().default(0),
    lastSyncedAt: text("last_synced_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("telegram_folders_user_folder_unique").on(
      table.telegramUserId,
      table.telegramFolderId,
    ),
    index("telegram_folders_assignee_idx").on(table.assignedToEmail),
  ],
);

export const telegramFolderMembers = sqliteTable(
  "telegram_folder_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    folderId: integer("folder_id").notNull(),
    telegramPeerId: text("telegram_peer_id").notNull(),
    peerType: text("peer_type").notNull(),
    peerTitle: text("peer_title").notNull(),
    peerUsername: text("peer_username"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("telegram_folder_members_folder_peer_unique").on(
      table.folderId,
      table.telegramPeerId,
    ),
    index("telegram_folder_members_peer_idx").on(table.telegramPeerId),
  ],
);

export const bots = sqliteTable(
  "bots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    label: text("label").notNull(),
    telegramBotId: text("telegram_bot_id").notNull(),
    username: text("username"),
    displayName: text("display_name"),
    tokenCiphertext: text("token_ciphertext").notNull(),
    tokenLastFour: text("token_last_four").notNull(),
    isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
    lastValidatedAt: text("last_validated_at"),
    lastPollErrorAt: text("last_poll_error_at"),
    lastPollError: text("last_poll_error"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("bots_telegram_bot_id_unique").on(table.telegramBotId),
    index("bots_enabled_idx").on(table.isEnabled),
  ],
);

export const botGroupAssignments = sqliteTable(
  "bot_group_assignments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    botId: integer("bot_id").notNull(),
    telegramChatId: text("telegram_chat_id").notNull(),
    title: text("title"),
    source: text("source").notNull().default("auto"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("bot_group_assignments_chat_unique").on(table.telegramChatId),
    index("bot_group_assignments_bot_idx").on(table.botId),
  ],
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    connectionId: text("connection_id").notNull(),
    telegramChatId: text("telegram_chat_id").notNull(),
    topicId: text("topic_id").notNull().default(""),
    type: text("type").notNull().default("private"),
    title: text("title").notNull(),
    username: text("username"),
    avatarSeed: text("avatar_seed"),
    status: text("status").notNull().default("open"),
    assignedToEmail: text("assigned_to_email"),
    assignmentSource: text("assignment_source"),
    assignmentFolderId: integer("assignment_folder_id"),
    botId: integer("bot_id"),
    unreadCount: integer("unread_count").notNull().default(0),
    lastMessage: text("last_message").notNull().default(""),
    lastMessageAt: text("last_message_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("conversations_connection_chat_topic_unique").on(
      table.connectionId,
      table.telegramChatId,
      table.topicId,
    ),
    index("conversations_last_message_idx").on(table.lastMessageAt),
    index("conversations_assignee_idx").on(table.assignedToEmail),
    index("conversations_assignment_folder_idx").on(table.assignmentFolderId),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: integer("conversation_id").notNull(),
    telegramMessageId: text("telegram_message_id").notNull(),
    replyToTelegramMessageId: text("reply_to_telegram_message_id"),
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

export const messageLogs = sqliteTable(
  "message_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: integer("conversation_id").notNull(),
    telegramMessageId: text("telegram_message_id").notNull(),
    actorEmail: text("actor_email").notNull(),
    actorDisplayName: text("actor_display_name").notNull(),
    conversationTitle: text("conversation_title").notNull(),
    messageText: text("message_text").notNull(),
    sentAt: text("sent_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("message_logs_conversation_telegram_unique").on(
      table.conversationId,
      table.telegramMessageId,
    ),
    index("message_logs_sent_at_idx").on(table.sentAt),
    index("message_logs_actor_email_idx").on(table.actorEmail),
  ],
);
