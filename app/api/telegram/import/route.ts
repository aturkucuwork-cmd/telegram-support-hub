import { ensureSchema } from "@/db/ensure";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  BOT_GROUP_CONNECTION_ID,
  MT_PROTO_USER_CONNECTION_ID,
  storeTelegramMessage,
} from "@/lib/store-telegram";
import { requireInternalApi } from "@/lib/internal-api";
import { type TelegramMessage } from "@/lib/telegram";

type ImportItem = {
  source: "business" | "group" | "user";
  outgoing: boolean;
  historical?: boolean;
  edited?: boolean;
  message: TelegramMessage;
};

function isValidItem(value: unknown): value is ImportItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ImportItem>;
  const message = item.message;
  return (
    (item.source === "business" || item.source === "group" || item.source === "user") &&
    typeof item.outgoing === "boolean" &&
    (item.historical === undefined || typeof item.historical === "boolean") &&
    (item.edited === undefined || typeof item.edited === "boolean") &&
    Boolean(message) &&
    Number.isInteger(message?.message_id) &&
    Number.isInteger(message?.date) &&
    typeof message?.chat?.id === "number" &&
    ["private", "group", "supergroup", "channel"].includes(message?.chat?.type ?? "") &&
    (message?.chat?.type !== "private" || message?.chat?.is_bot !== true) &&
    (item.source !== "business" || Boolean(message?.business_connection_id))
  );
}

export async function GET(request: Request) {
  const authorization = requireInternalApi(request);
  if (authorization) return authorization;

  await ensureSchema();
  const connectionId = new URL(request.url).searchParams.get("connectionId") || BOT_GROUP_CONNECTION_ID;
  if (![BOT_GROUP_CONNECTION_ID, MT_PROTO_USER_CONNECTION_ID].includes(connectionId)) {
    return Response.json({ error: "Geçersiz bağlantı." }, { status: 400 });
  }
  const rows = await getDb()
    .select({
      chatId: conversations.telegramChatId,
      messageId: sql<number>`max(CAST(${messages.telegramMessageId} AS INTEGER))`,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(eq(conversations.connectionId, connectionId))
    .groupBy(conversations.telegramChatId);

  return Response.json({
    cursors: Object.fromEntries(
      rows
        .filter((row) => row.messageId !== null)
        .map((row) => [row.chatId, Number(row.messageId)]),
    ),
  });
}

export async function POST(request: Request) {
  const authorization = requireInternalApi(request);
  if (authorization) return authorization;

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
        item.source === "group"
          ? BOT_GROUP_CONNECTION_ID
          : item.source === "user"
            ? MT_PROTO_USER_CONNECTION_ID
            : undefined,
      outgoing: item.outgoing,
      historical: item.historical ?? true,
      edited: item.edited ?? false,
    });
  }

  return Response.json({ ok: true, imported: body.items.length });
}
