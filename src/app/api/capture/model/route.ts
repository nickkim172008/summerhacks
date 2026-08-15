import { DEFAULT_BACKEND, isCaptureBackend } from "@/lib/captureBackend";
import { fetchSplat, getOperation, getWorld } from "@/lib/worldlabs.server";
import { fetchSplatPly } from "@/lib/kiri.server";

/**
 * Streams the finished capture back to the browser, which uploads it to
 * Storage with the client SDK.
 *
 * What comes back differs by service and the caller has to know: World Labs
 * stores SPZ, which is what Storage already holds, while KIRI returns float32
 * PLY that the browser transcodes before saving. The Content-Type is the same
 * either way, so the filename extension is what says which.
 *
 * Bytes are proxied rather than URLs handed over. KIRI's download link is
 * signed and short-lived; World Labs' CDN would serve the browser directly, but
 * the client would then need the world id, which means trusting it to ask for
 * the right one.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const serialize = params.get("serialize");
  const worldId = params.get("world");
  const asked = params.get("backend");
  const backend = isCaptureBackend(asked) ? asked : DEFAULT_BACKEND;

  if (!serialize && !worldId) {
    return Response.json(
      { error: "serialize or world is required" },
      { status: 400 },
    );
  }

  try {
    const { name, bytes } =
      backend === "kiri"
        ? await fetchSplatPly(serialize!)
        : await fetchSplat(
            // By world id when the caller has one: an operation is only
            // addressable for three hours, and a capture left overnight comes
            // back to a job that has aged out while its world is still there.
            worldId
              ? await getWorld(worldId)
              : ((await getOperation(serialize!)).response ??
                (await resolveByOperation(serialize!))),
          );

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
 * A finished operation carries its world inline; one read after the fact may
 * carry only the id. Both routes end at the same world.
 */
async function resolveByOperation(operationId: string) {
  const operation = await getOperation(operationId);
  const id = operation.metadata?.world_id;
  if (!id) throw new Error("This job has not produced a world yet");
  return getWorld(id);
}
