import { fetchSplat, getOperation, getWorld } from "@/lib/worldlabs.server";

/**
 * Streams the finished splat back to the browser, which uploads it to Storage
 * with the client SDK.
 *
 * It arrives as SPZ, which is what Storage already holds — the PLY→SPZ
 * transcode the KIRI path ran in the browser has nothing left to do. The `500k`
 * tier is what comes back rather than `full_res`: 8 MB against 31 MB, and the
 * larger one is detail a phone on cell service never resolves.
 *
 * The bytes are proxied rather than the URL being handed over, the same way
 * KIRI's signed link never reached the client. World Labs' CDN would in fact
 * serve the browser directly — but the client would then need the world id,
 * which means trusting it to ask for the right one.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const serialize = params.get("serialize");
  const worldId = params.get("world");
  if (!serialize && !worldId) {
    return Response.json(
      { error: "serialize or world is required" },
      { status: 400 },
    );
  }
  try {
    // By world id when the caller has one: an operation is only addressable for
    // three hours, and a capture left overnight comes back to a job that has
    // aged out of the API while its world is still there.
    const world = worldId
      ? await getWorld(worldId)
      : ((await getOperation(serialize!)).response ??
        (await resolveByOperation(serialize!)));

    const { name, bytes } = await fetchSplat(world);
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name.replace(/[^\w.-]/g, "_")}"`,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Download failed";
    return Response.json({ error: msg }, { status: 502 });
  }
}

/**
 * A finished operation carries its world inline; one that has been read after
 * the fact may carry only the id. Both routes end at the same world.
 */
async function resolveByOperation(operationId: string) {
  const operation = await getOperation(operationId);
  const id = operation.metadata?.world_id;
  if (!id) throw new Error("This job has not produced a world yet");
  return getWorld(id);
}
