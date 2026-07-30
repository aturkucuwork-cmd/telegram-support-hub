import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  like,
  lt,
  max,
  or,
  sql,
} from "drizzle-orm";
import { getDb } from "@/db";
import { agents, messageLogs } from "@/db/schema";

export const MESSAGE_LOG_RETENTION_DAYS = 30;
export const MESSAGE_LOG_PAGE_SIZE = 250;

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
  actorEmail: string;
}) {
  const search = options.query.trim();
  const retentionFilter = gte(normalizedSentAt, retentionCutoff);
  const searchFilter = search
    ? or(
        like(messageLogs.conversationTitle, `%${search}%`),
        like(messageLogs.messageText, `%${search}%`),
      )
    : undefined;
  const where = and(
    retentionFilter,
    eq(messageLogs.actorEmail, options.actorEmail),
    searchFilter,
  );
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

export async function listMessageLogUsers() {
  const db = getDb();
  const [users, activity] = await Promise.all([
    db
      .select({
        id: agents.id,
        email: agents.email,
        displayName: agents.displayName,
        role: agents.role,
        isActive: agents.isActive,
      })
      .from(agents)
      .orderBy(asc(agents.displayName)),
    db
      .select({
        actorEmail: messageLogs.actorEmail,
        messageCount: count(),
        lastMessageAt: max(messageLogs.sentAt),
      })
      .from(messageLogs)
      .where(gte(normalizedSentAt, retentionCutoff))
      .groupBy(messageLogs.actorEmail),
  ]);
  const activityByEmail = new Map(
    activity.map((item) => [item.actorEmail, item]),
  );
  return users.map((user) => ({
    ...user,
    role: user.role === "admin" ? "admin" as const : "agent" as const,
    messageCount: activityByEmail.get(user.email)?.messageCount ?? 0,
    lastMessageAt: activityByEmail.get(user.email)?.lastMessageAt ?? null,
  }));
}
