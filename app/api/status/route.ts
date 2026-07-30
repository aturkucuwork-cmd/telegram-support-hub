import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { telegramConnections } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import {
  telegramApi,
  telegramConfig,
  type TelegramUser,
} from "@/lib/telegram";

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

export async function GET(request: Request) {
  const actor = await requireActor(request);
  if (actor instanceof Response) return actor;

  await ensureSchema();
  const [connection] = await getDb()
    .select()
    .from(telegramConnections)
    .orderBy(desc(telegramConnections.updatedAt))
    .limit(1);
  const config = telegramConfig();
  const configured = Boolean(config.botToken && config.webhookSecret);
  const groupMessageAccess = await getGroupMessageAccess(configured);
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const isLocal =
    requestUrl.port === "3000" ||
    requestUrl.hostname === "localhost" ||
    requestUrl.hostname === "127.0.0.1";

  return Response.json({
    configured,
    connected: Boolean(connection?.isEnabled),
    connection: connection ?? null,
    deliveryMode: isLocal ? "polling" : "webhook",
    webhookUrl: `${origin}/api/telegram/webhook`,
    groupMessageAccess,
    actor,
  });
}
