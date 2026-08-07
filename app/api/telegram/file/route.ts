import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { conversations } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { resolveBotForConversation } from "@/lib/bots";
import { telegramApi, telegramConfig } from "@/lib/telegram";

export async function GET(request: Request) {
  const actor = await requireActor(request);
  if (actor instanceof Response) return actor;

  const url = new URL(request.url);
  const fileId = url.searchParams.get("file_id")?.trim();
  if (!fileId) return Response.json({ error: "Dosya kimliği eksik." }, { status: 400 });

  const conversationIdParam = url.searchParams.get("conversation_id");
  let botToken: string | undefined;
  if (conversationIdParam) {
    const conversationId = Number(conversationIdParam);
    if (!Number.isInteger(conversationId)) {
      return Response.json({ error: "Geçersiz konuşma." }, { status: 400 });
    }
    await ensureSchema();
    const [conversation] = await getDb()
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (conversation?.botId !== null && conversation?.botId !== undefined) {
      const bot = await resolveBotForConversation(conversation);
      if (!bot) {
        return Response.json({ error: "Bu grup için etkin bir bot atanmamış." }, { status: 409 });
      }
      botToken = bot.token;
    }
  }

  try {
    const file = await telegramApi<{ file_path?: string }>(
      "getFile",
      { file_id: fileId },
      { botToken },
    );
    const resolvedToken = botToken ?? telegramConfig().botToken;
    if (!file.file_path || !resolvedToken) throw new Error("Dosya yolu alınamadı.");

    const upstream = await fetch(
      `https://api.telegram.org/file/bot${resolvedToken}/${file.file_path}`,
    );
    if (!upstream.ok || !upstream.body) throw new Error("Dosya indirilemedi.");
    return new Response(upstream.body, {
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/octet-stream",
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Dosya indirilemedi." },
      { status: 502 },
    );
  }
}
