import "server-only";
import {
  DEFAULT_SPLAT_RESOLUTION,
  MAX_UPLOAD_BYTES,
  WORLDLABS_MODELS,
  type SplatResolution,
  type WorldLabsModel,
} from "./worldlabs";

const BASE = "https://api.worldlabs.ai/marble/v1";

/**
 * One key, unlike KIRI. The pooling and per-job key ownership on that side
 * exists because a reconstruction belongs to the account that started it and a
 * batch can outlast one account's credits; World Labs bills a single balance
 * and answers for any world on the key that made it, so none of that applies.
 */
function apiKey() {
  const key = process.env.WORLDLABS_API_KEY?.trim();
  if (!key) throw new Error("WORLDLABS_API_KEY is not set");
  return key;
}

/**
 * Observed on the wire rather than documented, so the union stays open: a
 * status this does not name should read as "still working", never crash a poll.
 */
export type OperationStatus =
  | "SUCCEEDED"
  | "FAILED"
  | "IN_PROGRESS"
  | (string & {});

export type WorldAssets = {
  mesh: {
    /** Walkable collision geometry. Always present. */
    collider_mesh_url: string | null;
    /** Both null until asked for through `:export`. */
    hq_mesh_url: string | null;
    full_res_mesh_url: string | null;
  };
  imagery: { pano_url: string | null };
  splats: {
    spz_urls: Partial<Record<SplatResolution, string>>;
    semantics_metadata: unknown | null;
  };
  thumbnail_url: string | null;
  /** A written description of the scene, generated alongside it. */
  caption: string | null;
};

export type World = {
  world_id: string;
  display_name: string | null;
  assets: WorldAssets;
  created_at: string | null;
  world_marble_url: string | null;
  permission: {
    public: boolean;
    allowed_readers: string[];
    allowed_writers: string[];
    allow_id_access: boolean;
  } | null;
};

export type Operation = {
  operation_id: string;
  done: boolean;
  error: unknown | null;
  created_at: string;
  expires_at: string;
  metadata: {
    progress?: { status: OperationStatus; description?: string };
    world_id?: string;
    /** The model as the API names it back, e.g. "marble-1.1". */
    public_model_name?: string;
  } | null;
  response: World | null;
  cost: {
    total_credits: number;
    line_items: { name: string; credits: number }[];
  } | null;
};

/**
 * Errors arrive as FastAPI's `detail`, which is a plain string for a refusal
 * and an array of per-field objects when the body failed validation. Both are
 * flattened to one line, because what reaches a capture row is a sentence.
 */
function describe(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        const entry = item as { loc?: unknown[]; msg?: string };
        const where = Array.isArray(entry.loc) ? entry.loc.join(".") : "";
        return [where, entry.msg].filter(Boolean).join(": ");
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join("; ");
  }
  return `World Labs request failed (${status})`;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "WLT-Api-Key": apiKey(),
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body is an error page or nothing; `describe` falls back to the
    // status, which is the only honest thing left to say about it.
  }
  if (!res.ok) throw new Error(describe(res.status, body));
  return body as T;
}

/** Credits left on the key, for the estimate shown before a capture is sent. */
export async function remainingCredits(): Promise<number> {
  const body = await call<{ remaining_credits: number }>("/credits", {
    method: "GET",
  });
  return body.remaining_credits;
}

/**
 * Hands the walkthrough to World Labs and returns the operation to poll.
 *
 * The upload is its own round trip: `prepare_upload` answers with a signed URL
 * on their storage, the bytes go straight there, and generation refers to the
 * asset by id. That is three requests where KIRI took one multipart POST, but
 * it is the half that lets the video bypass this process — `/api/capture/submit`
 * currently buffers the whole file to rebuild a multipart body, which is the
 * thing the README flags as needing to stream if the size limit ever rises.
 */
export async function submitVideo(
  video: File,
  {
    model = WORLDLABS_MODELS.standard,
    displayName,
    textPrompt,
  }: {
    model?: WorldLabsModel;
    displayName?: string;
    textPrompt?: string;
  } = {},
): Promise<string> {
  if (video.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `This walkthrough is ${(video.size / 1e6).toFixed(0)} MB; the limit is 100 MB`,
    );
  }

  const extension = video.name.split(".").pop()?.toLowerCase() || "mp4";

  const prepared = await call<{
    media_asset: { media_asset_id: string };
    upload_info: {
      upload_url: string;
      upload_method?: string;
      required_headers?: Record<string, string>;
    };
  }>("/media-assets:prepare_upload", {
    method: "POST",
    body: JSON.stringify({
      file_name: video.name,
      kind: "video",
      extension,
    }),
  });

  const { upload_url: uploadUrl, upload_method: method, required_headers: required } =
    prepared.upload_info;

  // Straight to Google Cloud Storage, not through the API host — so no API key
  // here. `required_headers` is not decoration: the signed URL carries
  // `x-goog-content-length-range`, and GCS refuses the PUT without it. Sent as
  // given, and nothing added — a Content-Type the signature did not cover is
  // another way to be turned away.
  const upload = await fetch(uploadUrl, {
    method: method ?? "PUT",
    body: video,
    headers: { ...required },
  });
  if (!upload.ok) {
    throw new Error(
      `Could not upload the walkthrough (${upload.status} ${upload.statusText})`,
    );
  }

  const operation = await call<Operation>("/worlds:generate", {
    method: "POST",
    body: JSON.stringify({
      model,
      ...(displayName ? { display_name: displayName } : {}),
      world_prompt: {
        type: "video",
        video_prompt: {
          source: "media_asset",
          media_asset_id: prepared.media_asset.media_asset_id,
        },
        // Optional, and left off unless a caller has something to say: the
        // scene is what the video shows, and a stray prompt is a chance for the
        // model to invent away from it.
        ...(textPrompt ? { text_prompt: textPrompt } : {}),
      },
    }),
  });

  return operation.operation_id;
}

export async function getOperation(operationId: string): Promise<Operation> {
  return call<Operation>(`/operations/${encodeURIComponent(operationId)}`, {
    method: "GET",
  });
}

/**
 * The finished operation carries the world inline, but this is the way to it
 * once the operation has expired — and it answers with more: the panorama, the
 * full thumbnail, and the expanded prompt the model actually worked from.
 */
export async function getWorld(worldId: string): Promise<World> {
  return call<World>(`/worlds/${encodeURIComponent(worldId)}`, {
    method: "GET",
  });
}

/**
 * The stored splat for a finished world.
 *
 * `500k` rather than `full_res` by default — see the note in worldlabs.ts; the
 * largest tier is five times the bytes for detail a phone on cell service never
 * resolves. The CDN serves these without the API key, so nothing has to be
 * proxied through this origin the way `/api/places/asset` proxies Storage.
 */
export async function fetchSplat(
  world: World,
  resolution: SplatResolution = DEFAULT_SPLAT_RESOLUTION,
): Promise<{ name: string; bytes: Uint8Array }> {
  const url =
    world.assets.splats.spz_urls[resolution] ??
    world.assets.splats.spz_urls[DEFAULT_SPLAT_RESOLUTION] ??
    Object.values(world.assets.splats.spz_urls)[0];
  if (!url) throw new Error("This world came back with no splat");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the splat (${res.status})`);

  return {
    name: `${world.world_id}.spz`,
    bytes: new Uint8Array(await res.arrayBuffer()),
  };
}
