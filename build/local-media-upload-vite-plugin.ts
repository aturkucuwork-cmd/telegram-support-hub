import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { loadEnv } from "vite";

const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_TYPES = new Set(["video/mp4"]);
const PHOTO_LIMIT = 10 * 1024 * 1024;
const VIDEO_LIMIT = 50 * 1024 * 1024;
const REQUEST_LIMIT = 52 * 1024 * 1024;

function sendJson(
  response: ServerResponse,
  status: number,
  payload: Record<string, unknown>,
) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request: IncomingMessage): Promise<Uint8Array> {
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (declaredLength > REQUEST_LIMIT) throw new Error("REQUEST_TOO_LARGE");

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > REQUEST_LIMIT) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function localMediaUpload(): Plugin {
  let botToken = "";
  let webhookSecret = "";

  return {
    name: "relaydesk-local-media-upload",
    apply: "serve",
    enforce: "pre",
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, "");
      botToken = env.TELEGRAM_BOT_TOKEN?.trim() || "";
      webhookSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim() || "";
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url || "/", "http://localhost");
        if (url.pathname !== "/api/reply/media" || request.method !== "POST") {
          next();
          return;
        }

        if (!isLocalOrigin(request.headers.origin)) {
          sendJson(response, 403, { error: "Yerel medya isteğinin kaynağı geçersiz." });
          return;
        }
        if (!botToken || !webhookSecret) {
          sendJson(response, 503, { error: "Telegram yerel ayarları yüklenmedi." });
          return;
        }

        try {
          const body = await readRequestBody(request);
          const headers = new Headers();
          for (const [name, value] of Object.entries(request.headers)) {
            if (value !== undefined) {
              headers.set(name, Array.isArray(value) ? value.join(", ") : value);
            }
          }
          const webRequest = new Request("http://localhost/api/reply/media", {
            method: "POST",
            headers,
            body: body.buffer.slice(
              body.byteOffset,
              body.byteOffset + body.byteLength,
            ) as ArrayBuffer,
          });
          const form = await webRequest.formData();
          const file = form.get("file");
          const caption = formString(form, "caption");
          const chatId = formString(form, "chatId");
          const connectionId = formString(form, "connectionId");
          const topicId = formString(form, "topicId");
          const isGroup = formString(form, "isGroup") === "true";
          const validateOnly = formString(form, "validateOnly") === "true";

          if (!(file instanceof File) || file.size < 1) {
            sendJson(response, 400, { error: "Fotoğraf veya video seçilmedi." });
            return;
          }
          const isPhoto = PHOTO_TYPES.has(file.type);
          const isVideo = VIDEO_TYPES.has(file.type);
          if (!isPhoto && !isVideo) {
            sendJson(response, 415, {
              error: "Yalnızca JPG, PNG, WEBP fotoğraf veya MP4 video gönderebilirsiniz.",
            });
            return;
          }
          if (isPhoto && file.size > PHOTO_LIMIT) {
            sendJson(response, 413, { error: "Fotoğraf en fazla 10 MB olabilir." });
            return;
          }
          if (isVideo && file.size > VIDEO_LIMIT) {
            sendJson(response, 413, { error: "Video en fazla 50 MB olabilir." });
            return;
          }
          if (caption.length > 1024) {
            sendJson(response, 400, {
              error: "Medya açıklaması en fazla 1024 karakter olabilir.",
            });
            return;
          }
          if (validateOnly) {
            sendJson(response, 200, { ok: true, validated: true, size: file.size });
            return;
          }
          if (!chatId || (!isGroup && !connectionId)) {
            sendJson(response, 400, { error: "Telegram konuşma bilgisi eksik." });
            return;
          }

          const telegramForm = new FormData();
          telegramForm.set("chat_id", chatId);
          if (!isGroup) telegramForm.set("business_connection_id", connectionId);
          if (topicId) telegramForm.set("message_thread_id", topicId);
          if (caption) telegramForm.set("caption", caption);
          const mediaField = isPhoto ? "photo" : "video";
          telegramForm.set(mediaField, file, file.name);
          if (isVideo) telegramForm.set("supports_streaming", "true");

          const telegramResponse = await fetch(
            `https://api.telegram.org/bot${botToken}/${isPhoto ? "sendPhoto" : "sendVideo"}`,
            { method: "POST", body: telegramForm },
          );
          const telegramText = await telegramResponse.text();
          let telegramResult: {
            ok?: boolean;
            result?: Record<string, unknown>;
            description?: string;
          } = {};
          try {
            telegramResult = JSON.parse(telegramText) as typeof telegramResult;
          } catch {
            // Aşağıdaki güvenli hata mesajı kullanılacak.
          }
          if (!telegramResponse.ok || !telegramResult.ok || !telegramResult.result) {
            sendJson(response, 502, {
              error: telegramResult.description || "Telegram medya gönderimini reddetti.",
            });
            return;
          }

          const telegramMessage = telegramResult.result;
          if (!isGroup && !telegramMessage.business_connection_id) {
            telegramMessage.business_connection_id = connectionId;
          }
          if (topicId && !telegramMessage.message_thread_id) {
            telegramMessage.message_thread_id = Number(topicId);
          }

          const host = request.headers.host || "localhost:3000";
          const importResponse = await fetch(`http://${host}/api/telegram/import`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": webhookSecret,
            },
            body: JSON.stringify({
              items: [
                {
                  source: isGroup ? "group" : "business",
                  outgoing: true,
                  message: telegramMessage,
                },
              ],
            }),
          });
          if (!importResponse.ok) {
            sendJson(response, 502, {
              error: "Medya Telegram'a gönderildi fakat RelayDesk kaydı yenilenemedi.",
            });
            return;
          }

          sendJson(response, 200, { ok: true, message: telegramMessage });
        } catch (error) {
          if (error instanceof Error && error.message === "REQUEST_TOO_LARGE") {
            sendJson(response, 413, { error: "Yükleme isteği en fazla 52 MB olabilir." });
            return;
          }
          sendJson(response, 500, {
            error: error instanceof Error ? error.message : "Medya yüklenemedi.",
          });
        }
      });
    },
  };
}
