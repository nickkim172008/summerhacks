/**
 * Reconstruction runs 30-90 minutes — far longer than anyone leaves a tab open
 * — so every job id is written to localStorage the moment KIRI accepts its
 * upload, and the capture page picks the whole set back up on the next visit.
 *
 * Storage is the single source of truth, read through useSyncExternalStore. The
 * snapshot stays the raw string: parsing here would hand back a fresh array on
 * every read and re-render forever, so callers parse it in a useMemo instead.
 * `storage` events keep a second tab in step.
 */
export interface CaptureJob {
  serialize: string;
  name: string;
  startedAt: number;
  albumId?: string;
}

const STORAGE_KEY = "atlas:capture-jobs";
/** Builds before multi-capture kept one job, unwrapped, under this key. */
const LEGACY_KEY = "atlas:capture-job";

const EMPTY = "{}";

const listeners = new Set<() => void>();

export function subscribeToJobs(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function readJobsSnapshot(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? migrateLegacyJob();
  } catch {
    return EMPTY; // Storage denied — capture still works, it just can't resume.
  }
}

export function listJobs(): CaptureJob[] {
  return parseJobs(readJobsSnapshot());
}

export function parseJobs(raw: string | null): CaptureJob[] {
  if (!raw) return [];
  const parsed = safeParse(raw);
  // Arrays and primitives are shapes this module never writes, so there is
  // nothing in them worth salvaging.
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  return Object.values(parsed as Record<string, unknown>)
    .map(toJob)
    .filter((job): job is CaptureJob => job !== null)
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function saveJob(job: CaptureJob) {
  const byId = indexJobs(listJobs());
  byId[job.serialize] = job; // The KIRI task id is the identity: upsert on it.
  write(byId);
}

export function removeJob(serialize: string) {
  const byId = indexJobs(listJobs());
  delete byId[serialize];
  write(byId);
}

export function clearJobs() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to recover from; the page is already moving on.
  }
  notify();
}

/**
 * Someone mid-reconstruction when they load a newer build has the only copy of
 * their task id under the old key — losing it is losing the capture, which is
 * the whole reason the id is persisted.
 */
function migrateLegacyJob(): string {
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy === null) return EMPTY;
  const job = toJob(safeParse(legacy));
  if (!job) {
    localStorage.removeItem(LEGACY_KEY);
    return EMPTY;
  }
  const raw = JSON.stringify({ [job.serialize]: job });
  // Dropping the old key only after the new one is written: a write that
  // throws leaves the job where the next read still finds it.
  localStorage.setItem(STORAGE_KEY, raw);
  localStorage.removeItem(LEGACY_KEY);
  return raw;
}

/**
 * A job missing any of its identifying fields is dropped rather than repaired
 * or thrown over — one corrupt entry must not cost the others their ids.
 */
function toJob(value: unknown): CaptureJob | null {
  if (!value || typeof value !== "object") return null;
  const { serialize, name, startedAt, albumId } = value as Record<
    string,
    unknown
  >;
  if (typeof serialize !== "string" || !serialize) return null;
  if (typeof name !== "string") return null;
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return null;
  return typeof albumId === "string"
    ? { serialize, name, startedAt, albumId }
    : { serialize, name, startedAt };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null; // Corrupt entry; start clean rather than blocking capture.
  }
}

function indexJobs(jobs: CaptureJob[]): Record<string, CaptureJob> {
  return Object.fromEntries(jobs.map((job) => [job.serialize, job]));
}

function write(byId: Record<string, CaptureJob>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byId));
  } catch {
    // Private-mode failure only costs resumability, not the jobs themselves.
  }
  notify();
}

function notify() {
  listeners.forEach((listener) => listener());
}
