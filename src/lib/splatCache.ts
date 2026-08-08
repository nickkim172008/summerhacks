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
 * Each kind gets its own cache so pruning one never takes the other half of the
 * same job with it. Within a cache, "keep only the newest" was affordable while
 * one capture ran at a time; with several running side by side it made every
 * finishing job delete the ones beside it. Each cache instead keeps the most
 * recently written few under a byte budget, evicting least-recently-written
 * first.
 *
 * Cache Storage reports neither the size nor the age of what it holds, so both
 * live in an index kept in the cache beside the blobs — same storage, so a
 * browser reclaiming the cache takes the index with it instead of leaving it
 * describing bytes that are gone. That index is the record of what is cached:
 * blobs it does not name are untracked, and a write sweeps them.
 */
const MiB = 1024 * 1024;

/**
 * What one uncompressed PLY off KIRI weighs, and how many are worth keeping.
 * Six, to match the batch a session actually queues: any capture past the limit
 * is evicted and has to come back down from KIRI, so a cache shallower than the
 * queue quietly re-downloads a hundred megabytes on the next reload.
 *
 * Stating the budget as a product makes the tradeoff read as "six captures"
 * rather than as a number of megabytes. Six is close to the honest ceiling —
 * Chrome grants this out of free disk, Safari's per-origin allowance is far
 * tighter and will simply decline the tail, which costs a re-download and
 * nothing worse. Much past this is a bluff: a budget beyond the browser's own
 * buys only a QuotaExceededError we have to swallow anyway.
 */
const TYPICAL_SPLAT_BYTES = 110 * MiB;
const MAX_CACHED_SPLATS = 6;

/**
 * Audio is orders of magnitude smaller — mono 22.05 kHz for at most three
 * minutes — so more of it is kept than splats, deliberately. A track is written
 * when its video is picked and read when its splat lands an hour or more later,
 * so it has to outlive a queue that may have moved well past four captures by
 * then.
 */
const TYPICAL_AUDIO_BYTES = 12 * MiB;
const MAX_CACHED_AUDIO = 8;

interface CacheRecord {
  bytes: number;
  /**
   * A write counter, not a clock: ties under concurrent writes would make
   * "least recently written" ambiguous, and a clock that jumps would too.
   */
  seq: number;
}

interface CacheIndex {
  seq: number;
  entries: Record<string, CacheRecord>;
}

interface Store {
  cacheName: string;
  keyPrefix: string;
  /** Reserved: outside the entry prefix, so no id can collide with it. */
  indexKey: string;
  budgetBytes: number;
  maxEntries: number;
  /**
   * Every mutation on a store runs to completion before the next one starts.
   * Choosing what to evict is a read of the index and cache.keys() followed by
   * deletes, and two of those interleaved would each drop what the other had
   * just put — the race that used to lose a capture outright. Awaiting the
   * previous mutation makes the whole read-decide-delete-put sequence
   * indivisible within this tab. The chain is per store because a 100 MB splat
   * write has no reason to hold up a two-megabyte audio one.
   *
   * A second tab can still interleave, since Cache Storage offers no lock. The
   * worst that costs is a re-download: the index only ever names entries some
   * tab did write, a missing entry reads as a miss, and untracked bytes get
   * swept.
   */
  mutations: Promise<unknown>;
}

const SPLATS: Store = {
  cacheName: "atlas-splats-v1",
  keyPrefix: "/cached-splat/",
  indexKey: "/cached-splat-index",
  budgetBytes: MAX_CACHED_SPLATS * TYPICAL_SPLAT_BYTES,
  maxEntries: MAX_CACHED_SPLATS,
  mutations: Promise.resolve(),
};

const AUDIO: Store = {
  cacheName: "atlas-capture-audio-v1",
  keyPrefix: "/cached-audio/",
  indexKey: "/cached-audio-index",
  budgetBytes: MAX_CACHED_AUDIO * TYPICAL_AUDIO_BYTES,
  maxEntries: MAX_CACHED_AUDIO,
  mutations: Promise.resolve(),
};

