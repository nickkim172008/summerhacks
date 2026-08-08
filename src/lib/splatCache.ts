/**
 * A finished capture is a hundred-odd megabytes: too big for localStorage, and
 * far too slow to pull from KIRI again on every reload. Cache Storage holds
 * blobs that size and survives reloads, so a capture that has already been
 * downloaded once comes straight back off disk.
 *
 * Several captures now run at once, so "keep only the newest" would have every
 * finishing job delete the ones beside it. The cache instead keeps the most
 * recently written few under a total byte budget, evicting
 * least-recently-written first.
 *
 * Cache Storage reports neither the size nor the age of what it holds, so both
 * live in an index kept in the cache beside the blobs — same storage, so a
 * browser reclaiming the cache takes the index with it instead of leaving it
 * describing bytes that are gone. That index is the record of what is cached:
 * blobs it does not name are untracked, and a write sweeps them.
 */
const CACHE_NAME = "atlas-splats-v1";

/** Reserved: outside the /cached-splat/ namespace, so no id can collide with it. */
const INDEX_KEY = "/cached-splat-index";

/**
 * What one uncompressed PLY off KIRI weighs. The budget is stated in these so
 * the tradeoff reads as "four captures", not as a number of megabytes.
 */
const TYPICAL_SPLAT_BYTES = 110 * 1024 * 1024;

/**
 * A session shoots three or four videos, so that is the batch worth keeping
 * whole. Asking for more is a bluff: Chrome would likely grant a gigabyte out
 * of free disk, but Safari's per-origin allowance is far tighter, and the only
 * thing a budget larger than the browser's own buys is a QuotaExceededError we
 * have to swallow anyway. The byte budget is the real limit — the count only
 * caps how many entries we track when captures come in unusually small.
 */
const MAX_CACHED_SPLATS = 4;
const CACHE_BUDGET_BYTES = MAX_CACHED_SPLATS * TYPICAL_SPLAT_BYTES;

interface SplatRecord {
  bytes: number;
  /** A write counter, not a clock: ties under concurrent writes would make
   * "least recently written" ambiguous, and a clock that jumps would too. */
  seq: number;
}

interface SplatIndex {
  seq: number;
  entries: Record<string, SplatRecord>;
}

/** Cache Storage needs a secure context; localhost counts as one. */
function unavailable() {
  return typeof caches === "undefined";
}

function cacheKey(serialize: string) {
  return `/cached-splat/${encodeURIComponent(serialize)}`;
}

function emptyIndex(): SplatIndex {
  return { seq: 0, entries: {} };
}

/**
 * Every mutation runs to completion before the next one starts. Choosing what
 * to evict is a read of the index and cache.keys() followed by deletes, and two
 * of those interleaved would each drop what the other had just put — the race
 * that used to lose a capture outright. Awaiting the previous mutation makes
 * the whole read-decide-delete-put sequence indivisible within this tab.
 *
 * A second tab can still interleave, since Cache Storage offers no lock. The
 * worst that costs is a re-download: the index only ever names entries some tab
 * did write, a missing entry reads as a miss, and untracked bytes get swept.
 */
let mutations: Promise<unknown> = Promise.resolve();

function queued<T>(work: () => Promise<T>): Promise<T> {
  // then(work, work): one rejected mutation must not stall every later one.
  const done = mutations.then(work, work);
  mutations = done.catch(() => undefined);
  return done;
}

/**
 * Anything unexpected reads as "nothing is cached", which costs at most a
 * re-download. Trusting a damaged index would cost more: the budget is arithmetic
 * over these numbers, so one bad size either hoards disk or evicts everything.
 */
function parseIndex(raw: unknown): SplatIndex {
  if (!raw || typeof raw !== "object") return emptyIndex();
  const { seq, entries } = raw as Partial<SplatIndex>;
  if (!entries || typeof entries !== "object") return emptyIndex();

  const index = emptyIndex();
  index.seq = Number.isFinite(seq) ? Number(seq) : 0;
  for (const [serialize, record] of Object.entries(entries)) {
    const bytes = (record as Partial<SplatRecord> | null)?.bytes;
    const at = (record as Partial<SplatRecord> | null)?.seq;
    // A record with no size can never be budgeted, so it is not worth keeping.
    if (!Number.isFinite(bytes) || !Number.isFinite(at)) continue;
    if (Number(bytes) < 0) continue;
    index.entries[serialize] = { bytes: Number(bytes), seq: Number(at) };
    index.seq = Math.max(index.seq, Number(at));
  }
  return index;
}

async function readIndex(cache: Cache): Promise<SplatIndex> {
  try {
    const hit = await cache.match(INDEX_KEY);
    return hit ? parseIndex(await hit.json()) : emptyIndex();
  } catch {
    return emptyIndex(); // Unreadable index, so nothing is known to be cached.
  }
}

