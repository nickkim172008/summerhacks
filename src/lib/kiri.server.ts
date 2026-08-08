import "server-only";
import { unzipSync } from "fflate";

const BASE = "https://api.kiriengine.app/api/v1/open";

export const MIN_IMAGES = 20;
export const MAX_IMAGES = 300;

/** https://docs.kiriengine.app/model/retrieve-3d-model-status */
export const KIRI_STATUS = {
  uploading: -1,
  processing: 0,
  failed: 1,
  successful: 2,
  queuing: 3,
  expired: 4,
} as const;

export type KiriStatus = (typeof KIRI_STATUS)[keyof typeof KIRI_STATUS];

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

/** Submits a photo set for Gaussian Splat reconstruction; returns the job id. */
export async function submitImages(images: File[]): Promise<string> {
  if (images.length < MIN_IMAGES || images.length > MAX_IMAGES) {
    throw new Error(
      `KIRI needs between ${MIN_IMAGES} and ${MAX_IMAGES} images, got ${images.length}`,
    );
  }
  const form = new FormData();
  for (const image of images) form.append("imagesFiles", image, image.name);

  const data = await kiriFetch<{ serialize: string; calculateType: number }>(
    "/3dgs/image",
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
