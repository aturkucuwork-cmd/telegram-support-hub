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
  unreadCount: number;
  lastMessage: string;
  lastMessageAt: string;
};

export type Message = {
  id: number;
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

export type MessageLogUser = {
  id: number;
  email: string;
  displayName: string;
  role: "admin" | "agent";
  isActive: boolean;
  messageCount: number;
  lastMessageAt: string | null;
};
