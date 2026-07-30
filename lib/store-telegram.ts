import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  conversations,
  messages,
  telegramConnections,
} from "@/db/schema";
import {
  chatTitle,
  parseContent,
  personName,
  type TelegramMessage,
} from "@/lib/telegram";
import { findFolderAssignment } from "@/lib/folder-assignments";

export const BOT_GROUP_CONNECTION_ID = "__telegram_bot_groups__";

export async function storeTelegramMessage(options: {
  message: TelegramMessage;
  updateId?: number;
  edited?: boolean;
  connectionId?: string;
  outgoing?: boolean;
  historical?: boolean;
}) {
  const { message, updateId, edited = false, historical = false } = options;
  const businessConnectionId = message.business_connection_id;
  const connectionId = options.connectionId ?? businessConnectionId;
  if (!connectionId) throw new Error("Telegram bağlantı kimliği eksik.");

  const db = getDb();
  const [connection] = businessConnectionId
    ? await db
        .insert(telegramConnections)
        .values({ id: connectionId })
        .onConflictDoNothing()
        .then(() =>
          db
            .select({ telegramUserId: telegramConnections.telegramUserId })
            .from(telegramConnections)
            .where(eq(telegramConnections.id, connectionId))
            .limit(1),
        )
    : [];

  const chatId = String(message.chat.id);
  const topicId = message.message_thread_id === undefined
    ? ""
    : String(message.message_thread_id);
  const now = new Date().toISOString();
  const sentAt = new Date(message.date * 1000).toISOString();
  const baseTitle = chatTitle(message.chat);
  const topicTitle =
    message.relaydesk_topic_title ?? message.forum_topic_created?.name;
  const title = topicId
    ? `${baseTitle} · ${topicTitle || `Konu #${topicId}`}`
    : baseTitle;
  const content = parseContent(message);
  const outgoing = options.outgoing ??
    (Boolean(message.sender_business_bot) ||
      (connection?.telegramUserId !== null &&
        connection?.telegramUserId !== undefined &&
        String(message.from?.id) === connection.telegramUserId));

  let [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.connectionId, connectionId),
        eq(conversations.telegramChatId, chatId),
        eq(conversations.topicId, topicId),
      ),
    )
    .limit(1);

  const folderAssignment = !conversation || conversation.assignmentSource === null
    ? await findFolderAssignment(chatId)
    : null;

  const telegramMessageId = String(message.message_id);
  const [existing] = conversation
    ? await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversation.id),
            eq(messages.telegramMessageId, telegramMessageId),
          ),
        )
        .limit(1)
    : [];

  if (!conversation) {
    [conversation] = await db
      .insert(conversations)
      .values({
        connectionId,
        telegramChatId: chatId,
        topicId,
        type: message.chat.type,
        title,
        username: message.chat.username ?? null,
        avatarSeed: title,
        lastMessage: content.preview,
        lastMessageAt: sentAt,
        unreadCount: outgoing || edited || historical ? 0 : 1,
        assignedToEmail: folderAssignment?.email ?? null,
        assignmentSource: folderAssignment ? "telegram_folder" : null,
        assignmentFolderId: folderAssignment?.folderId ?? null,
      })
      .returning();
  } else {
    const shouldIncrement = !existing && !historical && !outgoing && !edited;
    const shouldRefreshPreview = sentAt >= conversation.lastMessageAt;
    await db
      .update(conversations)
      .set({
        type: message.chat.type,
        title: topicId && !topicTitle ? conversation.title : title,
        username: message.chat.username ?? null,
        updatedAt: now,
        ...(shouldRefreshPreview
          ? { lastMessage: content.preview, lastMessageAt: sentAt }
          : {}),
        unreadCount: shouldIncrement
          ? sql`${conversations.unreadCount} + 1`
          : conversation.unreadCount,
        ...(folderAssignment
          ? {
              assignedToEmail: folderAssignment.email,
              assignmentSource: "telegram_folder",
              assignmentFolderId: folderAssignment.folderId,
            }
          : {}),
      })
      .where(eq(conversations.id, conversation.id));
  }

  const values = {
    updateId: updateId === undefined ? null : String(updateId),
    replyToTelegramMessageId:
      message.reply_to_message?.message_id === undefined
        ? null
        : String(message.reply_to_message.message_id),
    direction: outgoing ? "outbound" : "inbound",
    senderId: message.from?.id === undefined ? null : String(message.from.id),
    senderName: outgoing ? "Destek" : personName(message.from),
    text: content.text,
    contentType: content.contentType,
    fileId: content.fileId,
    fileName: content.fileName,
    mimeType: content.mimeType,
    isEdited: edited,
    isDeleted: false,
    sentAt,
  };

  if (existing) {
    await db.update(messages).set(values).where(eq(messages.id, existing.id));
  } else {
    await db.insert(messages).values({
      conversationId: conversation.id,
      telegramMessageId,
      ...values,
    });
  }

  return conversation.id;
}

export async function markDeletedMessages(options: {
  connectionId: string;
  chatId: string;
  messageIds: number[];
}) {
  const db = getDb();
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.connectionId, options.connectionId),
        eq(conversations.telegramChatId, options.chatId),
      ),
    )
    .limit(1);

  if (!conversation) return;
  for (const messageId of options.messageIds) {
    await db
      .update(messages)
      .set({ isDeleted: true, text: "Bu mesaj silindi." })
      .where(
        and(
          eq(messages.conversationId, conversation.id),
          eq(messages.telegramMessageId, String(messageId)),
        ),
      );
  }
}
