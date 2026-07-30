import {
  and,
  asc,
  eq,
  inArray,
  notInArray,
} from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import {
  agents,
  auditLogs,
  telegramFolderMembers,
  telegramFolders,
} from "@/db/schema";
import { isSameOriginRequest, requireAdmin } from "@/lib/auth";
import { recalculateFolderAssignments } from "@/lib/folder-assignments";
import { telegramConfig } from "@/lib/telegram";

type FolderPeerInput = {
  id?: unknown;
  type?: unknown;
  title?: unknown;
  username?: unknown;
};

type FolderInput = {
  id?: unknown;
  title?: unknown;
  peers?: unknown;
};

const peerTypes = new Set(["private", "group", "supergroup", "channel"]);

function validPeer(value: unknown): value is Required<Pick<FolderPeerInput, "id" | "type" | "title">> & FolderPeerInput {
  if (!value || typeof value !== "object") return false;
  const peer = value as FolderPeerInput;
  return (
    typeof peer.id === "string" &&
    /^-?\d+$/.test(peer.id) &&
    typeof peer.type === "string" &&
    peerTypes.has(peer.type) &&
    typeof peer.title === "string" &&
    peer.title.trim().length > 0 &&
    peer.title.length <= 200 &&
    (peer.username === null ||
      peer.username === undefined ||
      (typeof peer.username === "string" && peer.username.length <= 64))
  );
}

function validFolder(value: unknown): value is Required<Pick<FolderInput, "id" | "title" | "peers">> & FolderInput {
  if (!value || typeof value !== "object") return false;
  const folder = value as FolderInput;
  return (
    Number.isInteger(folder.id) &&
    Number(folder.id) > 0 &&
    typeof folder.title === "string" &&
    folder.title.trim().length > 0 &&
    folder.title.length <= 128 &&
    Array.isArray(folder.peers) &&
    folder.peers.length <= 5000 &&
    folder.peers.every(validPeer)
  );
}

export async function GET(request: Request) {
  const actor = await requireAdmin(request);
  if (actor instanceof Response) return actor;
  await ensureSchema();
  const db = getDb();
  const [folderRows, memberRows, users] = await Promise.all([
    db.select().from(telegramFolders).orderBy(asc(telegramFolders.title)),
    db
      .select()
      .from(telegramFolderMembers)
      .orderBy(asc(telegramFolderMembers.peerTitle)),
    db
      .select({
        email: agents.email,
        displayName: agents.displayName,
        role: agents.role,
        isActive: agents.isActive,
      })
      .from(agents)
      .orderBy(asc(agents.displayName)),
  ]);

  return Response.json({
    folders: folderRows.map((folder) => ({
      ...folder,
      members: memberRows
        .filter((member) => member.folderId === folder.id)
        .slice(0, 8),
    })),
    users,
  });
}

