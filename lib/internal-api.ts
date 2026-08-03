import { randomUUID, timingSafeEqual } from "node:crypto";

const INTERNAL_SECRET_HEADER = "X-RelayDesk-Internal-Secret";
const INTERNAL_TIMESTAMP_HEADER = "X-RelayDesk-Internal-Timestamp";
const INTERNAL_NONCE_HEADER = "X-RelayDesk-Internal-Nonce";
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const usedNonces = new Map<string, number>();

export function internalRequestHeaders(secret: string): Record<string, string> {
  return {
    [INTERNAL_SECRET_HEADER]: secret,
    [INTERNAL_TIMESTAMP_HEADER]: String(Date.now()),
    [INTERNAL_NONCE_HEADER]: randomUUID(),
  };
}

function isLocalRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function sameSecret(expected: string, supplied: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

function cleanupNonces(now: number): void {
  for (const [nonce, expiresAt] of usedNonces) {
    if (expiresAt <= now) usedNonces.delete(nonce);
  }
}

export function hasInternalCredentialHeaders(request: Request): boolean {
  return Boolean(
    request.headers.get(INTERNAL_SECRET_HEADER) ||
      request.headers.get(INTERNAL_TIMESTAMP_HEADER) ||
      request.headers.get(INTERNAL_NONCE_HEADER),
  );
}

export function requireInternalApi(request: Request): Response | null {
  if (!isLocalRequest(request)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const expected = process.env.INTERNAL_API_SECRET?.trim();
  const supplied = request.headers.get(INTERNAL_SECRET_HEADER)?.trim();
  const timestampValue = request.headers.get(INTERNAL_TIMESTAMP_HEADER)?.trim();
  const nonce = request.headers.get(INTERNAL_NONCE_HEADER)?.trim();
  const timestamp = Number(timestampValue);
  const now = Date.now();
  cleanupNonces(now);

  if (
    !expected ||
    !supplied ||
    !sameSecret(expected, supplied) ||
    !timestampValue ||
    !Number.isSafeInteger(timestamp) ||
    Math.abs(now - timestamp) > MAX_CLOCK_SKEW_MS ||
    !nonce ||
    nonce.length > 128 ||
    usedNonces.has(nonce)
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  usedNonces.set(nonce, now + MAX_CLOCK_SKEW_MS);
  return null;
}

export function resetInternalNonceCacheForTests(): void {
  usedNonces.clear();
}
