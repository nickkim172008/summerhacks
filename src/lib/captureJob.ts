import type { KiriStatus } from "./kiri";

/**
 * Reconstruction runs 30-90 minutes — far longer than anyone leaves a tab open
 * — so the job id is written to localStorage the moment KIRI accepts the upload
 * and the capture page picks it back up on the next visit.
 *
 * Everything past startedAt is optional and stays that way: a job written
 * before those fields existed is already sitting in someone's localStorage,
 * and it still has a splat coming.
 */
export interface CaptureJob {
  serialize: string;
  name: string;
  startedAt: number;
  /** Firebase Storage URL for the source walkthrough, if uploaded. */
  videoUrl?: string;
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
}

const STORAGE_KEY = "atlas:capture-job";

/**
 * Storage is the single source of truth for the running job, read through
 * useSyncExternalStore. The snapshot stays the raw string so repeated reads are
 * referentially stable, and `storage` events keep a second tab in step.
 */
const listeners = new Set<() => void>();

export function subscribeToJob(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function readJobSnapshot(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // Storage denied — capture still works, it just can't resume.
  }
}

export function parseJob(raw: string | null): CaptureJob | null {
  if (!raw) return null;
  try {
    const job = JSON.parse(raw) as CaptureJob;
    return job?.serialize ? job : null;
  } catch {
    return null; // Corrupt entry; start clean rather than blocking capture.
  }
}

export function saveJob(job: CaptureJob) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(job));
  } catch {
    // Private-mode failure only costs resumability, not the job itself.
  }
  listeners.forEach((listener) => listener());
}

export function clearJob() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to recover from; the page is already moving on.
  }
  listeners.forEach((listener) => listener());
}

/**
 * XHR rather than fetch: a walkthrough video is hundreds of megabytes and fetch
 * cannot report upload progress, so the whole send would look like a hang.
 * Resolves with KIRI's task id.
 */
export function uploadVideo(
  video: File,
  onProgress: (fraction: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("video", video);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/capture/submit");
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      const body = xhr.response ?? {};
      if (xhr.status >= 200 && xhr.status < 300 && body.serialize) {
        resolve(body.serialize as string);
      } else {
        reject(new Error(body.error ?? `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () =>
      reject(new Error("Upload failed — check your connection"));
    xhr.send(form);
  });
}

export interface StatusReport {
  status: KiriStatus;
  ready: boolean;
  failed: boolean;
}

export async function fetchStatus(serialize: string): Promise<StatusReport> {
  const res = await fetch(
    `/api/capture/status?serialize=${encodeURIComponent(serialize)}`,
  );
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Status check failed");
  return body as StatusReport;
}

/** The finished PLY, extracted server-side from KIRI's result zip. */
export async function fetchSplat(serialize: string): Promise<Blob> {
  const res = await fetch(
    `/api/capture/model?serialize=${encodeURIComponent(serialize)}`,
  );
  if (!res.ok) throw new Error((await res.json()).error ?? "Download failed");
  return res.blob();
}
