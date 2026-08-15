import { isCaptureBackend, DEFAULT_BACKEND } from "@/lib/captureBackend";
import { submitVideo as submitToWorldLabs } from "@/lib/worldlabs.server";
import { submitVideo as submitToKiri } from "@/lib/kiri.server";

/**
 * Hands the walkthrough to whichever service the capture asked for.
 *
 * The reply calls the handle `serialize` for both. It is a World Labs
 * operation id or a KIRI task id depending on the backend, and a capture row
 * survives a reload by keeping that value in localStorage — so the field name
 * outlived the service it was named after.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const video = form.get("video");
    if (!(video instanceof File)) {
      return Response.json(
        { error: "A video file is required" },
        { status: 400 },
      );
    }

    const asked = form.get("backend");
    const backend = isCaptureBackend(asked) ? asked : DEFAULT_BACKEND;
    const name = form.get("name");

    const serialize =
      backend === "kiri"
        ? await submitToKiri(video)
        : await submitToWorldLabs(video, {
            displayName: typeof name === "string" && name ? name : undefined,
          });

    // Echoed back so the client stores what it actually reached, rather than
    // what it meant to reach: every later call about this job has to go to the
    // same service, and asking the other one is a job that does not exist.
    return Response.json({ serialize, backend });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Upload failed";
    return Response.json({ error: msg }, { status: 400 });
  }
}
