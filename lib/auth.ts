import { env } from "cloudflare:workers";
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { agents, agentSessions } from "@/db/schema";
import { hashSessionToken, randomSessionToken } from "@/lib/password";

export type Actor = {
  id: number;
  email: string;
  displayName: string;
  role: "admin" | "agent";
};

export const SESSION_COOKIE = "relaydesk_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
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

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === name) {
      return cookie.slice(separator + 1).trim();
    }
  }
  return null;
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function validateAccountInput(input: {
  email?: unknown;
  displayName?: unknown;
  password?: unknown;
}): { email: string; displayName: string; password: string } | Response {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Geçerli bir e-posta adresi girin." }, { status: 400 });
  }
  if (displayName.length < 2 || displayName.length > 80) {
    return Response.json({ error: "Ad soyad 2-80 karakter olmalıdır." }, { status: 400 });
  }
  if (password.length < 8 || password.length > 128) {
    return Response.json({ error: "Parola en az 8 karakter olmalıdır." }, { status: 400 });
  }
  return { email, displayName, password };
}

async function actorFromSession(request: Request): Promise<Actor | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await hashSessionToken(token);
  const [row] = await getDb()
    .select({
      id: agents.id,
      email: agents.email,
      displayName: agents.displayName,
      role: agents.role,
      lastSeenAt: agents.lastSeenAt,
    })
    .from(agentSessions)
    .innerJoin(agents, eq(agentSessions.agentId, agents.id))
    .where(
      and(
        eq(agentSessions.tokenHash, tokenHash),
        gt(agentSessions.expiresAt, new Date().toISOString()),
        eq(agents.isActive, true),
      ),
    )
    .limit(1);
  if (!row) return null;

  if (Date.now() - new Date(row.lastSeenAt).getTime() > 5 * 60 * 1000) {
    await getDb()
      .update(agents)
      .set({ lastSeenAt: new Date().toISOString() })
      .where(eq(agents.id, row.id));
  }
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role === "admin" ? "admin" : "agent",
  };
}

async function actorFromWorkspace(request: Request): Promise<Actor | null> {
  const email = request.headers.get(EMAIL_HEADER)?.trim().toLowerCase();
  if (!email) return null;
  const displayName =
    request.headers.get(NAME_ENCODING_HEADER) === "percent-encoded-utf-8"
      ? safeDecode(request.headers.get(NAME_HEADER)) ?? email
      : email;
  const allowlist = runtimeValue("SUPPORT_ALLOWED_EMAILS")
    ?.split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist?.length && !allowlist.includes(email)) return null;

  const [existing] = await getDb().select().from(agents).where(eq(agents.email, email)).limit(1);
  if (existing && !existing.isActive) return null;
  if (existing) {
    await getDb()
      .update(agents)
      .set({ displayName, lastSeenAt: new Date().toISOString() })
      .where(eq(agents.id, existing.id));
    return {
      id: existing.id,
      email,
      displayName,
      role: existing.role === "admin" ? "admin" : "agent",
    };
  }
  const [created] = await getDb()
    .insert(agents)
    .values({ email, displayName })
    .returning();
  return { id: created.id, email, displayName, role: "agent" };
}

export async function getActor(request: Request): Promise<Actor | null> {
  await ensureSchema();
  return (await actorFromSession(request)) ?? actorFromWorkspace(request);
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

export async function requireAdmin(request: Request): Promise<Actor | Response> {
  const actor = await requireActor(request);
  if (actor instanceof Response) return actor;
  if (actor.role !== "admin") {
    return Response.json({ error: "Bu işlem için yönetici yetkisi gerekir." }, { status: 403 });
  }
  return actor;
}

export async function createSession(agentId: number): Promise<string> {
  const token = randomSessionToken();
  const tokenHash = await hashSessionToken(token);
  const now = new Date();
  await getDb()
    .delete(agentSessions)
    .where(lt(agentSessions.expiresAt, new Date().toISOString()));
  await getDb().insert(agentSessions).values({
    tokenHash,
    agentId,
    expiresAt: new Date(now.getTime() + SESSION_MAX_AGE * 1000).toISOString(),
  });
  return token;
}

export async function deleteSession(request: Request): Promise<void> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return;
  await ensureSchema();
  await getDb().delete(agentSessions).where(eq(agentSessions.tokenHash, await hashSessionToken(token)));
}

export function sessionCookie(request: Request, token: string): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure}`;
}

export function clearSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
