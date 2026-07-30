const ITERATIONS = 210_000;
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: ITERATIONS,
      salt: salt.buffer.slice(
        salt.byteOffset,
        salt.byteOffset + salt.byteLength,
      ) as ArrayBuffer,
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function createPasswordHash(password: string): Promise<{
  hash: string;
  salt: string;
}> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    hash: toBase64Url(await derive(password, salt)),
    salt: toBase64Url(salt),
  };
}

export async function verifyPassword(
  password: string,
  expectedHash: string,
  encodedSalt: string,
): Promise<boolean> {
  const actual = await derive(password, fromBase64Url(encodedSalt));
  const expected = fromBase64Url(expectedHash);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual[index] ^ expected[index];
  }
  return difference === 0;
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return toBase64Url(new Uint8Array(digest));
}

export function randomSessionToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}
