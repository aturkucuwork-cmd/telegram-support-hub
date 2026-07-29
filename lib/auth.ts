import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { agents } from "@/db/schema";

export type Actor = {
  email: string;
  displayName: string;
};

const EMAIL_HEADER = "oai-authenticated-user-email";
const NAME_HEADER = "oai-authenticated-user-full-name";
const NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";

function safeDecode(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function runtimeValue(name: string): string | undefined {
  return (env as unknown as Record<string, string | undefined>)[name];
}

export async function getActor(request: Request): Promise<Actor | null> {
  const email = request.headers.get(EMAIL_HEADER)?.trim().toLowerCase();
  const hostname = new URL(request.url).hostname;
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1";

  const actor: Actor | null = email
    ? {
        email,
        displayName:
          request.headers.get(NAME_ENCODING_HEADER) === "percent-encoded-utf-8"
            ? safeDecode(request.headers.get(NAME_HEADER)) ?? email
            : email,
      }
    : isLocal
      ? { email: "demo@relaydesk.local", displayName: "Demo Destek" }
      : null;

  if (!actor) return null;

  const allowlist = runtimeValue("SUPPORT_ALLOWED_EMAILS")
    ?.split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (allowlist?.length && !allowlist.includes(actor.email)) return null;

  await ensureSchema();
  const db = getDb();
  const existing = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.email, actor.email))
    .limit(1);

  if (existing.length) {
    await db
      .update(agents)
      .set({ displayName: actor.displayName, lastSeenAt: new Date().toISOString() })
      .where(eq(agents.email, actor.email));
  } else {
    await db.insert(agents).values({
      email: actor.email,
      displayName: actor.displayName,
    });
  }

  return actor;
}

export async function requireActor(request: Request): Promise<Actor | Response> {
  const actor = await getActor(request);
  if (!actor) {
    return Response.json(
      { error: "Bu alanı görmek için yetkili hesapla giriş yapmalısınız." },
      { status: 401 },
    );
  }
  return actor;
}
