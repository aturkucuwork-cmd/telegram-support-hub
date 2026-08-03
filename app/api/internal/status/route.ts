import { timingSafeEqual } from "node:crypto";
import { getRelayDeskStatus } from "@/lib/status";

function isLocalRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function hasInternalSecret(request: Request): boolean {
  const expected = process.env.INTERNAL_API_SECRET?.trim();
  const supplied = request.headers.get("X-RelayDesk-Internal-Secret")?.trim();
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

export async function GET(request: Request) {
  if (!isLocalRequest(request)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!hasInternalSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json(await getRelayDeskStatus(request, null), {
    headers: { "Cache-Control": "no-store" },
  });
}