/** Cache Storage needs a secure context; localhost counts as one. */
function unavailable() {
  return typeof caches === "undefined";
}

/** encodeURIComponent escapes "/", so no id can forge the index key. */
function entryKey(store: Store, serialize: string) {
  return `${store.keyPrefix}${encodeURIComponent(serialize)}`;
}

function emptyIndex(): CacheIndex {
  return { seq: 0, entries: {} };
}

function queued<T>(store: Store, work: () => Promise<T>): Promise<T> {
  // then(work, work): one rejected mutation must not stall every later one.
  const done = store.mutations.then(work, work);
  store.mutations = done.catch(() => undefined);
  return done;
}

/**
 * Anything unexpected reads as "nothing is cached", which costs at most a
 * re-download. Trusting a damaged index would cost more: the budget is
 * arithmetic over these numbers, so one bad size either hoards disk or evicts
 * everything.
 */
function parseIndex(raw: unknown): CacheIndex {
  if (!raw || typeof raw !== "object") return emptyIndex();
  const { seq, entries } = raw as Partial<CacheIndex>;
  if (!entries || typeof entries !== "object") return emptyIndex();

  const index = emptyIndex();
  index.seq = Number.isFinite(seq) ? Number(seq) : 0;
  for (const [serialize, record] of Object.entries(entries)) {
    const bytes = (record as Partial<CacheRecord> | null)?.bytes;
    const at = (record as Partial<CacheRecord> | null)?.seq;
    // A record with no size can never be budgeted, so it is not worth keeping.
    if (!Number.isFinite(bytes) || !Number.isFinite(at)) continue;
    if (Number(bytes) < 0) continue;
    index.entries[serialize] = { bytes: Number(bytes), seq: Number(at) };
    index.seq = Math.max(index.seq, Number(at));
  }
  return index;
}

async function readIndex(store: Store, cache: Cache): Promise<CacheIndex> {
  try {
    const hit = await cache.match(store.indexKey);
    return hit ? parseIndex(await hit.json()) : emptyIndex();
  } catch {
    return emptyIndex(); // Unreadable index, so nothing is known to be cached.
  }
}

async function writeIndex(store: Store, cache: Cache, index: CacheIndex) {
  await cache.put(
    store.indexKey,
    new Response(JSON.stringify(index), {
      headers: { "Content-Type": "application/json" },
    }),
  );
}

/**
 * Least-recently-written first, until the incoming blob fits. `keep` is the
 * entry this write exists to store, so it is never a candidate however old its
 * previous copy was — evicting it would send the caller straight back to KIRI
 * for bytes it is holding in memory right now.
 *
 * A single entry bigger than the whole budget empties the store and stays
 * anyway: it is the one on screen, and the alternative is a cache that refuses
 * to hold anything.
 */
