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
const TRUSTED_HOSTING_ADAPTER = "RELAYDESK_TRUSTED_HOSTING_ADAPTER";
const TRUST_PROXY = "RELAYDESK_TRUST_PROXY";
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 10 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;

type LoginAttempt = { failures: number; firstFailureAt: number; lockedUntil: number };
const loginAttempts = new Map<string, LoginAttempt>();

function safeDecode(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function runtimeValue(name: string): string | undefined {
  return process.env[name];
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
  const fallback = request.headers.get("referer");
  const candidate = origin || fallback;
  if (!candidate) return false;
  try {
    return new URL(candidate).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function trustedHostingAdapterEnabled(): boolean {
  return ["1", "true", "yes"].includes(
    runtimeValue(TRUSTED_HOSTING_ADAPTER)?.trim().toLowerCase() ?? "",
  );
}

function clientAddress(request: Request): string {
  if (!["1", "true", "yes"].includes(runtimeValue(TRUST_PROXY)?.trim().toLowerCase() ?? "")) {
    return "direct-client";
  }
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = request.headers.get("x-real-ip")?.trim();
  return forwarded || real || "unknown-proxy-client";
}

function loginKey(request: Request, email: string): string {
  return `${clientAddress(request)}:${email}`;
}

function pruneLoginAttempts(now: number): void {
  for (const [key, attempt] of loginAttempts) {
    if (attempt.lockedUntil <= now && now - attempt.firstFailureAt > LOGIN_WINDOW_MS) {
      loginAttempts.delete(key);
    }
  }
}

export function loginLockState(request: Request, email: string): { retryAfter: number } | null {
  const now = Date.now();
  pruneLoginAttempts(now);
  const attempt = loginAttempts.get(loginKey(request, email));
  if (!attempt || attempt.lockedUntil <= now) return null;
  return { retryAfter: Math.max(1, Math.ceil((attempt.lockedUntil - now) / 1000)) };
}

export function recordLoginFailure(request: Request, email: string): void {
  const now = Date.now();
  pruneLoginAttempts(now);
  const key = loginKey(request, email);
  const previous = loginAttempts.get(key);
  const attempt =
    previous && now - previous.firstFailureAt <= LOGIN_WINDOW_MS
      ? previous
      : { failures: 0, firstFailureAt: now, lockedUntil: 0 };
  attempt.failures += 1;
  if (attempt.failures >= MAX_LOGIN_FAILURES) attempt.lockedUntil = now + LOGIN_LOCKOUT_MS;
  loginAttempts.set(key, attempt);
}

export function clearLoginFailures(request: Request, email: string): void {
  loginAttempts.delete(loginKey(request, email));
}

export function resetLoginRateLimitForTests(): void {
  loginAttempts.clear();
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
  const sessionActor = await actorFromSession(request);
  if (sessionActor) return sessionActor;
  return trustedHostingAdapterEnabled() ? actorFromWorkspace(request) : null;
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
