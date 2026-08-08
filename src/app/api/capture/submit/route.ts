import { submitVideo } from "@/lib/kiri.server";

export async function POST(req: Request) {
  try {
    const video = (await req.formData()).get("video");
    if (!(video instanceof File)) {
      return Response.json({ error: "A video file is required" }, { status: 400 });
    }
    return Response.json({ serialize: await submitVideo(video) });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Upload failed";
    return Response.json({ error: msg }, { status: 400 });
  }
}
