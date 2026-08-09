/**
 * Serves a stored splat or audio track through this app's own origin.
 *
 * Firebase Storage will hand a browser the bytes only if the bucket carries a
 * CORS rule, and a bucket without one refuses the read outright — a capture
 * that saved perfectly renders as a black screen. Setting that rule is the
 * proper fix (see cors.json); this exists so a project whose bucket has not
 * been configured, or cannot be, still works. Same origin, so the question
 * never arises: `<audio crossOrigin>` is satisfied too, which matters because
 * createMediaElementSource silently outputs nothing for a tainted element.
 *
 * The cost is real — every byte of a hundred-megabyte splat travels through
 * this process rather than straight from Google — so it is a fallback rather
 * than the way things ought to run.
 */
const BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "";

/**
 * Only this project's own bucket. Without the check the route is an open
 * proxy: anything that can name a URL could make the server fetch it, including
 * addresses reachable only from inside the network this runs on.
 */
function allowed(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname !== "firebasestorage.googleapis.com") return null;
  if (!BUCKET || !url.pathname.startsWith(`/v0/b/${BUCKET}/o/`)) return null;
  return url;
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) {
    return Response.json({ error: "A url is required" }, { status: 400 });
  }
  const url = allowed(raw);
  if (!url) {
    return Response.json({ error: "That url is not servable" }, { status: 400 });
  }

  // Range is forwarded so a partial read of a large splat still behaves, and so
  // an <audio> element can seek without pulling the whole track first.
  const range = req.headers.get("range");
  const upstream = await fetch(url, {
    headers: range ? { Range: range } : undefined,
    cache: "no-store",
  });
  if (!upstream.ok && upstream.status !== 206) {
    return Response.json(
      { error: `Storage answered ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const headers = new Headers();
  for (const name of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // The download token in the URL already pins this to one immutable object.
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new Response(upstream.body, { status: upstream.status, headers });
}
