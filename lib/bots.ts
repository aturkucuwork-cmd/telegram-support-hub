import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { bots, conversations } from "@/db/schema";
import { decryptSecret } from "@/lib/secret-box";

export function botGroupConnectionId(botId: number): string {
  return `__telegram_bot_group__${botId}`;
}

export async function resolveBotForConversation(
  conversation: typeof conversations.$inferSelect,
): Promise<{ id: number; token: string } | null> {
  if (conversation.botId === null || conversation.botId === undefined) return null;
  const [bot] = await getDb()
    .select()
    .from(bots)
    .where(eq(bots.id, conversation.botId))
    .limit(1);
  if (!bot || !bot.isEnabled) return null;
  return { id: bot.id, token: decryptSecret(bot.tokenCiphertext) };
}

/** Moves every conversation already tied to a chat's previous bot over to its newly assigned bot. */
export async function reassignConversationBot(params: {
  telegramChatId: string;
  fromBotId: number | null;
  toBotId: number;
}): Promise<void> {
  if (params.fromBotId === null || params.fromBotId === params.toBotId) return;
  await getDb()
    .update(conversations)
    .set({
      connectionId: botGroupConnectionId(params.toBotId),
      botId: params.toBotId,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(conversations.connectionId, botGroupConnectionId(params.fromBotId)),
        eq(conversations.telegramChatId, params.telegramChatId),
      ),
    );
}
