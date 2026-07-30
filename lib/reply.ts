import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";

export type TelegramReplyParameters = { message_id: number };

export async function resolveReplyParameters(
  conversationId: number,
  value: unknown,
): Promise<TelegramReplyParameters | null | Response> {
  if (value === undefined || value === null || value === "") return null;
  const messageId = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return Response.json({ error: "Yanıtlanacak mesaj geçersiz." }, { status: 400 });
  }
  const target = await getDb()
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.telegramMessageId, String(messageId)),
      ),
    )
    .limit(1);
  if (!target.length) {
    return Response.json(
      { error: "Yanıtlanacak mesaj bu konuşmada bulunamadı." },
      { status: 404 },
    );
  }
  return { message_id: messageId };
}
