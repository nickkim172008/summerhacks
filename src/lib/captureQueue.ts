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
/**
 * Everything past startedAt is optional and stays that way: a job written
 * before those fields existed is already sitting in someone's localStorage,
 * and it still has a splat coming.
 */
export interface CaptureJob {
  serialize: string;
  name: string;
  startedAt: number;
  albumId?: string;
  /**
   * When and where the walkthrough was filmed, read out of the video or typed
   * in when it carried neither. The form is long gone by the time the splat
   * lands, so the answers wait here with the job.
   */
  capturedAt?: string;
  location?: { lat: number; lng: number };
  locationName?: string;
  /**
   * Length of the audio lifted off the video. The samples themselves are
   * megabytes and live in Cache Storage under the same serialize.
   */
  audioSeconds?: number;
  /**
   * Why KIRI gave up on this walkthrough. Persisted because the verdict is
   * final — the same task id asked again returns the same answer — and a
   * failure held only in memory came back looking like a fresh job on reload,
   * polling its way round to the same refusal a interval later.
   */
  failed?: string;
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
  const record = value as Record<string, unknown>;
  const { serialize, name, startedAt } = record;
  if (typeof serialize !== "string" || !serialize) return null;
  if (typeof name !== "string") return null;
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return null;

  // Only the three identifying fields can void a job. The rest carry what the
  // capture form collected — where it was filmed, how long its audio runs —
  // which the splat still needs on arrival, hours after that form is gone. They
  // are copied across one at a time because rebuilding the object from a fixed
  // list is what silently drops a field the moment a new one is added.
  const job: CaptureJob = { serialize, name, startedAt };
  if (typeof record.albumId === "string") job.albumId = record.albumId;
  if (typeof record.capturedAt === "string") job.capturedAt = record.capturedAt;
  if (typeof record.locationName === "string") {
    job.locationName = record.locationName;
  }
  if (typeof record.failed === "string") job.failed = record.failed;
  if (
    typeof record.audioSeconds === "number" &&
    Number.isFinite(record.audioSeconds)
  ) {
    job.audioSeconds = record.audioSeconds;
  }
  const location = toLocation(record.location);
  if (location) job.location = location;
  return job;
}

function toLocation(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const { lat, lng } = value as Record<string, unknown>;
  if (typeof lat !== "number" || !Number.isFinite(lat)) return null;
  if (typeof lng !== "number" || !Number.isFinite(lng)) return null;
  return { lat, lng };
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
