/**
 * A finished capture is a hundred-odd megabytes: too big for localStorage, and
 * far too slow to pull from KIRI again on every reload. Cache Storage holds
 * blobs that size and survives reloads, so a capture that has already been
 * downloaded once comes straight back off disk.
 *
 * Only the newest capture is kept — two of these would be a quarter of a
 * gigabyte — so a write prunes every other entry.
 */
const CACHE_NAME = "atlas-splats-v1";

/** Cache Storage needs a secure context; localhost counts as one. */
function unavailable() {
  return typeof caches === "undefined";
}

function cacheKey(serialize: string) {
  return `/cached-splat/${encodeURIComponent(serialize)}`;
}

export async function readCachedSplat(serialize: string): Promise<Blob | null> {
  if (unavailable()) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(cacheKey(serialize));
    return hit ? await hit.blob() : null;
  } catch {
    return null; // A cache miss and a broken cache are the same to the caller.
  }
}

export async function writeCachedSplat(serialize: string, blob: Blob) {
  if (unavailable()) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    const key = cacheKey(serialize);
    for (const request of await cache.keys()) {
      if (!request.url.endsWith(key)) await cache.delete(request);
    }
    await cache.put(
      key,
      new Response(blob, {
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
  } catch {
    // Out of quota or storage denied — caching is an optimization, not the flow.
  }
}

export async function dropCachedSplat(serialize: string) {
  if (unavailable()) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(cacheKey(serialize));
  } catch {
    // Nothing to clean up, or nothing we can do about it.
  }
}
