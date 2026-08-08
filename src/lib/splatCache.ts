/**
 * A finished capture is a hundred-odd megabytes: too big for localStorage, and
 * far too slow to pull from KIRI again on every reload. Cache Storage holds
 * blobs that size and survives reloads, so a capture that has already been
 * downloaded once comes straight back off disk.
 *
 * The walkthrough's audio is kept here for the opposite reason: it is lifted
 * off the source video the moment that File is in hand, which is 30-90 minutes
 * before the splat it belongs to exists, and no File survives a reload.
 *
 * Each kind gets its own cache because a write keeps only the newest entry —
 * two splats would be a quarter of a gigabyte — and pruning one kind must not
 * take the other half of the same job with it.
 */
const SPLAT_CACHE = "atlas-splats-v1";
const AUDIO_CACHE = "atlas-capture-audio-v1";

/** Cache Storage needs a secure context; localhost counts as one. */
function unavailable() {
  return typeof caches === "undefined";
}

function splatKey(serialize: string) {
  return `/cached-splat/${encodeURIComponent(serialize)}`;
}

function audioKey(serialize: string) {
  return `/cached-audio/${encodeURIComponent(serialize)}`;
}

async function read(cacheName: string, key: string): Promise<Blob | null> {
  if (unavailable()) return null;
  try {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(key);
    return hit ? await hit.blob() : null;
  } catch {
    return null; // A cache miss and a broken cache are the same to the caller.
  }
}

async function write(cacheName: string, key: string, blob: Blob) {
  if (unavailable()) return;
  try {
    const cache = await caches.open(cacheName);
    for (const request of await cache.keys()) {
      if (!request.url.endsWith(key)) await cache.delete(request);
    }
    await cache.put(
      key,
      new Response(blob, {
        headers: { "Content-Type": blob.type || "application/octet-stream" },
      }),
    );
  } catch {
    // Out of quota or storage denied — caching is an optimization, not the flow.
  }
}

async function drop(cacheName: string, key: string) {
  if (unavailable()) return;
  try {
    const cache = await caches.open(cacheName);
    await cache.delete(key);
  } catch {
    // Nothing to clean up, or nothing we can do about it.
  }
}

export function readCachedSplat(serialize: string) {
  return read(SPLAT_CACHE, splatKey(serialize));
}

export function writeCachedSplat(serialize: string, blob: Blob) {
  return write(SPLAT_CACHE, splatKey(serialize), blob);
}

export function dropCachedSplat(serialize: string) {
  return drop(SPLAT_CACHE, splatKey(serialize));
}

export function readCachedAudio(serialize: string) {
  return read(AUDIO_CACHE, audioKey(serialize));
}

export function writeCachedAudio(serialize: string, blob: Blob) {
  return write(AUDIO_CACHE, audioKey(serialize), blob);
}

export function dropCachedAudio(serialize: string) {
  return drop(AUDIO_CACHE, audioKey(serialize));
}
