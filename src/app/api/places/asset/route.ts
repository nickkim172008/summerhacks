import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AssetKind } from "@/lib/placeAssets";

/**
 * Writes a place's finished assets under public/ so the app serves them
 * itself, for when no bucket is available. The files land on the machine
 * running this server — see the note in the README about what that means for
 * a shared Firestore.
 *
 * Requires a writable filesystem, so this is a laptop/LAN arrangement rather
 * than a serverless deployment.
 */
const TARGETS: Record<AssetKind, { dir: string; ext: string }> = {
  splat: { dir: "splats", ext: "spz" },
  audio: { dir: "audio", ext: "wav" },
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const placeId = form.get("placeId");
    const kind = form.get("kind");
    const file = form.get("file");

    // The id becomes a filename, so anything path-like is rejected outright.
    if (typeof placeId !== "string" || !SAFE_ID.test(placeId)) {
      return Response.json({ error: "Invalid place id" }, { status: 400 });
    }
    // Both the directory and the extension come from the kind, so nothing the
    // client names can steer where the bytes land.
    const target =
      kind === "splat" || kind === "audio" ? TARGETS[kind] : undefined;
    if (!target) {
      return Response.json({ error: "Unknown asset kind" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return Response.json({ error: "A file is required" }, { status: 400 });
    }

    const dir = path.join(process.cwd(), "public", target.dir);
    await mkdir(dir, { recursive: true });
    const fileName = `${placeId}.${target.ext}`;
    await writeFile(
      path.join(dir, fileName),
      Buffer.from(await file.arrayBuffer()),
    );

    // Relative on purpose: it resolves against whatever origin serves the app.
    return Response.json({ url: `/${target.dir}/${fileName}` });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Could not store asset";
    return Response.json({ error: msg }, { status: 500 });
  }
}
