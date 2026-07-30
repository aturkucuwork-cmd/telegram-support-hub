import {
  and,
  count,
  desc,
  gte,
  like,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { getDb } from "@/db";
import { messageLogs } from "@/db/schema";

export const MESSAGE_LOG_RETENTION_DAYS = 30;
export const MESSAGE_LOG_PAGE_SIZE = 100;

const retentionCutoff = sql<string>`datetime('now', '-30 days')`;
const normalizedSentAt = sql<string>`datetime(${messageLogs.sentAt})`;

export async function pruneExpiredMessageLogs(): Promise<void> {
  await getDb()
    .delete(messageLogs)
    .where(lt(normalizedSentAt, retentionCutoff));
}

export async function listMessageLogs(options: {
  page: number;
  query: string;
}) {
  const search = options.query.trim();
  const retentionFilter = gte(normalizedSentAt, retentionCutoff);
  const where = search
    ? and(
        retentionFilter,
        or(
          like(messageLogs.actorDisplayName, `%${search}%`),
          like(messageLogs.actorEmail, `%${search}%`),
          like(messageLogs.conversationTitle, `%${search}%`),
          like(messageLogs.messageText, `%${search}%`),
        ),
      )
    : retentionFilter;
  const db = getDb();
  const [logs, totals] = await Promise.all([
    db
      .select()
      .from(messageLogs)
      .where(where)
      .orderBy(desc(normalizedSentAt), desc(messageLogs.id))
      .limit(MESSAGE_LOG_PAGE_SIZE)
      .offset((options.page - 1) * MESSAGE_LOG_PAGE_SIZE),
    db.select({ total: count() }).from(messageLogs).where(where),
  ]);
  return { logs, total: totals[0]?.total ?? 0 };
}
