import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { auditLogs, botGroupAssignments, bots, conversations } from "@/db/schema";
import { isSameOriginRequest, requireAdmin } from "@/lib/auth";
import { BOT_GROUP_CONNECTION_ID } from "@/lib/store-telegram";
import { encryptSecret } from "@/lib/secret-box";
import { telegramApi, telegramConfig, type TelegramUser } from "@/lib/telegram";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Geçersiz istek kaynağı." }, { status: 403 });
  }
  const actor = await requireAdmin(request);
  if (actor instanceof Response) return actor;

  const { botToken } = telegramConfig();
  if (!botToken) {
    return Response.json({ error: "TELEGRAM_BOT_TOKEN ortam değişkeni ayarlı değil." }, { status: 400 });
  }

  await ensureSchema();
  const db = getDb();

  let botUser: TelegramUser;
  try {
    botUser = await telegramApi<TelegramUser>("getMe", {}, { botToken });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Bot token'ı doğrulanamadı." },
      { status: 400 },
    );
  }
  if (botUser.id === undefined) {
    return Response.json({ error: "Bot token'ı doğrulanamadı." }, { status: 400 });
  }

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
      label: "Ortam değişkeninden içe aktarılan bot",
      telegramBotId,
      username: botUser.username ?? null,
      displayName: botUser.first_name ?? null,
      tokenCiphertext: encryptSecret(botToken),
      tokenLastFour: botToken.slice(-4),
      lastValidatedAt: now,
    })
    .returning();

  const legacyFilter = and(
    eq(conversations.connectionId, BOT_GROUP_CONNECTION_ID),
    isNull(conversations.botId),
  );
  const legacyConversations = await db
    .select({ telegramChatId: conversations.telegramChatId, title: conversations.title })
    .from(conversations)
    .where(legacyFilter);

  await db
    .update(conversations)
    .set({ botId: bot.id, updatedAt: now })
    .where(legacyFilter);

  const seenChatIds = new Set<string>();
  for (const legacy of legacyConversations) {
    if (seenChatIds.has(legacy.telegramChatId)) continue;
    seenChatIds.add(legacy.telegramChatId);
    await db
      .insert(botGroupAssignments)
      .values({
        botId: bot.id,
        telegramChatId: legacy.telegramChatId,
        title: legacy.title,
        source: "manual",
      })
      .onConflictDoNothing();
  }

  await db.insert(auditLogs).values({
    actorEmail: actor.email,
    action: "bot_adopted_from_env",
    detail: JSON.stringify({
      botId: bot.id,
      telegramBotId,
      username: botUser.username,
      migratedChatCount: seenChatIds.size,
    }),
  });

  return Response.json({
    bot: { id: bot.id, label: bot.label, username: bot.username, tokenLastFour: bot.tokenLastFour },
    migratedChatCount: seenChatIds.size,
  });
}
