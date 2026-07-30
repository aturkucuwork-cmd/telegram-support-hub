import { ensureSchema } from "@/db/ensure";
import {
  BOT_GROUP_CONNECTION_ID,
  storeTelegramMessage,
} from "@/lib/store-telegram";
import {
  telegramConfig,
  type TelegramMessage,
} from "@/lib/telegram";

type ImportItem = {
  source: "business" | "group";
  outgoing: boolean;
  message: TelegramMessage;
};

function isValidItem(value: unknown): value is ImportItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ImportItem>;
  const message = item.message;
  return (
    (item.source === "business" || item.source === "group") &&
    typeof item.outgoing === "boolean" &&
    Boolean(message) &&
    Number.isInteger(message?.message_id) &&
    Number.isInteger(message?.date) &&
    typeof message?.chat?.id === "number" &&
    ["private", "group", "supergroup"].includes(message?.chat?.type ?? "") &&
    (item.source !== "business" || Boolean(message?.business_connection_id))
  );
}

export async function POST(request: Request) {
  const { webhookSecret } = telegramConfig();
  if (!webhookSecret) {
    return Response.json({ error: "Telegram henüz yapılandırılmadı." }, { status: 503 });
  }
  if (
    request.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret
  ) {
    return Response.json({ error: "Geçersiz içe aktarma imzası." }, { status: 401 });
  }

  const body = (await request.json()) as { items?: unknown[] };
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 250) {
    return Response.json(
      { error: "Her istekte 1-250 mesaj gönderilmelidir." },
      { status: 400 },
    );
  }
  if (!body.items.every(isValidItem)) {
    return Response.json({ error: "Geçersiz geçmiş mesajı." }, { status: 400 });
  }

  await ensureSchema();
  for (const item of body.items) {
    await storeTelegramMessage({
      message: item.message,
      connectionId:
        item.source === "group" ? BOT_GROUP_CONNECTION_ID : undefined,
      outgoing: item.outgoing,
      historical: true,
    });
  }

  return Response.json({ ok: true, imported: body.items.length });
}
