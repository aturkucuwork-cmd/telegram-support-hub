import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { getDb } from "@/db";
import {
  agents,
  conversations,
  telegramFolderMembers,
  telegramFolders,
} from "@/db/schema";

const SQLITE_ID_CHUNK = 150;

export async function findFolderAssignment(telegramChatId: string) {
  const [assignment] = await getDb()
    .select({
      email: telegramFolders.assignedToEmail,
      folderId: telegramFolders.id,
      folderTitle: telegramFolders.title,
    })
    .from(telegramFolderMembers)
    .innerJoin(
      telegramFolders,
      eq(telegramFolderMembers.folderId, telegramFolders.id),
    )
    .innerJoin(agents, eq(telegramFolders.assignedToEmail, agents.email))
    .where(
      and(
        eq(telegramFolderMembers.telegramPeerId, telegramChatId),
        isNotNull(telegramFolders.assignedToEmail),
        isNotNull(telegramFolders.mappingUpdatedAt),
        eq(agents.isActive, true),
      ),
    )
    .orderBy(desc(telegramFolders.mappingUpdatedAt), desc(telegramFolders.id))
    .limit(1);

  if (!assignment?.email) return null;
  return {
    email: assignment.email,
    folderId: assignment.folderId,
    folderTitle: assignment.folderTitle,
  };
}

export async function recalculateFolderAssignments(): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();

  await db
    .update(conversations)
    .set({
      assignedToEmail: null,
      assignmentSource: null,
      assignmentFolderId: null,
      updatedAt: now,
    })
    .where(eq(conversations.assignmentSource, "telegram_folder"));

  const rules = await db
    .select({
      folderId: telegramFolders.id,
      assignedToEmail: telegramFolders.assignedToEmail,
    })
    .from(telegramFolders)
    .innerJoin(agents, eq(telegramFolders.assignedToEmail, agents.email))
    .where(
      and(
        isNotNull(telegramFolders.assignedToEmail),
        isNotNull(telegramFolders.mappingUpdatedAt),
        eq(agents.isActive, true),
      ),
    )
    .orderBy(asc(telegramFolders.mappingUpdatedAt), asc(telegramFolders.id));

  for (const rule of rules) {
    if (!rule.assignedToEmail) continue;
    const members = await db
      .select({ peerId: telegramFolderMembers.telegramPeerId })
      .from(telegramFolderMembers)
      .where(eq(telegramFolderMembers.folderId, rule.folderId));
    for (let offset = 0; offset < members.length; offset += SQLITE_ID_CHUNK) {
      const peerIds = members
        .slice(offset, offset + SQLITE_ID_CHUNK)
        .map((member) => member.peerId);
      if (!peerIds.length) continue;
      await db
        .update(conversations)
        .set({
          assignedToEmail: rule.assignedToEmail,
          assignmentSource: "telegram_folder",
          assignmentFolderId: rule.folderId,
          updatedAt: now,
        })
        .where(
          and(
            inArray(conversations.telegramChatId, peerIds),
            or(
              isNull(conversations.assignmentSource),
              eq(conversations.assignmentSource, "telegram_folder"),
            ),
          ),
        );
    }
  }

  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .where(eq(conversations.assignmentSource, "telegram_folder"));
  return Number(result?.count ?? 0);
}
