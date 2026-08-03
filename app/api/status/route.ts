import { requireActor } from "@/lib/auth";
import { getRelayDeskStatus } from "@/lib/status";

export async function GET(request: Request) {
  const actor = await requireActor(request);
  if (actor instanceof Response) return actor;
  return Response.json(await getRelayDeskStatus(request, actor));
}
