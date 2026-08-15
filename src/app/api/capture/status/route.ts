import { CAPTURE_STATUS, type WorldLabsCapture } from "@/lib/captureStatus";
import { DEFAULT_BACKEND, isCaptureBackend } from "@/lib/captureBackend";
import { getOperation, type Operation } from "@/lib/worldlabs.server";
import { getStatus as getKiriStatus } from "@/lib/kiri.server";
import { KIRI_STATUS } from "@/lib/kiri";

/**
 * Polls one job at whichever service started it, and reports it in the app's
 * own vocabulary so the queue never learns which one that was.
 *
 * A finished World Labs job also hands back the world's details here rather
 * than needing a call of their own: the client is already polling, and the
 * metadata is small.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const serialize = params.get("serialize");
  if (!serialize) {
    return Response.json({ error: "serialize is required" }, { status: 400 });
  }
  const asked = params.get("backend");
  const backend = isCaptureBackend(asked) ? asked : DEFAULT_BACKEND;

  try {
    if (backend === "kiri") {
      const status = await getKiriStatus(serialize);
      return Response.json({
        status,
        ready: status === KIRI_STATUS.successful,
        // Expiry is fatal the same way failure is: the result is gone and the
        // same task id will never produce it.
        failed:
          status === KIRI_STATUS.failed || status === KIRI_STATUS.expired,
      });
    }

    const operation = await getOperation(serialize);
    const reported = operation.metadata?.progress?.status;

    // `done` is the authority. A status string this does not recognise reads as
    // still working, which is the only safe way to be wrong about it: the
    // alternative abandons a job the API is still running and has charged for.
    const failed = reported === "FAILED" || Boolean(operation.error);
    const ready = operation.done && !failed;

    return Response.json({
      status: failed
        ? CAPTURE_STATUS.failed
        : ready
          ? CAPTURE_STATUS.successful
          : CAPTURE_STATUS.processing,
      ready,
      failed,
      ...(failed ? { error: describeFailure(operation) } : {}),
      ...(ready ? { world: worldDetails(operation) } : {}),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Status check failed";
    return Response.json({ error: msg }, { status: 502 });
  }
}

/**
 * World Labs answers a failed generation with a bare 500 and "please retry it",
 * which is not something a capture row can usefully repeat back. What it can
 * say is that the credits went with it — one generation failed after 47 minutes
 * and the balance never came back — so the message names that plainly.
 */
function describeFailure(operation: Operation) {
  const error = operation.error as { message?: string } | null;
  const upstream = error?.message?.trim();
  const base =
    upstream && !/^an error has happened/i.test(upstream)
      ? upstream
      : "World Labs could not generate this world";
  return `${base}. Credits for a failed generation are not returned.`;
}

function worldDetails(operation: Operation): WorldLabsCapture | undefined {
  const world = operation.response;
  if (!world) return undefined;
  const scale = world.assets?.splats?.semantics_metadata as {
    metric_scale_factor?: number;
    ground_plane_offset?: number;
  } | null;

  return {
    worldId: world.world_id,
    caption: world.assets?.caption ?? undefined,
    metricScaleFactor: scale?.metric_scale_factor,
    groundPlaneOffset: scale?.ground_plane_offset,
    colliderMeshUrl: world.assets?.mesh?.collider_mesh_url ?? undefined,
    marbleUrl: world.world_marble_url ?? undefined,
    model: operation.metadata?.public_model_name,
  };
}
