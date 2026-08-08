import { submitImages } from "@/lib/kiri.server";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const images = form.getAll("images").filter((v): v is File => v instanceof File);
    return Response.json({ serialize: await submitImages(images) });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Upload failed";
}
