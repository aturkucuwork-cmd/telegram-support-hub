import { requireActor } from "@/lib/auth";
import { telegramApi, telegramConfig } from "@/lib/telegram";

export async function POST(request: Request) {
  const actor = await requireActor(request);
  if (actor instanceof Response) return actor;

  const config = telegramConfig();
  if (!config.botToken || !config.webhookSecret) {
    return Response.json(
      { error: "Önce bot token ve webhook gizli anahtarı ayarlanmalı." },
      { status: 409 },
    );
  }

  const origin = new URL(request.url).origin;
  await telegramApi<boolean>("setWebhook", {
    url: `${origin}/api/telegram/webhook`,
    secret_token: config.webhookSecret,
    allowed_updates: [
      "business_connection",
      "business_message",
      "edited_business_message",
      "deleted_business_messages",
      "message",
      "edited_message",
      "channel_post",
      "edited_channel_post",
    ],
    drop_pending_updates: false,
  });

  return Response.json({ ok: true });
}
