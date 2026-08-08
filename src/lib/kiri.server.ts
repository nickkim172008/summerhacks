import "server-only";
import { unzipSync } from "fflate";
import type { KiriStatus } from "./kiri";

const BASE = "https://api.kiriengine.app/api/v1/open";

type KiriEnvelope<T> = { code: number; msg: string; data: T; ok: boolean };

function apiKey() {
  const key = process.env.KIRI_API_KEY;
  if (!key) throw new Error("KIRI_API_KEY is not set");
  return key;
}

async function kiriFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey()}`, ...init?.headers },
  });
  const body = (await res.json()) as KiriEnvelope<T>;
  if (!res.ok || !body.ok) {
    throw new Error(body?.msg || `KIRI request failed (${res.status})`);
  }
  return body.data;
}

/** Submits one walkthrough video for Gaussian Splat reconstruction. */
export async function submitVideo(video: File): Promise<string> {
  const form = new FormData();
  form.append("videoFile", video, video.name);
  // Both flags are documented as required. We only want the splat, and masking
  // would need per-frame subject selection this flow does not collect.
  form.append("isMesh", "0");
  form.append("isMask", "0");

  const data = await kiriFetch<{ serialize: string; calculateType: number }>(
    "/3dgs/video",
    { method: "POST", body: form },
  );
  return data.serialize;
}

export async function getStatus(serialize: string): Promise<KiriStatus> {
  const data = await kiriFetch<{ serialize: string; status: KiriStatus }>(
    `/model/getStatus?serialize=${encodeURIComponent(serialize)}`,
  );
  return data.status;
}

/**
 * KIRI hands back a zip; Spark needs the PLY inside it. The archive's manifest
 * is undocumented, so pick the PLY out by extension rather than a fixed name.
 */
export async function fetchSplatPly(
  serialize: string,
): Promise<{ name: string; bytes: Uint8Array }> {
  const { modelUrl } = await kiriFetch<{ modelUrl: string; serialize: string }>(
    `/model/getModelZip?serialize=${encodeURIComponent(serialize)}`,
  );

  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`Could not download model zip (${res.status})`);

  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const entry = Object.entries(files).find(([name]) =>
    name.toLowerCase().endsWith(".ply"),
  );
  if (!entry) {
    throw new Error(
      `No .ply in KIRI archive (contains: ${Object.keys(files).join(", ")})`,
    );
  }
  return { name: entry[0], bytes: entry[1] };
}
