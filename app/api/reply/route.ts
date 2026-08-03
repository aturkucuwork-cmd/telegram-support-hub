import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { auditLogs, conversations, messageLogs } from "@/db/schema";
import { isSameOriginRequest, requireActor } from "@/lib/auth";
import { pruneExpiredMessageLogs } from "@/lib/message-logs";
import { resolveReplyParameters } from "@/lib/reply";
import { BOT_GROUP_CONNECTION_ID, storeTelegramMessage } from "@/lib/store-telegram";
import { telegramApi, type TelegramMessage } from "@/lib/telegram";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Geçersiz istek kaynağı." }, { status: 403 });
  }
  const actor = await requireActor(request);
  if (actor instanceof Response) return actor;

  const payload = (await request.json()) as {
    conversationId?: number;
    text?: string;
    replyToMessageId?: unknown;
  };
  const text = payload.text?.trim() ?? "";
  if (!Number.isInteger(payload.conversationId) || !text || text.length > 4096) {
    return Response.json({ error: "Mesaj metni geçersiz." }, { status: 400 });
  }

  await ensureSchema();
  const db = getDb();
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, payload.conversationId!))
    .limit(1);
  if (!conversation) {
    return Response.json({ error: "Konuşma bulunamadı." }, { status: 404 });
  }
  const replyParameters = await resolveReplyParameters(
    conversation.id,
    payload.replyToMessageId,
  );
  if (replyParameters instanceof Response) return replyParameters;

  try {
    const isBotGroup = conversation.connectionId === BOT_GROUP_CONNECTION_ID;
    const message = await telegramApi<TelegramMessage>("sendMessage", {
      ...(isBotGroup ? {} : { business_connection_id: conversation.connectionId }),
      chat_id: conversation.telegramChatId,
      ...(conversation.topicId
        ? { message_thread_id: Number(conversation.topicId) }
        : {}),
      ...(replyParameters ? { reply_parameters: replyParameters } : {}),
      text,
    });
    if (!isBotGroup) message.business_connection_id ??= conversation.connectionId;
    const conversationId = await storeTelegramMessage({
      message,
      connectionId: conversation.connectionId,
      outgoing: true,
    });
    await db.insert(auditLogs).values({
      conversationId,
      actorEmail: actor.email,
      action: "message_sent",
      detail: JSON.stringify({
        telegramMessageId: message.message_id,
        replyToMessageId: replyParameters?.message_id,
      }),
    });
    await db
      .insert(messageLogs)
      .values({
        conversationId,
        telegramMessageId: String(message.message_id),
        actorEmail: actor.email,
        actorDisplayName: actor.displayName,
        conversationTitle: conversation.title,
        messageText: text,
        sentAt: new Date().toISOString(),
      })
      .onConflictDoNothing();
    await pruneExpiredMessageLogs();
    return Response.json({ ok: true, message });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Mesaj gönderilemedi." },
      { status: 502 },
    );
  }
}
