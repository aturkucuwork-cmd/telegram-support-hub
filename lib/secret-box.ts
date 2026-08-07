import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const HEADER = "relaydesk-botkey-aesgcm-1:";
const HKDF_INFO = "relaydesk-bot-token-v1";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function deriveKey(): Buffer {
  const raw = process.env.SESSION_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error("SESSION_ENCRYPTION_KEY ortam değişkeni eksik.");
  }
  const keyMaterial = fromBase64Url(raw);
  const derived = hkdfSync("sha256", keyMaterial, Buffer.alloc(0), HKDF_INFO, 32);
  return Buffer.from(derived);
}

export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return HEADER + Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  if (!encoded.startsWith(HEADER)) {
    throw new Error("Şifreli değer geçersiz biçimde.");
  }
  const key = deriveKey();
  const raw = Buffer.from(encoded.slice(HEADER.length), "base64");
  if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Şifreli değer geçersiz biçimde.");
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Şifreli değer SESSION_ENCRYPTION_KEY ile açılamadı.");
  }
}
