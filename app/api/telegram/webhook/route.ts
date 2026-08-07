import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { bots, telegramConnections, webhookUpdates } from "@/db/schema";
import {
  BOT_GROUP_CONNECTION_ID,
  markDeletedMessages,
  storeTelegramMessage,
} from "@/lib/store-telegram";
import {
  personName,
  telegramConfig,
  type TelegramChat,
  type TelegramMessage,
  type TelegramUser,
} from "@/lib/telegram";

type TelegramUpdate = {
  update_id: number;
  business_connection?: {
    id: string;
    user: TelegramUser;
    rights?: Record<string, boolean>;
    is_enabled: boolean;
  };
  business_message?: TelegramMessage;
  edited_business_message?: TelegramMessage;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  deleted_business_messages?: {
    business_connection_id: string;
    chat: TelegramChat;
    message_ids: number[];
  };
};

export async function POST(request: Request) {
  const { webhookSecret } = telegramConfig();
  if (!webhookSecret) {
    return Response.json({ error: "Webhook henüz yapılandırılmadı." }, { status: 503 });
  }
  if (
    request.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret
  ) {
    return Response.json({ error: "Geçersiz webhook imzası." }, { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;
  if (!Number.isInteger(update.update_id)) {
    return Response.json({ error: "Geçersiz Telegram güncellemesi." }, { status: 400 });
  }

  await ensureSchema();
  const db = getDb();

  const botIdHeader = request.headers.get("x-relaydesk-bot-id")?.trim();
  let botId: number | undefined;
  if (botIdHeader) {
    if (!/^\d+$/.test(botIdHeader)) {
      return Response.json({ error: "Geçersiz bot kimliği." }, { status: 400 });
    }
    const [bot] = await db
      .select({ id: bots.id, isEnabled: bots.isEnabled })
      .from(bots)
      .where(eq(bots.id, Number(botIdHeader)))
      .limit(1);
    if (!bot || !bot.isEnabled) {
      return Response.json({ error: "Bilinmeyen bot kimliği." }, { status: 404 });
    }
    botId = bot.id;
  }

  const inserted = await db
    .insert(webhookUpdates)
    .values({ updateId: update.update_id })
    .onConflictDoNothing()
    .returning({ updateId: webhookUpdates.updateId });
  if (!inserted.length) return Response.json({ ok: true, duplicate: true });

  try {
    const connection = update.business_connection;
    if (connection) {
      const values = {
        telegramUserId:
          connection.user.id === undefined ? null : String(connection.user.id),
        displayName: personName(connection.user),
        username: connection.user.username ?? null,
        rightsJson: JSON.stringify(connection.rights ?? {}),
        isEnabled: connection.is_enabled,
        updatedAt: new Date().toISOString(),
      };
      await db
        .insert(telegramConnections)
        .values({ id: connection.id, ...values })
        .onConflictDoUpdate({
          target: telegramConnections.id,
          set: values,
        });
    }

    if (update.business_message) {
      await storeTelegramMessage({
        message: update.business_message,
        updateId: update.update_id,
      });
    }
    if (update.edited_business_message) {
      await storeTelegramMessage({
        message: update.edited_business_message,
        updateId: update.update_id,
        edited: true,
      });
    }
    const groupConnectionId = botId === undefined ? BOT_GROUP_CONNECTION_ID : undefined;
    if (
      update.message &&
      ["group", "supergroup"].includes(update.message.chat.type)
    ) {
      await storeTelegramMessage({
        message: update.message,
        updateId: update.update_id,
        connectionId: groupConnectionId,
        botId,
      });
    }
    if (
      update.edited_message &&
      ["group", "supergroup"].includes(update.edited_message.chat.type)
    ) {
      await storeTelegramMessage({
        message: update.edited_message,
        updateId: update.update_id,
        connectionId: groupConnectionId,
        botId,
        edited: true,
      });
    }
    if (update.channel_post) {
      await storeTelegramMessage({
        message: update.channel_post,
        updateId: update.update_id,
        connectionId: groupConnectionId,
        botId,
      });
    }
    if (update.edited_channel_post) {
      await storeTelegramMessage({
        message: update.edited_channel_post,
        updateId: update.update_id,
        connectionId: groupConnectionId,
        botId,
        edited: true,
      });
    }
    if (update.deleted_business_messages) {
      await markDeletedMessages({
        connectionId: update.deleted_business_messages.business_connection_id,
        chatId: String(update.deleted_business_messages.chat.id),
        messageIds: update.deleted_business_messages.message_ids,
      });
    }

    if (connection && !connection.is_enabled) {
      await db
        .update(telegramConnections)
        .set({ isEnabled: false, updatedAt: new Date().toISOString() })
        .where(eq(telegramConnections.id, connection.id));
    }

    return Response.json({ ok: true });
  } catch (error) {
    await db
      .delete(webhookUpdates)
      .where(eq(webhookUpdates.updateId, update.update_id));
    throw error;
  }
}
