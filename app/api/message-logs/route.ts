import { ensureSchema } from "@/db/ensure";
import { requireAdmin } from "@/lib/auth";
import {
  listMessageLogs,
  listMessageLogUsers,
  MESSAGE_LOG_PAGE_SIZE,
  MESSAGE_LOG_RETENTION_DAYS,
  pruneExpiredMessageLogs,
} from "@/lib/message-logs";

export async function GET(request: Request) {
  const actor = await requireAdmin(request);
  if (actor instanceof Response) return actor;

  await ensureSchema();
  await pruneExpiredMessageLogs();
  const url = new URL(request.url);
  const requestedPage = Number(url.searchParams.get("page") || 1);
  const page =
    Number.isInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, 10_000)
      : 1;
  const query = (url.searchParams.get("q") || "").trim().slice(0, 120);
  const actorEmail = (url.searchParams.get("actor_email") || "")
    .trim()
    .toLowerCase()
    .slice(0, 254);
  const [users, result] = await Promise.all([
    listMessageLogUsers(),
    actorEmail
      ? listMessageLogs({ page, query, actorEmail })
      : Promise.resolve({ logs: [], total: 0 }),
  ]);

  return Response.json({
    ...result,
    users,
    selectedActorEmail: actorEmail || null,
    page,
    pageSize: MESSAGE_LOG_PAGE_SIZE,
    retentionDays: MESSAGE_LOG_RETENTION_DAYS,
  });
}
