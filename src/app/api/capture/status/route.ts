import { KIRI_STATUS } from "@/lib/kiri";
import { getStatus } from "@/lib/kiri.server";

export async function GET(req: Request) {
  const serialize = new URL(req.url).searchParams.get("serialize");
  if (!serialize) {
    return Response.json({ error: "serialize is required" }, { status: 400 });
  }
  try {
    const status = await getStatus(serialize);
    return Response.json({
      status,
      ready: status === KIRI_STATUS.successful,
      failed: status === KIRI_STATUS.failed || status === KIRI_STATUS.expired,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Status check failed";
    return Response.json({ error: msg }, { status: 502 });
  }
}
