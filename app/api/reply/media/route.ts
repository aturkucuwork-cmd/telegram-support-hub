import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { auditLogs, conversations } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { resolveReplyParameters } from "@/lib/reply";
import {
  BOT_GROUP_CONNECTION_ID,
  storeTelegramMessage,
} from "@/lib/store-telegram";
import {
  telegramMultipartApi,
  type TelegramMessage,
} from "@/lib/telegram";

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_TYPES = new Set(["video/mp4"]);
const PHOTO_LIMIT = 10 * 1024 * 1024;
const VIDEO_LIMIT = 50 * 1024 * 1024;

export async function POST(request: Request) {
  const actor = await requireActor(request);
  if (actor instanceof Response) return actor;

  const formData = await request.formData();
  const conversationId = Number(formData.get("conversationId"));
  const captionValue = formData.get("caption");
  const caption = typeof captionValue === "string" ? captionValue.trim() : "";
  const replyToMessageId = formData.get("replyToMessageId");
  const file = formData.get("file");

  if (!Number.isInteger(conversationId)) {
    return Response.json({ error: "Geçersiz konuşma." }, { status: 400 });
  }
  if (!(file instanceof File) || file.size < 1) {
    return Response.json({ error: "Fotoğraf veya video seçilmedi." }, { status: 400 });
  }
  if (caption.length > 1024) {
    return Response.json({ error: "Medya açıklaması en fazla 1024 karakter olabilir." }, { status: 400 });
  }

  const isPhoto = PHOTO_TYPES.has(file.type);
  const isVideo = VIDEO_TYPES.has(file.type);
  if (!isPhoto && !isVideo) {
    return Response.json(
      { error: "Yalnızca JPG, PNG, WEBP fotoğraf veya MP4 video gönderebilirsiniz." },
      { status: 415 },
    );
  }
  if (isPhoto && file.size > PHOTO_LIMIT) {
    return Response.json({ error: "Fotoğraf en fazla 10 MB olabilir." }, { status: 413 });
  }
  if (isVideo && file.size > VIDEO_LIMIT) {
    return Response.json({ error: "Video en fazla 50 MB olabilir." }, { status: 413 });
  }

  await ensureSchema();
  const db = getDb();
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conversation) {
    return Response.json({ error: "Konuşma bulunamadı." }, { status: 404 });
  }
  const replyParameters = await resolveReplyParameters(
    conversation.id,
    replyToMessageId,
  );
  if (replyParameters instanceof Response) return replyParameters;

  const isBotGroup = conversation.connectionId === BOT_GROUP_CONNECTION_ID;
  const telegramForm = new FormData();
  telegramForm.set("chat_id", conversation.telegramChatId);
  if (!isBotGroup) {
    telegramForm.set("business_connection_id", conversation.connectionId);
  }
  if (conversation.topicId) {
    telegramForm.set("message_thread_id", conversation.topicId);
  }
  if (caption) telegramForm.set("caption", caption);
  if (replyParameters) {
    telegramForm.set("reply_parameters", JSON.stringify(replyParameters));
  }
  const mediaField = isPhoto ? "photo" : "video";
  telegramForm.set(mediaField, file, file.name);
  if (isVideo) telegramForm.set("supports_streaming", "true");

  try {
    const message = await telegramMultipartApi<TelegramMessage>(
      isPhoto ? "sendPhoto" : "sendVideo",
      telegramForm,
    );
    if (!isBotGroup) message.business_connection_id ??= conversation.connectionId;
    message.message_thread_id ??= conversation.topicId
      ? Number(conversation.topicId)
      : undefined;
    const storedConversationId = await storeTelegramMessage({
      message,
      connectionId: conversation.connectionId,
      outgoing: true,
    });
    await db.insert(auditLogs).values({
      conversationId: storedConversationId,
      actorEmail: actor.email,
      action: "media_sent",
      detail: JSON.stringify({
        telegramMessageId: message.message_id,
        mediaType: isPhoto ? "photo" : "video",
        size: file.size,
        replyToMessageId: replyParameters?.message_id,
      }),
    });
    return Response.json({ ok: true, message });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Medya gönderilemedi." },
      { status: 502 },
    );
  }
}
