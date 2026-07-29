import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { conversations, messages } from "@/db/schema";
import { requireActor } from "@/lib/auth";

export async function GET(request: Request) {
  const actor = await requireActor(request);
  if (actor instanceof Response) return actor;

  const id = Number(new URL(request.url).searchParams.get("conversation_id"));
  if (!Number.isInteger(id)) {
    return Response.json({ error: "Geçersiz konuşma." }, { status: 400 });
  }

  await ensureSchema();
  const db = getDb();
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  if (!conversation) {
    return Response.json({ error: "Konuşma bulunamadı." }, { status: 404 });
  }

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.sentAt), asc(messages.id))
    .limit(500);

  if (conversation.unreadCount) {
    await db
      .update(conversations)
      .set({ unreadCount: 0 })
      .where(eq(conversations.id, id));
  }

  return Response.json({ conversation, messages: rows });
}
