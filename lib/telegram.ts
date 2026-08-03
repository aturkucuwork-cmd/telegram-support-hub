export type TelegramUser = {
  id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
};

export type TelegramChat = {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramMessage = {
  message_id: number;
  business_connection_id?: string;
  message_thread_id?: number;
  is_topic_message?: boolean;
  relaydesk_topic_title?: string;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  sender_business_bot?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string; width: number; height: number }>;
  document?: { file_id: string; file_name?: string; mime_type?: string };
  video?: { file_id: string; file_name?: string; mime_type?: string };
  audio?: { file_id: string; file_name?: string; mime_type?: string };
  voice?: { file_id: string; mime_type?: string };
  animation?: { file_id: string; file_name?: string; mime_type?: string };
  sticker?: { file_id: string; emoji?: string };
  location?: { latitude: number; longitude: number };
  contact?: { first_name: string; last_name?: string; phone_number: string };
  poll?: { question: string };
  forum_topic_created?: { name: string };
  reply_to_message?: { message_id: number };
};

export type ParsedContent = {
  text: string;
  contentType: string;
  fileId: string | null;
  fileName: string | null;
  mimeType: string | null;
  preview: string;
};

function value(name: string): string | undefined {
  return process.env[name];
}

export function telegramConfig() {
  return {
    botToken: value("TELEGRAM_BOT_TOKEN")?.trim(),
    webhookSecret: value("TELEGRAM_WEBHOOK_SECRET")?.trim(),
  };
}

export function personName(user?: TelegramUser): string {
  if (!user) return "Bilinmeyen";
  return (
    [user.first_name, user.last_name].filter(Boolean).join(" ") ||
    user.username ||
    "Bilinmeyen"
  );
}

export function chatTitle(chat: TelegramChat): string {
  return (
    chat.title ||
    [chat.first_name, chat.last_name].filter(Boolean).join(" ") ||
    chat.username ||
    `Sohbet ${chat.id}`
  );
}

export function parseContent(message: TelegramMessage): ParsedContent {
  const text = message.text ?? message.caption ?? "";

  if (message.forum_topic_created) {
    return {
      text: `Konu oluşturuldu: ${message.forum_topic_created.name}`,
      contentType: "system",
      fileId: null,
      fileName: null,
      mimeType: null,
      preview: `Konu oluşturuldu: ${message.forum_topic_created.name}`,
    };
  }

  if (message.photo?.length) {
    const photo = message.photo.at(-1)!;
    return {
      text,
      contentType: "photo",
      fileId: photo.file_id,
      fileName: null,
      mimeType: "image/jpeg",
      preview: text || "Fotoğraf",
    };
  }

  const attachment =
    (message.document && { type: "document", label: "Belge", ...message.document }) ||
    (message.video && { type: "video", label: "Video", ...message.video }) ||
    (message.audio && { type: "audio", label: "Ses", ...message.audio }) ||
    (message.voice && { type: "voice", label: "Sesli mesaj", ...message.voice }) ||
    (message.animation && {
      type: "animation",
      label: "Animasyon",
      ...message.animation,
    }) ||
    (message.sticker && {
      type: "sticker",
      label: message.sticker.emoji ? `${message.sticker.emoji} Çıkartma` : "Çıkartma",
      ...message.sticker,
    });

  if (attachment) {
    return {
      text,
      contentType: attachment.type,
      fileId: attachment.file_id,
      fileName: "file_name" in attachment ? attachment.file_name ?? null : null,
      mimeType: "mime_type" in attachment ? attachment.mime_type ?? null : null,
      preview: text || attachment.label,
    };
  }

  if (message.location) {
    return {
      text: `${message.location.latitude}, ${message.location.longitude}`,
      contentType: "location",
      fileId: null,
      fileName: null,
      mimeType: null,
      preview: "Konum",
    };
  }

  if (message.contact) {
    const name = [message.contact.first_name, message.contact.last_name]
      .filter(Boolean)
      .join(" ");
    return {
      text: `${name} · ${message.contact.phone_number}`,
      contentType: "contact",
      fileId: null,
      fileName: null,
      mimeType: null,
      preview: `Kişi: ${name}`,
    };
  }

  if (message.poll) {
    return {
      text: message.poll.question,
      contentType: "poll",
      fileId: null,
      fileName: null,
      mimeType: null,
      preview: `Anket: ${message.poll.question}`,
    };
  }

  return {
    text,
    contentType: "text",
    fileId: null,
    fileName: null,
    mimeType: null,
    preview: text || "Yeni mesaj",
  };
}

export async function telegramApi<T>(
  method: string,
  payload: Record<string, unknown>,
  options?: { signal?: AbortSignal },
): Promise<T> {
  const { botToken } = telegramConfig();
  if (!botToken) throw new Error("Telegram bot token henüz ayarlanmadı.");

  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    signal: options?.signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = (await response.json()) as {
    ok: boolean;
    result?: T;
    description?: string;
  };

  if (!response.ok || !result.ok || result.result === undefined) {
    throw new Error(result.description || "Telegram API isteği başarısız oldu.");
  }

  return result.result;
}

export async function telegramMultipartApi<T>(
  method: string,
  form: FormData,
): Promise<T> {
  const { botToken } = telegramConfig();
  if (!botToken) throw new Error("Telegram bot token henüz ayarlanmadı.");

  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    body: form,
  });
  const result = (await response.json()) as {
    ok: boolean;
    result?: T;
    description?: string;
  };

  if (!response.ok || !result.ok || result.result === undefined) {
    throw new Error(result.description || "Telegram medya isteği başarısız oldu.");
  }

  return result.result;
}
