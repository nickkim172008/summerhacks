import type { KiriStatus } from "./kiri";

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
    xhr.onerror = () => reject(new Error("Upload failed — check your connection"));
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
