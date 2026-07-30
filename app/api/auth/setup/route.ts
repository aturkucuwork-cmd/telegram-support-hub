import { eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { agents } from "@/db/schema";
import {
  createSession,
  isSameOriginRequest,
  sessionCookie,
  validateAccountInput,
} from "@/lib/auth";
import { createPasswordHash } from "@/lib/password";

async function needsSetup(): Promise<boolean> {
  await ensureSchema();
  const existing = await getDb()
    .select({ id: agents.id })
    .from(agents)
    .where(isNotNull(agents.passwordHash))
    .limit(1);
  return existing.length === 0;
}

export async function GET() {
  return Response.json({ needsSetup: await needsSetup() });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Geçersiz istek kaynağı." }, { status: 403 });
  }
  const hostname = new URL(request.url).hostname;
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    return Response.json(
      { error: "İlk yönetici hesabını RelayDesk'in çalıştığı bilgisayardan oluşturun." },
      { status: 403 },
    );
  }
  if (!(await needsSetup())) {
    return Response.json({ error: "İlk yönetici hesabı zaten oluşturulmuş." }, { status: 409 });
  }
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const account = validateAccountInput(payload);
  if (account instanceof Response) return account;
  const password = await createPasswordHash(account.password);
  const db = getDb();
  const [existing] = await db.select().from(agents).where(eq(agents.email, account.email)).limit(1);
  const [agent] = existing
    ? await db
        .update(agents)
        .set({
          displayName: account.displayName,
          role: "admin",
          passwordHash: password.hash,
          passwordSalt: password.salt,
          isActive: true,
          lastSeenAt: new Date().toISOString(),
        })
        .where(eq(agents.id, existing.id))
        .returning()
    : await db
        .insert(agents)
        .values({
          email: account.email,
          displayName: account.displayName,
          role: "admin",
          passwordHash: password.hash,
          passwordSalt: password.salt,
        })
        .returning();
  const token = await createSession(agent.id);
  return Response.json(
    { actor: { id: agent.id, email: agent.email, displayName: agent.displayName, role: "admin" } },
    { headers: { "Set-Cookie": sessionCookie(request, token) } },
  );
}
