export type Actor = {
  email: string;
  displayName: string;
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
