import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { agents, agentSessions } from "@/db/schema";
import {
  isSameOriginRequest,
  requireAdmin,
  validateAccountInput,
} from "@/lib/auth";
import { createPasswordHash } from "@/lib/password";

const publicFields = {
  id: agents.id,
  email: agents.email,
  displayName: agents.displayName,
  role: agents.role,
  isActive: agents.isActive,
  createdAt: agents.createdAt,
  lastSeenAt: agents.lastSeenAt,
};

export async function GET(request: Request) {
  const actor = await requireAdmin(request);
  if (actor instanceof Response) return actor;
  const users = await getDb().select(publicFields).from(agents).orderBy(asc(agents.displayName));
  return Response.json({ users });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Geçersiz istek kaynağı." }, { status: 403 });
  }
  const actor = await requireAdmin(request);
  if (actor instanceof Response) return actor;
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const account = validateAccountInput(payload);
  if (account instanceof Response) return account;
  const role = payload.role === "admin" ? "admin" : "agent";
  const db = getDb();
  const existing = await db.select({ id: agents.id }).from(agents).where(eq(agents.email, account.email)).limit(1);
  if (existing.length) {
    return Response.json({ error: "Bu e-posta adresi zaten kayıtlı." }, { status: 409 });
  }
  const password = await createPasswordHash(account.password);
  const [user] = await db
    .insert(agents)
    .values({
      email: account.email,
      displayName: account.displayName,
      role,
      passwordHash: password.hash,
      passwordSalt: password.salt,
    })
    .returning(publicFields);
  return Response.json({ user }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Geçersiz istek kaynağı." }, { status: 403 });
  }
  const actor = await requireAdmin(request);
  if (actor instanceof Response) return actor;
  const payload = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    displayName?: unknown;
    role?: unknown;
    isActive?: unknown;
    password?: unknown;
  };
  if (!Number.isInteger(payload.id)) {
    return Response.json({ error: "Geçersiz kullanıcı." }, { status: 400 });
  }
  const id = payload.id as number;
  if (id === actor.id && (payload.isActive === false || payload.role === "agent")) {
    return Response.json({ error: "Kendi yönetici hesabınızı devre dışı bırakamazsınız." }, { status: 400 });
  }
  const changes: Partial<typeof agents.$inferInsert> = {};
  if (typeof payload.displayName === "string") {
    const displayName = payload.displayName.trim();
    if (displayName.length < 2 || displayName.length > 80) {
      return Response.json({ error: "Ad soyad 2-80 karakter olmalıdır." }, { status: 400 });
    }
    changes.displayName = displayName;
  }
  if (payload.role !== undefined) {
    if (payload.role !== "admin" && payload.role !== "agent") {
      return Response.json({ error: "Geçersiz kullanıcı rolü." }, { status: 400 });
    }
    changes.role = payload.role;
  }
  if (typeof payload.isActive === "boolean") changes.isActive = payload.isActive;
  if (typeof payload.password === "string" && payload.password.length) {
    if (payload.password.length < 8 || payload.password.length > 128) {
      return Response.json({ error: "Parola en az 8 karakter olmalıdır." }, { status: 400 });
    }
    const password = await createPasswordHash(payload.password);
    changes.passwordHash = password.hash;
    changes.passwordSalt = password.salt;
  }
  if (!Object.keys(changes).length) {
    return Response.json({ error: "Güncellenecek alan bulunamadı." }, { status: 400 });
  }
  await ensureSchema();
  const db = getDb();
  const [user] = await db.update(agents).set(changes).where(eq(agents.id, id)).returning(publicFields);
  if (!user) return Response.json({ error: "Kullanıcı bulunamadı." }, { status: 404 });
  if (changes.isActive === false || changes.passwordHash) {
    await db.delete(agentSessions).where(eq(agentSessions.agentId, id));
  }
  return Response.json({ user });
}
