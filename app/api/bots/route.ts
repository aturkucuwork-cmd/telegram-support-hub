import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { auditLogs, botGroupAssignments, bots } from "@/db/schema";
import { isSameOriginRequest, requireAdmin } from "@/lib/auth";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { telegramApi, type TelegramUser } from "@/lib/telegram";

const publicFields = {
  id: bots.id,
  label: bots.label,
  telegramBotId: bots.telegramBotId,
  username: bots.username,
  displayName: bots.displayName,
  tokenLastFour: bots.tokenLastFour,
  isEnabled: bots.isEnabled,
  lastValidatedAt: bots.lastValidatedAt,
  lastPollErrorAt: bots.lastPollErrorAt,
  lastPollError: bots.lastPollError,
  createdAt: bots.createdAt,
  updatedAt: bots.updatedAt,
};

export async function GET(request: Request) {
  const actor = await requireAdmin(request);
  if (actor instanceof Response) return actor;
  await ensureSchema();
  const db = getDb();
  const [rows, groupCounts] = await Promise.all([
    db.select(publicFields).from(bots).orderBy(asc(bots.label)),
    db
      .select({
        botId: botGroupAssignments.botId,
        count: sql<number>`count(*)`,
      })
      .from(botGroupAssignments)
      .groupBy(botGroupAssignments.botId),
  ]);
  const countByBot = new Map(groupCounts.map((row) => [row.botId, row.count]));
  return Response.json({
    bots: rows.map((bot) => ({
      ...bot,
      groupCount: countByBot.get(bot.id) ?? 0,
    })),
  });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Geçersiz istek kaynağı." }, { status: 403 });
  }
  const actor = await requireAdmin(request);
  if (actor instanceof Response) return actor;
  const payload = (await request.json().catch(() => ({}))) as {
    label?: unknown;
    token?: unknown;
  };
  const label = typeof payload.label === "string" ? payload.label.trim() : "";
  const token = typeof payload.token === "string" ? payload.token.trim() : "";
  if (label.length < 2 || label.length > 80) {
    return Response.json({ error: "Etiket 2-80 karakter olmalıdır." }, { status: 400 });
  }
  if (!token) {
    return Response.json({ error: "Bot token'ı gerekli." }, { status: 400 });
  }

  let botUser: TelegramUser;
  try {
    botUser = await telegramApi<TelegramUser>("getMe", {}, { botToken: token });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Bot token'ı doğrulanamadı." },
      { status: 400 },
    );
  }
  if (botUser.id === undefined) {
    return Response.json({ error: "Bot token'ı doğrulanamadı." }, { status: 400 });
  }

  await ensureSchema();
  const db = getDb();
  const telegramBotId = String(botUser.id);
  const existing = await db
    .select({ id: bots.id })
    .from(bots)
    .where(eq(bots.telegramBotId, telegramBotId))
    .limit(1);
  if (existing.length) {
    return Response.json({ error: "Bu bot zaten kayıtlı." }, { status: 409 });
  }

  const now = new Date().toISOString();
  const [bot] = await db
    .insert(bots)
    .values({
      label,
      telegramBotId,
      username: botUser.username ?? null,
      displayName: botUser.first_name ?? null,
      tokenCiphertext: encryptSecret(token),
      tokenLastFour: token.slice(-4),
      lastValidatedAt: now,
    })
    .returning(publicFields);

  await db.insert(auditLogs).values({
    actorEmail: actor.email,
    action: "bot_created",
    detail: JSON.stringify({ botId: bot.id, telegramBotId, username: botUser.username }),
  });

  return Response.json({ bot: { ...bot, groupCount: 0 } }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Geçersiz istek kaynağı." }, { status: 403 });
  }
  const actor = await requireAdmin(request);
  if (actor instanceof Response) return actor;
  const payload = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    label?: unknown;
    isEnabled?: unknown;
    revalidate?: unknown;
  };
  if (!Number.isInteger(payload.id)) {
    return Response.json({ error: "Geçersiz bot." }, { status: 400 });
  }
  const id = payload.id as number;

  await ensureSchema();
  const db = getDb();
  const [bot] = await db.select().from(bots).where(eq(bots.id, id)).limit(1);
  if (!bot) return Response.json({ error: "Bot bulunamadı." }, { status: 404 });

  const changes: Partial<typeof bots.$inferInsert> = {};
  if (typeof payload.label === "string") {
    const label = payload.label.trim();
    if (label.length < 2 || label.length > 80) {
      return Response.json({ error: "Etiket 2-80 karakter olmalıdır." }, { status: 400 });
    }
    changes.label = label;
  }
  if (typeof payload.isEnabled === "boolean") changes.isEnabled = payload.isEnabled;

  if (payload.revalidate === true) {
    try {
      const botUser = await telegramApi<TelegramUser>(
        "getMe",
        {},
        { botToken: decryptSecret(bot.tokenCiphertext) },
      );
      changes.username = botUser.username ?? null;
      changes.displayName = botUser.first_name ?? null;
      changes.lastValidatedAt = new Date().toISOString();
      changes.lastPollError = null;
      changes.lastPollErrorAt = null;
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Bot token'ı doğrulanamadı." },
        { status: 400 },
      );
    }
  }

  if (!Object.keys(changes).length) {
    return Response.json({ error: "Güncellenecek alan bulunamadı." }, { status: 400 });
  }
  changes.updatedAt = new Date().toISOString();
  const [updated] = await db
    .update(bots)
    .set(changes)
    .where(eq(bots.id, id))
    .returning(publicFields);

  if (typeof payload.isEnabled === "boolean") {
    await db.insert(auditLogs).values({
      actorEmail: actor.email,
      action: payload.isEnabled ? "bot_enabled" : "bot_disabled",
      detail: JSON.stringify({ botId: id, telegramBotId: bot.telegramBotId }),
    });
  }

  return Response.json({ bot: updated });
}
