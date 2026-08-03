import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { agents } from "@/db/schema";
import {
  clearLoginFailures,
  createSession,
  isSameOriginRequest,
  loginLockState,
  recordLoginFailure,
  sessionCookie,
} from "@/lib/auth";
import { verifyPassword } from "@/lib/password";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Geçersiz istek kaynağı." }, { status: 403 });
  }
  const payload = (await request.json().catch(() => ({}))) as {
    email?: unknown;
    password?: unknown;
  };
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!email || !password) {
    return Response.json({ error: "E-posta ve parola gereklidir." }, { status: 400 });
  }
  const lock = loginLockState(request, email);
  if (lock) {
    return Response.json(
      { error: "Çok fazla başarısız giriş denemesi. Daha sonra tekrar deneyin." },
      { status: 429, headers: { "Retry-After": String(lock.retryAfter) } },
    );
  }
  await ensureSchema();
  const [agent] = await getDb().select().from(agents).where(eq(agents.email, email)).limit(1);
  const valid = Boolean(
    agent?.isActive &&
      agent.passwordHash &&
      agent.passwordSalt &&
      (await verifyPassword(password, agent.passwordHash, agent.passwordSalt)),
  );
  if (!valid || !agent) {
    recordLoginFailure(request, email);
    return Response.json({ error: "E-posta veya parola hatalı." }, { status: 401 });
  }
  clearLoginFailures(request, email);
  const token = await createSession(agent.id);
  return Response.json(
    {
      actor: {
        id: agent.id,
        email: agent.email,
        displayName: agent.displayName,
        role: agent.role === "admin" ? "admin" : "agent",
      },
    },
    { headers: { "Set-Cookie": sessionCookie(request, token) } },
  );
}
