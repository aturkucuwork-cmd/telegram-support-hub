import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { telegramUserListeners } from "@/db/schema";
import { telegramConfig } from "@/lib/telegram";

type HeartbeatBody = {
  telegramUserId?: unknown;
  displayName?: unknown;
  username?: unknown;
};

export async function POST(request: Request) {
  const { webhookSecret } = telegramConfig();
  if (!webhookSecret) {
    return Response.json({ error: "Telegram henüz yapılandırılmadı." }, { status: 503 });
  }
  if (
    request.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret
  ) {
    return Response.json({ error: "Geçersiz dinleyici imzası." }, { status: 401 });
  }

  const body = (await request.json()) as HeartbeatBody;
  if (
    typeof body.telegramUserId !== "string" ||
    !/^\d+$/.test(body.telegramUserId) ||
    typeof body.displayName !== "string" ||
    body.displayName.trim().length < 1 ||
    body.displayName.length > 160 ||
    (body.username !== null &&
      body.username !== undefined &&
      (typeof body.username !== "string" || body.username.length > 64))
  ) {
    return Response.json({ error: "Geçersiz dinleyici bilgisi." }, { status: 400 });
  }

  await ensureSchema();
  const now = new Date().toISOString();
  const values = {
    telegramUserId: body.telegramUserId,
    displayName: body.displayName.trim(),
    username: typeof body.username === "string" ? body.username || null : null,
    isEnabled: true,
    lastHeartbeatAt: now,
    updatedAt: now,
  };

  await getDb()
    .insert(telegramUserListeners)
    .values({ id: "local-user", ...values })
    .onConflictDoUpdate({
      target: telegramUserListeners.id,
      set: values,
    });

  const [listener] = await getDb()
    .select()
    .from(telegramUserListeners)
    .where(eq(telegramUserListeners.id, "local-user"))
    .limit(1);

  return Response.json({ ok: true, listener });
}
