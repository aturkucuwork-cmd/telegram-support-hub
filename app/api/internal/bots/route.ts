import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { bots } from "@/db/schema";
import { requireInternalApi } from "@/lib/internal-api";
import { decryptSecret } from "@/lib/secret-box";

export async function GET(request: Request) {
  const authorization = requireInternalApi(request);
  if (authorization) return authorization;

  await ensureSchema();
  const rows = await getDb()
    .select({ id: bots.id, tokenCiphertext: bots.tokenCiphertext })
    .from(bots)
    .where(eq(bots.isEnabled, true));

  return Response.json({
    bots: rows.map((bot) => ({ id: bot.id, token: decryptSecret(bot.tokenCiphertext) })),
  });
}
