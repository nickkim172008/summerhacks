import type { CaptureStatus, WorldLabsCapture } from "./captureStatus";
import type { CaptureBackend } from "./captureBackend";

/** One definition of the job shape, declared next to the storage that owns it. */
export type { CaptureJob } from "./captureQueue";

/**
 * XHR rather than fetch: a walkthrough video is hundreds of megabytes and fetch
 * cannot report upload progress, so the whole send would look like a hang.
 * Resolves with KIRI's task id.
 */
export function uploadVideo(
  video: File,
  onProgress: (fraction: number) => void,
  backend?: CaptureBackend,
): Promise<{ serialize: string; backend: CaptureBackend }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("video", video);
    if (backend) form.append("backend", backend);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/capture/submit");
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      const body = xhr.response ?? {};
      if (xhr.status >= 200 && xhr.status < 300 && body.serialize) {
        // The reply says which service actually took it, which is what every
        // later call about this job has to be addressed to.
        resolve({
          serialize: body.serialize as string,
          backend: (body.backend ?? "worldlabs") as CaptureBackend,
        });
      } else {
        reject(new Error(body.error ?? `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () =>
      reject(new Error("Upload failed. Check your connection."));
    xhr.send(form);
  });
}

export interface StatusReport {
  status: CaptureStatus;
  ready: boolean;
  failed: boolean;
  /** Why it failed, when it did — including that the credits are spent. */
  error?: string;
  /** Present once ready: what the world is, beyond its splat. */
  world?: WorldLabsCapture;
}

export async function fetchStatus(
  serialize: string,
  backend?: CaptureBackend | null,
): Promise<StatusReport> {
  const res = await fetch(
    `/api/capture/status?serialize=${encodeURIComponent(serialize)}` +
      (backend ? `&backend=${backend}` : ""),
  );
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Status check failed");
  return body as StatusReport;
}

/**
 * The finished splat, already SPZ — World Labs stores it that way, so nothing
 * transcodes it on arrival any more.
 *
 * Prefers the world id when the job has one: an operation stops being
 * addressable three hours after it starts, and a capture left overnight would
 * otherwise come back to a job that has aged out while its world is still there.
 */
export async function fetchSplat(
  serialize: string,
  worldId?: string | null,
  backend?: CaptureBackend | null,
): Promise<Blob> {
  // The world id is a World Labs idea; KIRI only ever knows its task id.
  const query =
    worldId && backend !== "kiri"
      ? `world=${encodeURIComponent(worldId)}`
      : `serialize=${encodeURIComponent(serialize)}`;
  const res = await fetch(
    `/api/capture/model?${query}` + (backend ? `&backend=${backend}` : ""),
  );
  if (!res.ok) throw new Error((await res.json()).error ?? "Download failed");
  return res.blob();
}
