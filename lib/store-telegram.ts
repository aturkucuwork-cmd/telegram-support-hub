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

export const BOT_GROUP_CONNECTION_ID = "__telegram_bot_groups__";

export async function storeTelegramMessage(options: {
  message: TelegramMessage;
  updateId?: number;
  edited?: boolean;
  connectionId?: string;
  outgoing?: boolean;
}) {
  const { message, updateId, edited = false } = options;
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
  const now = new Date().toISOString();
  const sentAt = new Date(message.date * 1000).toISOString();
  const title = chatTitle(message.chat);
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
      ),
    )
    .limit(1);

  if (!conversation) {
    [conversation] = await db
      .insert(conversations)
      .values({
        connectionId,
        telegramChatId: chatId,
        type: message.chat.type,
        title,
        username: message.chat.username ?? null,
        avatarSeed: title,
        lastMessage: content.preview,
        lastMessageAt: sentAt,
        unreadCount: outgoing || edited ? 0 : 1,
      })
      .returning();
  } else {
    const shouldIncrement = !outgoing && !edited;
    await db
      .update(conversations)
      .set({
        type: message.chat.type,
        title,
        username: message.chat.username ?? null,
        lastMessage: content.preview,
        lastMessageAt: sentAt,
        updatedAt: now,
        unreadCount: shouldIncrement
          ? sql`${conversations.unreadCount} + 1`
          : conversation.unreadCount,
      })
      .where(eq(conversations.id, conversation.id));
  }

  const telegramMessageId = String(message.message_id);
  const [existing] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversation.id),
        eq(messages.telegramMessageId, telegramMessageId),
      ),
    )
    .limit(1);

  const values = {
    updateId: updateId === undefined ? null : String(updateId),
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