function planEvictions(
  store: Store,
  index: CacheIndex,
  keep: string,
  incoming: number,
) {
  const others = Object.entries(index.entries)
    .filter(([serialize]) => serialize !== keep)
    .sort(([, a], [, b]) => a.seq - b.seq);

  let bytes =
    incoming + others.reduce((sum, [, record]) => sum + record.bytes, 0);
  let count = others.length + 1;

  const doomed: string[] = [];
  for (const [serialize, record] of others) {
    if (bytes <= store.budgetBytes && count <= store.maxEntries) break;
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
async function sweepUntracked(
  store: Store,
  cache: Cache,
  index: CacheIndex,
  keep: string,
) {
  const live = [
    store.indexKey,
    entryKey(store, keep),
    ...Object.keys(index.entries).map((id) => entryKey(store, id)),
  ];
  for (const request of await cache.keys()) {
    if (!live.some((key) => request.url.endsWith(key))) {
      await cache.delete(request);
    }
  }
}

/**
 * Drops a record whose blob has gone missing. It looks again from inside the
 * queue rather than trusting the read that noticed: a write of the same entry
 * can land in between, and forgetting the record then would leave real bytes
 * untracked — which the next write would sweep, undoing a download nobody asked
 * to repeat.
 */
function forgetMissing(store: Store, serialize: string) {
  return queued(store, async () => {
    try {
      const cache = await caches.open(store.cacheName);
      if (await cache.match(entryKey(store, serialize))) return;
      const index = await readIndex(store, cache);
      if (!index.entries[serialize]) return;
      delete index.entries[serialize];
      await writeIndex(store, cache, index);
    } catch {
      // A stale record costs one wasted lookup on the next read, nothing more.
    }
  });
}

async function read(store: Store, serialize: string): Promise<Blob | null> {
  if (unavailable()) return null;
  try {
    const cache = await caches.open(store.cacheName);
    // Reads go through the index rather than straight to the blob so there is
    // one story about what is cached: an entry with no record has no size on
    // record either, and would sit outside the budget forever. Reads do not
    // write the index back — recency is when an entry was stored, and a read
    // that took a lock would queue behind a 100 MB write for nothing.
    const index = await readIndex(store, cache);
    if (!index.entries[serialize]) return null;

    const hit = await cache.match(entryKey(store, serialize));
    if (!hit) {
      // Index says yes, storage says no: the browser reclaimed it underneath us.
      void forgetMissing(store, serialize);
      return null;
    }
    return await hit.blob();
  } catch {
    return null; // A cache miss and a broken cache are the same to the caller.
  }
}

async function write(store: Store, serialize: string, blob: Blob) {
  if (unavailable()) return;
  return queued(store, async () => {
    try {
      const cache = await caches.open(store.cacheName);
      const index = await readIndex(store, cache);

      // Room is made before asking for it: eviction is what the budget says to
      // do whether or not the put below then succeeds.
      for (const doomed of planEvictions(store, index, serialize, blob.size)) {
        delete index.entries[doomed];
        await cache.delete(entryKey(store, doomed));
      }
      await sweepUntracked(store, cache, index, serialize);

      try {
        await cache.put(
          entryKey(store, serialize),
          new Response(blob, {
            headers: {
              "Content-Type": blob.type || "application/octet-stream",
            },
          }),
        );
        index.entries[serialize] = { bytes: blob.size, seq: ++index.seq };
      } catch {
        // QuotaExceededError: the browser is stingier than our budget. This
        // copy is simply not cached — evicting the siblings to force it in is
        // the behaviour this file exists to stop. Drop whatever a partial put
        // left so the index never names bytes that are not there.
        delete index.entries[serialize];
        await cache.delete(entryKey(store, serialize));
      }

      await writeIndex(store, cache, index);
    } catch {
      // Out of quota or storage denied — caching is an optimization, not the flow.
    }
  });
}

async function drop(store: Store, serialize: string) {
  if (unavailable()) return;
  return queued(store, async () => {
    try {
      const cache = await caches.open(store.cacheName);
      await cache.delete(entryKey(store, serialize));
      const index = await readIndex(store, cache);
      delete index.entries[serialize];
      await writeIndex(store, cache, index);
    } catch {
      // Nothing to clean up, or nothing we can do about it.
    }
  });
}

export function readCachedSplat(serialize: string) {
  return read(SPLATS, serialize);
}

export function writeCachedSplat(serialize: string, blob: Blob) {
  return write(SPLATS, serialize, blob);
}

export function dropCachedSplat(serialize: string) {
  return drop(SPLATS, serialize);
}

export function readCachedAudio(serialize: string) {
  return read(AUDIO, serialize);
}

export function writeCachedAudio(serialize: string, blob: Blob) {
  return write(AUDIO, serialize, blob);
}

export function dropCachedAudio(serialize: string) {
  return drop(AUDIO, serialize);
}
