#!/usr/bin/env node
/**
 * Test script for World Labs' Marble world-generation API.
 * Uploads a walkthrough, polls until generation completes, and downloads the
 * splat — the same three steps the app's /capture page would drive.
 *
 * Standing alongside scripts/kiri_3dgs.py rather than replacing it: the point
 * is to put a Marble world and a KIRI reconstruction of the same walkthrough
 * side by side before any of the app moves over.
 *
 * Needs no dependencies — Node's own fetch. WORLDLABS_API_KEY is read from the
 * environment, falling back to .env.local.
 *
 * Usage:
 *     node scripts/worldlabs.mjs --credits
 *     node scripts/worldlabs.mjs --video path/to/walkthrough.mp4
 *     node scripts/worldlabs.mjs --video walk.mp4 --model marble-1.0-draft
 *     node scripts/worldlabs.mjs --operation OPERATION_ID   # resume a poll
 *     node scripts/worldlabs.mjs --world WORLD_ID           # download again
 *     node scripts/worldlabs.mjs --list                     # what has been made
 *     node scripts/worldlabs.mjs --restore                  # re-download it all
 *
 * Splats land in public/dev-splats/, which /dev can be pointed at.
 *
 * Every run is recorded in worldlabs-runs.json beside this file, and that is
 * the part worth keeping: the splats are megabytes of binary that git should
 * never carry, while a world stays on World Labs' CDN and costs nothing to
 * fetch again. Losing public/dev-splats/ is a `--restore` away; losing the
 * manifest means paying 1,500 credits a second time to learn the same thing.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://api.worldlabs.ai/marble/v1";
const OUT_DIR = "public/dev-splats";
// fileURLToPath, not URL#pathname: the checkout lives under a directory with a
// space in its name, and pathname hands back the percent-encoded form.
const MANIFEST = fileURLToPath(new URL("worldlabs-runs.json", import.meta.url));

const MODELS = [
  "marble-1.0-draft",
  "marble-1.0",
  "marble-1.1",
  "marble-1.1-plus",
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[name] = next;
      i += 1;
    } else {
      args[name] = true;
    }
  }
  return args;
}

/** The key from the environment, falling back to the app's .env.local. */
async function loadApiKey() {
  if (process.env.WORLDLABS_API_KEY) return process.env.WORLDLABS_API_KEY.trim();
  try {
    const text = await readFile(".env.local", "utf8");
    for (const line of text.split("\n")) {
      const match = line.match(/^\s*WORLDLABS_API_KEY\s*=\s*(.*)$/);
      if (match) return match[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env.local is normal outside the app checkout.
  }
  fail("WORLDLABS_API_KEY is not set (environment or .env.local)");
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

let API_KEY;
/** What the last polled operation was billed, for the manifest row. */
let lastCost = null;

async function call(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "WLT-Api-Key": API_KEY,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON; the status line is all there is to report.
  }
  if (!res.ok) {
    const detail = body?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((d) => `${(d.loc ?? []).join(".")}: ${d.msg}`).join("; ")
          : `${res.status} ${res.statusText}`;
    fail(message);
  }
  return body;
}

async function showCredits() {
  const { remaining_credits: credits } = await call("/credits", {
    method: "GET",
  });
  console.log(
    `  ${credits.toLocaleString()} credits (~$${(credits / 1250).toFixed(2)})`,
  );
  return credits;
}

/** prepare_upload → PUT the bytes → generate. Returns the operation id. */
async function submitVideo(path, model, displayName) {
  const bytes = await readFile(path);
  const name = basename(path);
  const extension = extname(path).slice(1).toLowerCase() || "mp4";

  // The signed upload URL caps at 100 MB; catching it here saves sending the
  // whole file only to be refused by storage.
  if (bytes.length > 104857600) {
    fail(`${name} is ${(bytes.length / 1e6).toFixed(0)} MB; the limit is 100 MB`);
  }

  console.log(`  Uploading ${name} (${(bytes.length / 1e6).toFixed(1)} MB)…`);
  const prepared = await call("/media-assets:prepare_upload", {
    method: "POST",
    body: JSON.stringify({ file_name: name, kind: "video", extension }),
  });

  // Straight to Google Cloud Storage — no API key, and `required_headers` sent
  // exactly as given: the signed URL covers x-goog-content-length-range, and
  // GCS refuses the PUT without it.
  const info = prepared.upload_info;
  const upload = await fetch(info.upload_url, {
    method: info.upload_method ?? "PUT",
    body: bytes,
    headers: { ...info.required_headers },
  });
  if (!upload.ok) fail(`Upload failed (${upload.status} ${upload.statusText})`);

  console.log(`  Generating with ${model}…`);
  const operation = await call("/worlds:generate", {
    method: "POST",
    body: JSON.stringify({
      model,
      display_name: displayName ?? name,
      world_prompt: {
        type: "video",
        video_prompt: {
          source: "media_asset",
          media_asset_id: prepared.media_asset.media_asset_id,
        },
      },
    }),
  });

  console.log(`  Operation ${operation.operation_id}`);
  return operation.operation_id;
}

/** Polls until `done`. Resumable: the operation id is all it needs. */
async function pollOperation(operationId) {
  const started = Date.now();
  let last = "";
  for (;;) {
    const operation = await call(
      `/operations/${encodeURIComponent(operationId)}`,
      { method: "GET" },
    );
    const status = operation.metadata?.progress?.status ?? "…";
    const elapsed = Math.round((Date.now() - started) / 1000);
    if (status !== last) {
      console.log(`  ${status} (${elapsed}s)`);
      last = status;
    }
    if (operation.done) {
      if (operation.error) fail(`Generation failed: ${JSON.stringify(operation.error)}`);
      if (operation.cost) {
        const items = operation.cost.line_items
          .map((item) => `${item.name} ${item.credits}`)
          .join(", ");
        console.log(
          `  Cost ${operation.cost.total_credits} credits (${items})`,
        );
        // Stashed for the manifest: only the operation knows what was billed,
        // and by download() time it is out of reach.
        lastCost = operation.cost;
      }
      return operation.response ?? (await getWorld(operation.metadata.world_id));
    }
    // The operation's own expiry, not a number picked here. Generation time
    // scales with the length of the walkthrough — a 30s clip lands in about
    // 350s and a 132s one runs past 20 minutes — so any fixed ceiling is a
    // guess that eventually abandons a job the API is still working on and
    // has already charged for.
    const expiresAt = Date.parse(operation.expires_at ?? "");
    if (Number.isFinite(expiresAt) && Date.now() > expiresAt) {
      fail(
        `Operation expired at ${operation.expires_at}. ` +
          `If it finished first, fetch it with --world ${operation.metadata?.world_id ?? "<world id>"}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function getWorld(worldId) {
  return call(`/worlds/${encodeURIComponent(worldId)}`, { method: "GET" });
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST, "utf8"));
  } catch {
    return { runs: [] }; // First run, or someone deleted it.
  }
}

/**
 * Records what a world was made from and what it cost. Keyed by world id, so
 * re-downloading an existing world updates its row rather than adding another.
 */
async function recordRun(world, extra = {}) {
  const manifest = await readManifest();
  const existing = manifest.runs.findIndex((r) => r.world_id === world.world_id);
  const row = {
    world_id: world.world_id,
    display_name: world.display_name ?? null,
    model: world.model ?? null,
    marble_url: world.world_marble_url ?? null,
    semantics_metadata: world.assets?.splats?.semantics_metadata ?? null,
    collider_mesh_url: world.assets?.mesh?.collider_mesh_url ?? null,
    caption: world.assets?.caption ?? null,
    recorded_at: new Date().toISOString(),
    ...(existing >= 0 ? manifest.runs[existing] : {}),
    ...extra,
  };
  // The freshly-read fields win over whatever the old row held; only the
  // details this run cannot know (source video, cost) survive from before.
  Object.assign(row, {
    display_name: world.display_name ?? row.display_name,
    semantics_metadata:
      world.assets?.splats?.semantics_metadata ?? row.semantics_metadata,
  });

  if (existing >= 0) manifest.runs[existing] = row;
  else manifest.runs.push(row);

  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  return row;
}

async function listRuns() {
  const { runs } = await readManifest();
  if (runs.length === 0) return console.log("  No runs recorded yet.");
  for (const run of runs) {
    const scale = run.semantics_metadata;
    console.log(
      `\n  ${run.display_name ?? "(unnamed)"}  ${run.model ?? "?"}\n` +
        `    world   ${run.world_id}\n` +
        `    source  ${run.source_video ?? "?"}${run.credits ? `  (${run.credits} credits)` : ""}\n` +
        `    scale   ${scale ? `x${scale.metric_scale_factor?.toFixed(3)}  ground ${scale.ground_plane_offset?.toFixed(3)}` : "none"}`,
    );
  }
  console.log(`\n  ${runs.length} world(s). --restore re-downloads them all.`);
}

/** Pulls every recorded world back down, for a machine that has none of them. */
async function restoreAll(resolution) {
  const { runs } = await readManifest();
  if (runs.length === 0) return console.log("  Nothing recorded to restore.");
  for (const run of runs) {
    console.log(`\n  ${run.display_name ?? run.world_id}`);
    try {
      await download(await getWorld(run.world_id), resolution, {
        record: false,
      });
    } catch (error) {
      console.error(`  ! ${run.world_id}: ${error?.message ?? error}`);
    }
  }
}

/**
 * Downloads the splat and thumbnail. The CDN serves both without the API key,
 * so these are plain fetches.
 */
async function download(world, resolution, { record = true, extra = {} } = {}) {
  await mkdir(OUT_DIR, { recursive: true });
  const urls = world.assets?.splats?.spz_urls ?? {};
  const url = urls[resolution] ?? urls["500k"] ?? Object.values(urls)[0];
  if (!url) fail("This world came back with no splat");

  const res = await fetch(url);
  if (!res.ok) fail(`Could not download the splat (${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const file = join(OUT_DIR, `${world.world_id}.spz`);
  await writeFile(file, bytes);

  console.log(`\n  Splat   ${file} (${(bytes.length / 1e6).toFixed(1)} MB, ${resolution})`);

  if (world.assets?.thumbnail_url) {
    const thumb = await fetch(world.assets.thumbnail_url);
    if (thumb.ok) {
      const thumbFile = join(OUT_DIR, `${world.world_id}.webp`);
      await writeFile(thumbFile, Buffer.from(await thumb.arrayBuffer()));
      console.log(`  Thumb   ${thumbFile}`);
    }
  }

  console.log(`  Serve   /dev-splats/${world.world_id}.spz`);
  if (world.world_marble_url) console.log(`  Marble  ${world.world_marble_url}`);
  if (world.assets?.mesh?.collider_mesh_url) {
    console.log(`  Collider ${world.assets.mesh.collider_mesh_url}`);
  }
  if (world.assets?.caption) {
    console.log(`\n  Caption: ${world.assets.caption.slice(0, 200)}…`);
  }

  if (record) {
    await recordRun(world, {
      splat_bytes: bytes.length,
      resolution,
      ...extra,
    });
    console.log(`  Recorded in scripts/worldlabs-runs.json`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  API_KEY = await loadApiKey();
  const resolution = typeof args.res === "string" ? args.res : "500k";

  if (args.credits) {
    await showCredits();
    return;
  }

  if (args.list) {
    await listRuns();
    return;
  }

  if (args.restore) {
    await restoreAll(resolution);
    return;
  }

  let world;
  let sourceVideo;
  if (typeof args.world === "string") {
    world = await getWorld(args.world);
  } else if (typeof args.operation === "string") {
    world = await pollOperation(args.operation);
  } else if (typeof args.video === "string") {
    sourceVideo = basename(args.video);
    const model = typeof args.model === "string" ? args.model : "marble-1.1";
    if (!MODELS.includes(model)) {
      fail(`Unknown model "${model}". One of: ${MODELS.join(", ")}`);
    }
    await showCredits();
    const operationId = await submitVideo(
      args.video,
      model,
      typeof args.name === "string" ? args.name : undefined,
    );
    world = await pollOperation(operationId);
  } else {
    fail(
      "Nothing to do. Pass --video PATH, --operation ID, --world ID, or --credits",
    );
  }

  await download(world, resolution, {
    extra: {
      ...(sourceVideo ? { source_video: sourceVideo } : {}),
      ...(lastCost
        ? { credits: lastCost.total_credits, cost_line_items: lastCost.line_items }
        : {}),
    },
  });
}

main().catch((error) => fail(error?.message ?? String(error)));
