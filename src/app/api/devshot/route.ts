import { writeFile } from "node:fs/promises";

// Local-only helper: the agent preview pane never fires requestAnimationFrame,
// so frames have to be pumped manually and written out to be inspected.
export async function POST(req: Request) {
  if (process.env.NODE_ENV !== "development") {
    return new Response("Not found", { status: 404 });
  }
  const { dataUrl } = await req.json();
  const b64 = dataUrl.split(",")[1];
  await writeFile("/tmp/devshot.jpg", Buffer.from(b64, "base64"));
  return Response.json({ ok: true });
}
