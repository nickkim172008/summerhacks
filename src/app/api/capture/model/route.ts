import { fetchSplatPly } from "@/lib/kiri.server";

/**
 * Streams the finished PLY back to the browser, which uploads it to Storage with
 * the client SDK. KIRI's download link is signed and expires in 60 minutes, so
 * it is never handed to the client directly.
 */
export async function GET(req: Request) {
  const serialize = new URL(req.url).searchParams.get("serialize");
  if (!serialize) {
    return Response.json({ error: "serialize is required" }, { status: 400 });
  }
  try {
    const { name, bytes } = await fetchSplatPly(serialize);
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
