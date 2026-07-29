import { getActor } from "@/lib/auth";

export async function GET(request: Request) {
  const actor = await getActor(request);
  return Response.json({ actor }, { status: actor ? 200 : 401 });
}
