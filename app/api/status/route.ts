import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { telegramConnections } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { telegramConfig } from "@/lib/telegram";

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
  const origin = new URL(request.url).origin;

  return Response.json({
    configured: Boolean(config.botToken && config.webhookSecret),
    connected: Boolean(connection?.isEnabled),
    connection: connection ?? null,
    webhookUrl: `${origin}/api/telegram/webhook`,
    actor,
  });
}
