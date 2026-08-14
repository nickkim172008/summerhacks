/**
 * Constants shared by the capture UI and the server-side World Labs client.
 * They live apart from worldlabs.server.ts for the same reason kiri.ts lives
 * apart from kiri.server.ts: importing them into a client component can never
 * drag the API key into the browser bundle.
 *
 * Everything here was confirmed against the live API rather than read off the
 * docs, which disagree with it in a few places noted below.
 */

/**
 * https://docs.worldlabs.ai/marble/models
 *
 * The exact strings the generate endpoint accepts. The API is FastAPI-backed
 * and answers an unknown model with a 422 enumerating the literals, which is
 * how these were confirmed; it also still accepts three legacy display names
 * ("Marble 0.1-mini" and friends) that are not worth carrying.
 */
export const WORLDLABS_MODELS = {
  draft: "marble-1.0-draft",
  legacy: "marble-1.0",
  standard: "marble-1.1",
  plus: "marble-1.1-plus",
} as const;

export type WorldLabsModel =
  (typeof WORLDLABS_MODELS)[keyof typeof WORLDLABS_MODELS];

/**
 * What a generation costs, for the estimate a capture row shows before anyone
 * spends anything. Credits sell at 1,250 to the US dollar, so `standard` is
 * about $1.20 and `draft` about 12 cents.
 *
 * Two things make this a floor rather than a quote. `plus` grows the world when
 * the scene calls for it, billing 300 more per extra "dynamic cube" up to five.
 * And a generation is billed per stage, not per world: a text prompt is charged
 * 80 for the panorama it has to imagine first, on top of the world itself — a
 * draft from text came back at 230, not 150. Video carries its own views in, so
 * that line item should be absent, but the reply is what settles the bill and
 * `cost.line_items` on the finished operation is where it is itemised.
 */
export const WORLDLABS_CREDITS: Record<WorldLabsModel, number> = {
  [WORLDLABS_MODELS.draft]: 150,
  [WORLDLABS_MODELS.legacy]: 1500,
  [WORLDLABS_MODELS.standard]: 1500,
  [WORLDLABS_MODELS.plus]: 1500,
};

export const CREDITS_PER_USD = 1250;

/**
 * What a walkthrough has to be for the reconstruction to hold together.
 * https://docs.worldlabs.ai/marble/create/prompt-guides/video-prompt
 *
 * Unlike KIRI, World Labs publishes no hard duration or frame-size ceiling —
 * this is quality guidance, not limits the API enforces, so none of it can
 * stand in for the pre-flight check that keeps a bad file from costing credits.
 * Where the real edges are is still an open question.
 */
/**
 * The one hard limit found so far, and it is not in the docs: the signed upload
 * URL comes back carrying `x-goog-content-length-range: 0,104857600`, so
 * storage refuses anything past 100 MB before generation is ever reached.
 *
 * Worth checking before the upload rather than after — the failure otherwise
 * arrives from Google Cloud Storage as a bare 4xx, having already spent the
 * bandwidth of the whole file.
 */
export const MAX_UPLOAD_BYTES = 104857600;

export const VIDEO_GUIDANCE = [
  "Sweep 180°–360° of the space in one unbroken take",
  "Move steadily — motion blur comes back as smeared geometry",
  "Lock focal length and exposure; a zoom or an auto-brightness shift mid-take confuses depth",
  "Keep the room still: the model reconstructs static scenes best",
] as const;

/**
 * How long an operation stays addressable. The reply to `:generate` announces
 * an hour, and the finished operation announces three from the same start — the
 * window extends on completion, so the hour is the pessimistic one to plan
 * against. Either way a capture resumed from localStorage after a long-closed
 * tab can find its operation gone; the world outlives it and is fetched by
 * world id, which is why the job stores that as soon as it is known.
 */
export const OPERATION_TTL_MS = 60 * 60 * 1000;

/**
 * Roughly how long a generation runs, for the progress copy on a capture row.
 * The docs say about five minutes across the board; a draft from text finished
 * in 27 seconds. Treat five as the ceiling for the heavier models until a real
 * video run says otherwise.
 */
export const TYPICAL_GENERATION_MS = 5 * 60 * 1000;

/**
 * Splat detail comes back at three sizes, keyed exactly as below — the docs
 * call the largest "full" and the API calls it `full_res`.
 *
 * `500k` is the one to store. It lands at 5.6 MB, which is within a rounding
 * error of the 4.9 MB a KIRI room already costs, so nothing downstream has to
 * change. `full_res` is 2.3M splats and 24.9 MB — five times the payload, on a
 * feed that mounts live scenes while you scroll and on phones that have to pull
 * them over cell service.
 */
export const SPLAT_RESOLUTIONS = ["100k", "500k", "full_res"] as const;

export type SplatResolution = (typeof SPLAT_RESOLUTIONS)[number];

/** What a place is saved at, absent a reason to pick another. */
export const DEFAULT_SPLAT_RESOLUTION: SplatResolution = "500k";