export async function POST(request: Request) {
  const { webhookSecret } = telegramConfig();
  if (!webhookSecret) {
    return Response.json({ error: "Telegram henüz yapılandırılmadı." }, { status: 503 });
  }
  if (request.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret) {
    return Response.json({ error: "Geçersiz klasör senkron imzası." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    telegramUserId?: unknown;
    folders?: unknown;
  } | null;
  if (
    !body ||
    typeof body.telegramUserId !== "string" ||
    !/^\d+$/.test(body.telegramUserId) ||
    !Array.isArray(body.folders) ||
    body.folders.length > 100 ||
    !body.folders.every(validFolder) ||
    body.folders.reduce(
      (sum, folder) => sum + ((folder as FolderInput).peers as unknown[]).length,
      0,
    ) > 10000
  ) {
    return Response.json({ error: "Geçersiz Telegram klasör verisi." }, { status: 400 });
  }

  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const existing = await db
    .select({ id: telegramFolders.id })
    .from(telegramFolders)
    .where(eq(telegramFolders.telegramUserId, body.telegramUserId));
  const currentIds: number[] = [];

  for (const folder of body.folders) {
    const peers = folder.peers as Array<Required<Pick<FolderPeerInput, "id" | "type" | "title">> & FolderPeerInput>;
    const [saved] = await db
      .insert(telegramFolders)
      .values({
        telegramUserId: body.telegramUserId,
        telegramFolderId: folder.id as number,
        title: (folder.title as string).trim(),
        memberCount: peers.length,
        lastSyncedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [telegramFolders.telegramUserId, telegramFolders.telegramFolderId],
        set: {
          title: (folder.title as string).trim(),
          memberCount: peers.length,
          lastSyncedAt: now,
          updatedAt: now,
        },
      })
      .returning({ id: telegramFolders.id });
    currentIds.push(saved.id);
    await db
      .delete(telegramFolderMembers)
      .where(eq(telegramFolderMembers.folderId, saved.id));
    for (let offset = 0; offset < peers.length; offset += 100) {
      const values = peers.slice(offset, offset + 100).map((peer) => ({
        folderId: saved.id,
        telegramPeerId: peer.id as string,
        peerType: peer.type as string,
        peerTitle: (peer.title as string).trim(),
        peerUsername: typeof peer.username === "string" ? peer.username || null : null,
      }));
      if (values.length) {
        await db.insert(telegramFolderMembers).values(values).onConflictDoNothing();
      }
    }
  }

  const staleIds = existing
    .map((folder) => folder.id)
    .filter((id) => !currentIds.includes(id));
  if (staleIds.length) {
    await db
      .delete(telegramFolderMembers)
      .where(inArray(telegramFolderMembers.folderId, staleIds));
    await db
      .delete(telegramFolders)
      .where(
        and(
          eq(telegramFolders.telegramUserId, body.telegramUserId),
          currentIds.length
            ? notInArray(telegramFolders.id, currentIds)
            : inArray(telegramFolders.id, staleIds),
        ),
      );
  }

  const assignedConversationCount = await recalculateFolderAssignments();
  return Response.json({
    ok: true,
    folderCount: currentIds.length,
    assignedConversationCount,
  });
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "Geçersiz istek kaynağı." }, { status: 403 });
  }
  const actor = await requireAdmin(request);
  if (actor instanceof Response) return actor;
  const body = (await request.json().catch(() => null)) as {
    folderId?: unknown;
    assignedToEmail?: unknown;
  } | null;
  if (
    !body ||
    !Number.isInteger(body.folderId) ||
    (body.assignedToEmail !== null && typeof body.assignedToEmail !== "string")
  ) {
    return Response.json({ error: "Geçersiz klasör ataması." }, { status: 400 });
  }

  await ensureSchema();
  const db = getDb();
  const [folder] = await db
    .select()
    .from(telegramFolders)
    .where(eq(telegramFolders.id, body.folderId as number))
    .limit(1);
  if (!folder) {
    return Response.json({ error: "Telegram klasörü bulunamadı." }, { status: 404 });
  }

  const email = typeof body.assignedToEmail === "string"
    ? body.assignedToEmail.trim().toLowerCase()
    : null;
  if (email) {
    const [user] = await db
      .select({ email: agents.email })
      .from(agents)
      .where(and(eq(agents.email, email), eq(agents.isActive, true)))
      .limit(1);
    if (!user) {
      return Response.json({ error: "Etkin ekip kullanıcısı bulunamadı." }, { status: 400 });
    }
  }

  const now = new Date().toISOString();
  const [updatedFolder] = await db
    .update(telegramFolders)
    .set({
      assignedToEmail: email,
      mappingUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(telegramFolders.id, folder.id))
    .returning();
  const assignedConversationCount = await recalculateFolderAssignments();
  await db.insert(auditLogs).values({
    actorEmail: actor.email,
    action: "telegram_folder_assignment_changed",
    detail: JSON.stringify({
      folderId: folder.id,
      telegramFolderId: folder.telegramFolderId,
      folderTitle: folder.title,
      assignedToEmail: email,
    }),
  });

  return Response.json({ folder: updatedFolder, assignedConversationCount });
}
