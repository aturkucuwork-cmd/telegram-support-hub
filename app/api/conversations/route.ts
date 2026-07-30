import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { auditLogs, conversations } from "@/db/schema";
import { requireActor } from "@/lib/auth";

export async function GET(request: Request) {
  const actor = await requireActor(request);
  if (actor instanceof Response) return actor;

  await ensureSchema();
  const rows = await getDb()
    .select()
    .from(conversations)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(250);

  const chatsWithTopics = new Set(
    rows
      .filter((conversation) => conversation.topicId)
      .map(
        (conversation) =>
          `${conversation.connectionId}:${conversation.telegramChatId}`,
      ),
  );
  const visibleRows = rows.filter(
    (conversation) =>
      conversation.topicId ||
      !chatsWithTopics.has(
        `${conversation.connectionId}:${conversation.telegramChatId}`,
      ),
  );

  return Response.json({ conversations: visibleRows, actor });
}

export async function PATCH(request: Request) {
  const actor = await requireActor(request);
  if (actor instanceof Response) return actor;

  const payload = (await request.json()) as {
    conversationId?: number;
    status?: string;
    assignedToEmail?: string | null;
    markRead?: boolean;
  };
  if (!Number.isInteger(payload.conversationId)) {
    return Response.json({ error: "Geçersiz konuşma." }, { status: 400 });
  }
  if (payload.status && !["open", "pending", "resolved"].includes(payload.status)) {
    return Response.json({ error: "Geçersiz durum." }, { status: 400 });
  }

  await ensureSchema();
  const db = getDb();
  const changes: Partial<typeof conversations.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (payload.status) changes.status = payload.status;
  if (payload.assignedToEmail !== undefined) {
    changes.assignedToEmail = payload.assignedToEmail || null;
  }
  if (payload.markRead) changes.unreadCount = 0;

  const [conversation] = await db
    .update(conversations)
    .set(changes)
    .where(eq(conversations.id, payload.conversationId!))
    .returning();

  if (!conversation) {
    return Response.json({ error: "Konuşma bulunamadı." }, { status: 404 });
  }

  await db.insert(auditLogs).values({
    conversationId: conversation.id,
    actorEmail: actor.email,
    action: payload.status
      ? "status_changed"
      : payload.assignedToEmail !== undefined
        ? "assignment_changed"
        : "read",
    detail: JSON.stringify({
      status: payload.status,
      assignedToEmail: payload.assignedToEmail,
    }),
  });

  return Response.json({ conversation });
}
