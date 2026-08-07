import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { auditLogs, botGroupAssignments, bots } from "@/db/schema";
import { isSameOriginRequest, requireAdmin } from "@/lib/auth";
import { reassignConversationBot } from "@/lib/bots";

export async function GET(request: Request) {
  const actor = await requireAdmin(request);
  if (actor instanceof Response) return actor;
  await ensureSchema();
  const assignments = await getDb()
    .select()
    .from(botGroupAssignments)
    .orderBy(asc(botGroupAssignments.title));
  return Response.json({ assignments });
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Geçersiz istek kaynağı." }, { status: 403 });
  }
  const actor = await requireAdmin(request);
  if (actor instanceof Response) return actor;
  const payload = (await request.json().catch(() => ({}))) as {
    telegramChatId?: unknown;
    botId?: unknown;
  };
  if (
    typeof payload.telegramChatId !== "string" ||
    !payload.telegramChatId ||
    !Number.isInteger(payload.botId)
  ) {
    return Response.json({ error: "Geçersiz grup ataması." }, { status: 400 });
  }
  const telegramChatId = payload.telegramChatId;
  const botId = payload.botId as number;

  await ensureSchema();
  const db = getDb();
  const [bot] = await db.select({ id: bots.id }).from(bots).where(eq(bots.id, botId)).limit(1);
  if (!bot) return Response.json({ error: "Bot bulunamadı." }, { status: 404 });

  const [assignment] = await db
    .select()
    .from(botGroupAssignments)
    .where(eq(botGroupAssignments.telegramChatId, telegramChatId))
    .limit(1);
  if (!assignment) {
    return Response.json({ error: "Grup ataması bulunamadı." }, { status: 404 });
  }

  const previousBotId = assignment.botId;
  const [updated] = await db
    .update(botGroupAssignments)
    .set({ botId, source: "manual", updatedAt: new Date().toISOString() })
    .where(eq(botGroupAssignments.telegramChatId, telegramChatId))
    .returning();
  await reassignConversationBot({ telegramChatId, fromBotId: previousBotId, toBotId: botId });

  await db.insert(auditLogs).values({
    actorEmail: actor.email,
    action: "bot_group_reassigned",
    detail: JSON.stringify({ telegramChatId, fromBotId: previousBotId, toBotId: botId }),
  });

  return Response.json({ assignment: updated });
}