async function writeIndex(cache: Cache, index: SplatIndex) {
  await cache.put(
    INDEX_KEY,
    new Response(JSON.stringify(index), {
      headers: { "Content-Type": "application/json" },
    }),
  );
}

/**
 * Least-recently-written first, until the incoming blob fits. `keep` is the
 * capture this write exists to store, so it is never a candidate however old
 * its previous copy was — evicting it would send the caller straight back to
 * KIRI for bytes it is holding in memory right now.
 *
 * A single capture bigger than the whole budget empties the cache and stays
 * anyway: it is the one on screen, and the alternative is a cache that refuses
 * to hold anything.
 */
function planEvictions(index: SplatIndex, keep: string, incoming: number) {
  const others = Object.entries(index.entries)
    .filter(([serialize]) => serialize !== keep)
    .sort(([, a], [, b]) => a.seq - b.seq);

  let bytes = incoming + others.reduce((sum, [, record]) => sum + record.bytes, 0);
  let count = others.length + 1;

  const doomed: string[] = [];
  for (const [serialize, record] of others) {
    if (bytes <= CACHE_BUDGET_BYTES && count <= MAX_CACHED_SPLATS) break;
    doomed.push(serialize);
    bytes -= record.bytes;
    count -= 1;
  }
  return doomed;
}

/**
 * Blobs the index does not name: left by an older build, or by a write that
 * died between its put and its index update. Their size is unknowable, so they
 * can never be budgeted — dropping them is the only way to get the accounting
 * back in step with the disk.
 */
async function sweepUntracked(cache: Cache, index: SplatIndex, keep: string) {
  const live = [INDEX_KEY, cacheKey(keep), ...Object.keys(index.entries).map(cacheKey)];
  for (const request of await cache.keys()) {
    if (!live.some((key) => request.url.endsWith(key))) await cache.delete(request);
  }
}

/**
 * Drops a record whose blob has gone missing. It looks again from inside the
 * queue rather than trusting the read that noticed: a write of the same capture
 * can land in between, and forgetting the record then would leave real bytes
 * untracked — which the next write would sweep, undoing a download nobody asked
 * to repeat.
 */
function forgetMissing(serialize: string) {
  return queued(async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      if (await cache.match(cacheKey(serialize))) return;
      const index = await readIndex(cache);
      if (!index.entries[serialize]) return;
      delete index.entries[serialize];
      await writeIndex(cache, index);
    } catch {
      // A stale record costs one wasted lookup on the next read, nothing more.
    }
  });
}

export async function readCachedSplat(serialize: string): Promise<Blob | null> {
  if (unavailable()) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    // Reads go through the index rather than straight to the blob so there is
    // one story about what is cached: an entry with no record has no size on
    // record either, and would sit outside the budget forever. Reads do not
    // write the index back — recency is when a capture was stored, and a read
    // that took a lock would queue behind a 100 MB write for nothing.
    const index = await readIndex(cache);
    if (!index.entries[serialize]) return null;

    const hit = await cache.match(cacheKey(serialize));
    if (!hit) {
      // Index says yes, storage says no: the browser reclaimed it underneath us.
      void forgetMissing(serialize);
      return null;
    }
    return await hit.blob();
  } catch {
    return null; // A cache miss and a broken cache are the same to the caller.
  }
}

export async function writeCachedSplat(serialize: string, blob: Blob) {
  if (unavailable()) return;
  return queued(async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      const index = await readIndex(cache);

      // Room is made before asking for it: eviction is what the budget says to
      // do whether or not the put below then succeeds.
      for (const doomed of planEvictions(index, serialize, blob.size)) {
        delete index.entries[doomed];
        await cache.delete(cacheKey(doomed));
      }
      await sweepUntracked(cache, index, serialize);

      try {
        await cache.put(
          cacheKey(serialize),
          new Response(blob, {
            headers: { "Content-Type": "application/octet-stream" },
          }),
        );
        index.entries[serialize] = { bytes: blob.size, seq: ++index.seq };
      } catch {
        // QuotaExceededError: the browser is stingier than our budget. This
        // copy is simply not cached — evicting the sibling captures to force it
        // in is the behaviour this file just stopped doing. Drop whatever a
        // partial put left so the index never names bytes that are not there.
        delete index.entries[serialize];
        await cache.delete(cacheKey(serialize));
      }

      await writeIndex(cache, index);
    } catch {
      // Out of quota or storage denied — caching is an optimization, not the flow.
    }
  });
}

export async function dropCachedSplat(serialize: string) {
  if (unavailable()) return;
  return queued(async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.delete(cacheKey(serialize));
      const index = await readIndex(cache);
      delete index.entries[serialize];
      await writeIndex(cache, index);
    } catch {
      // Nothing to clean up, or nothing we can do about it.
    }
  });
}
