import { requireActor } from "@/lib/auth";
import { telegramApi, telegramConfig } from "@/lib/telegram";

export async function GET(request: Request) {
  const actor = await requireActor(request);
  if (actor instanceof Response) return actor;

  const fileId = new URL(request.url).searchParams.get("file_id")?.trim();
  if (!fileId) return Response.json({ error: "Dosya kimliği eksik." }, { status: 400 });

  try {
    const file = await telegramApi<{ file_path?: string }>("getFile", {
      file_id: fileId,
    });
    const { botToken } = telegramConfig();
    if (!file.file_path || !botToken) throw new Error("Dosya yolu alınamadı.");

    const upstream = await fetch(
      `https://api.telegram.org/file/bot${botToken}/${file.file_path}`,
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
