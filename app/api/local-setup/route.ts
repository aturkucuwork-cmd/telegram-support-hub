import { env } from "cloudflare:workers";
import { requireAdmin } from "@/lib/auth";

function runtimeValue(name: string): string | undefined {
  return (env as unknown as Record<string, string | undefined>)[name]?.trim();
}

export async function GET(request: Request) {
  const actor = await requireAdmin(request);
  if (actor instanceof Response) return actor;

  const token = runtimeValue("LOCAL_SETUP_TOKEN");
  const hostname = new URL(request.url).hostname;
  const onHost = hostname === "localhost" || hostname === "127.0.0.1";

  return Response.json({
    available: Boolean(token) && onHost,
    onHost,
    bridgeUrl: "http://127.0.0.1:8765",
    token: onHost ? token ?? null : null,
  });
}
