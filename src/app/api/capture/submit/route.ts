import { submitVideo } from "@/lib/worldlabs.server";

/**
 * Hands the walkthrough to World Labs and returns the operation to poll.
 *
 * The reply still calls the handle `serialize`. It is a World Labs operation id
 * now, not a KIRI task id, but a capture row survives a reload by keeping that
 * value in localStorage — renaming the field would strand every job in flight
 * the moment this ships. Worth renaming once none can still be running.
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
    const name = form.get("name");
    const operationId = await submitVideo(video, {
      displayName: typeof name === "string" && name ? name : undefined,
    });
    return Response.json({ serialize: operationId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Upload failed";
    return Response.json({ error: msg }, { status: 400 });
  }
}
