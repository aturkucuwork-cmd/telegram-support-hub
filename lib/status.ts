import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { telegramConnections, telegramUserListeners } from "@/db/schema";
import { telegramApi, telegramConfig, type TelegramUser } from "@/lib/telegram";
import type { Actor } from "@/lib/auth";

type GroupMessageAccess = "all" | "limited" | "unknown";

let groupAccessCache:
  | { value: GroupMessageAccess; expiresAt: number }
  | null = null;

async function getGroupMessageAccess(configured: boolean): Promise<GroupMessageAccess> {
  if (!configured) return "unknown";
  if (groupAccessCache && groupAccessCache.expiresAt > Date.now()) {
    return groupAccessCache.value;
  }
  let value: GroupMessageAccess = "unknown";
  try {
    const bot = await telegramApi<TelegramUser>("getMe", {}, {
      signal: AbortSignal.timeout(4_000),
    });
    value = bot.can_read_all_group_messages ? "all" : "limited";
  } catch {
    // Telegram kısa süreli ulaşılamazsa panelin kalanını çalışır tut.
  }
  groupAccessCache = { value, expiresAt: Date.now() + 60_000 };
  return value;
}

export async function getRelayDeskStatus(
  request: Request,
  actor: Actor | null,
) {
  await ensureSchema();
  const [connection] = await getDb()
    .select()
    .from(telegramConnections)
    .orderBy(desc(telegramConnections.updatedAt))
    .limit(1);
  const [userListener] = await getDb()
    .select()
    .from(telegramUserListeners)
    .orderBy(desc(telegramUserListeners.lastHeartbeatAt))
    .limit(1);
  const config = telegramConfig();
  const configured = Boolean(config.botToken && config.webhookSecret);
  const groupMessageAccess = await getGroupMessageAccess(configured);
  const userListenerConnected = Boolean(
    userListener?.isEnabled &&
      Date.parse(userListener.lastHeartbeatAt) > Date.now() - 90_000,
  );
  const requestUrl = new URL(request.url);
  const isLocal =
    requestUrl.port === "3000" ||
    requestUrl.hostname === "localhost" ||
    requestUrl.hostname === "127.0.0.1" ||
    requestUrl.hostname === "::1";

  return {
    configured,
    connected: Boolean(connection?.isEnabled),
    connection: connection ?? null,
    deliveryMode: isLocal ? "polling" : "webhook",
    webhookUrl: `${requestUrl.origin}/api/telegram/webhook`,
    groupMessageAccess,
    userGroupListener: {
      connected: userListenerConnected,
      displayName: userListener?.displayName ?? null,
      username: userListener?.username ?? null,
      lastHeartbeatAt: userListener?.lastHeartbeatAt ?? null,
    },
    actor,
  };
}
