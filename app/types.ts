export type Actor = {
  id: number;
  email: string;
  displayName: string;
  role: "admin" | "agent";
};

export type Connection = {
  id: string;
  displayName: string;
  username: string | null;
  isEnabled: boolean;
};

export type SystemStatus = {
  configured: boolean;
  connected: boolean;
  connection: Connection | null;
  deliveryMode: "polling" | "webhook";
  webhookUrl: string;
  groupMessageAccess: "all" | "limited" | "unknown";
  userGroupListener: {
    connected: boolean;
    displayName: string | null;
    username: string | null;
    lastHeartbeatAt: string | null;
  };
  actor: Actor;
};

export type Conversation = {
  id: number;
  connectionId: string;
  telegramChatId: string;
  topicId: string;
  type: "private" | "group" | "supergroup" | "channel";
  title: string;
  username: string | null;
  status: "open" | "pending" | "resolved";
  assignedToEmail: string | null;
  assignmentSource: "manual" | "telegram_folder" | null;
  assignmentFolderId: number | null;
  unreadCount: number;
  lastMessage: string;
  lastMessageAt: string;
};

export type TelegramFolderMember = {
  id: number;
  folderId: number;
  telegramPeerId: string;
  peerType: "private" | "group" | "supergroup" | "channel";
  peerTitle: string;
  peerUsername: string | null;
};

export type TelegramFolder = {
  id: number;
  telegramUserId: string;
  telegramFolderId: number;
  title: string;
  assignedToEmail: string | null;
  mappingUpdatedAt: string | null;
  memberCount: number;
  lastSyncedAt: string;
  members: TelegramFolderMember[];
};

export type TelegramFolderUser = {
  email: string;
  displayName: string;
  role: "admin" | "agent";
  isActive: boolean;
};

export type Message = {
  id: number;
  conversationId: number;
  telegramMessageId: string;
  replyToTelegramMessageId: string | null;
  direction: "inbound" | "outbound";
  senderName: string | null;
  text: string;
  contentType: string;
  fileId: string | null;
  fileName: string | null;
  mimeType: string | null;
  isEdited: boolean;
  isDeleted: boolean;
  sentAt: string;
};

export type MessageLog = {
  id: number;
  conversationId: number;
  telegramMessageId: string;
  actorEmail: string;
  actorDisplayName: string;
  conversationTitle: string;
  messageText: string;
  sentAt: string;
};

export type Bot = {
  id: number;
  label: string;
  telegramBotId: string;
  username: string | null;
  displayName: string | null;
  tokenLastFour: string;
  isEnabled: boolean;
  lastValidatedAt: string | null;
  lastPollErrorAt: string | null;
  lastPollError: string | null;
  groupCount: number;
};

export type MessageLogUser = {
  id: number;
  email: string;
  displayName: string;
  role: "admin" | "agent";
  isActive: boolean;
  messageCount: number;
  lastMessageAt: string | null;
};
