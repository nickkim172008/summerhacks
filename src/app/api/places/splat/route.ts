import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Writes a finished splat under public/ so the app serves it itself, for when
 * no bucket is available. The file lands on the machine running this server —
 * see the note in the README about what that means for a shared Firestore.
 *
 * Requires a writable filesystem, so this is a laptop/LAN arrangement rather
 * than a serverless deployment.
 */
const SPLAT_DIR = path.join(process.cwd(), "public", "splats");
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const placeId = form.get("placeId");
    const splat = form.get("splat");

    // The id becomes a filename, so anything path-like is rejected outright.
    if (typeof placeId !== "string" || !SAFE_ID.test(placeId)) {
      return Response.json({ error: "Invalid place id" }, { status: 400 });
    }
    if (!(splat instanceof File)) {
      return Response.json({ error: "A splat file is required" }, { status: 400 });
    }

    await mkdir(SPLAT_DIR, { recursive: true });
    const fileName = `${placeId}.spz`;
    await writeFile(
      path.join(SPLAT_DIR, fileName),
      Buffer.from(await splat.arrayBuffer()),
    );

    // Relative on purpose: it resolves against whatever origin serves the app.
    return Response.json({ splatUrl: `/splats/${fileName}` });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not store splat";
    return Response.json({ error: msg }, { status: 500 });
  }
}
