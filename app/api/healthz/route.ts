function isLocalRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function GET(request: Request) {
  if (!isLocalRequest(request)) {
    return Response.json({ ok: false }, { status: 404 });
  }
  return Response.json(
    { ok: true, ready: true, service: "relaydesk" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
