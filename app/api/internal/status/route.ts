import { getRelayDeskStatus } from "@/lib/status";
import { requireInternalApi } from "@/lib/internal-api";

export async function GET(request: Request) {
  const authorization = requireInternalApi(request);
  if (authorization) return authorization;
  return Response.json(await getRelayDeskStatus(request, null), {
    headers: { "Cache-Control": "no-store" },
  });
}
