import "server-only";
import { unzipSync } from "fflate";
import type { KiriStatus } from "./kiri";

const BASE = "https://api.kiriengine.app/api/v1/open";

type KiriEnvelope<T> = { code: number; msg: string; data: T; ok: boolean };

/**
 * KIRI_API_KEY holds one key or several separated by commas. Several exist so a
 * batch of walkthroughs can outlast one account's credits: submission falls
 * through to the next key when the current one is spent.
 */
function apiKeys() {
  const keys = (process.env.KIRI_API_KEY ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  if (keys.length === 0) throw new Error("KIRI_API_KEY is not set");
  return keys;
}

/**
 * A reconstruction belongs to the account that started it, so status and
 * download have to come from the same key that submitted — ask with another and
 * the job simply does not exist. This remembers which key owns which task id.
 *
 * It is only a memo: a server restart empties it and `withOwner` falls back to
 * trying each key, which is also how a job started before this process began
 * gets adopted. Losing it costs requests, never correctness.
 */
const keyOfSerialize = new Map<string, number>();

/**
 * Out of credits, or a key that is no longer good. The HTTP status is the
 * trustworthy half; KIRI also states the reason in prose, so the message is
 * matched too — but only on words about the account.
 *
 * Deliberately narrow. "exceed" and "limit" read like credit trouble and are
 * really how a rejected video is described ("exceeds maximum duration"), and a
 * video one key refuses every key refuses: matching them sends the same doomed
 * upload to every account in turn, spending the whole batch's bandwidth to
 * arrive at the same answer.
 */
function spent(status: number, message: string) {
  if (status === 401 || status === 402 || status === 403 || status === 429) {
    return true;
  }
  return /credit|quota|balance|insufficient|expired|unauthor/i.test(message);
}

class KiriError extends Error {
  spent: boolean;
  constructor(message: string, spent: boolean) {
    super(message);
    this.spent = spent;
  }
}

async function kiriFetch<T>(
  path: string,
  key: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, ...init?.headers },
  });
  const body = readEnvelope<T>(await res.text(), res.status);
  if (!res.ok || !body.ok) {
    const message = body?.msg || `KIRI request failed (${res.status})`;
    throw new KiriError(message, spent(res.status, message));
  }
  return body.data;
}

/**
 * KIRI puts raw newlines inside the strings of its JSON, which is not legal and
 * which res.json() rejects — so a refused upload came back as "Bad control
 * character in string literal" and the reason it was refused never reached
 * anyone. Worse, the message is what decides whether a key is spent, so an
 * unparseable reply also cost the fall-through to the next key.
 *
 * The offending characters are escaped and it is read again. Text that still
 * will not parse is reported as itself, since at that point KIRI's own words
 * are more use than a parser's.
 */
function readEnvelope<T>(text: string, status: number): KiriEnvelope<T> {
  try {
    return JSON.parse(text) as KiriEnvelope<T>;
  } catch {
    try {
      return JSON.parse(escapeControlsInStrings(text)) as KiriEnvelope<T>;
    } catch {
      throw new KiriError(
        `KIRI answered with something unreadable (${status}): ${text.slice(0, 200)}`,
        false,
      );
    }
  }
}

/**
 * Only inside string literals: a newline between tokens is ordinary whitespace,
 * and escaping those would break a reply that is merely pretty-printed.
 */
function escapeControlsInStrings(text: string) {
  let out = "";
  let inString = false;
  let escaped = false;

  for (const character of text) {
    if (escaped) {
      out += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      out += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      out += character;
      continue;
    }
    const code = character.charCodeAt(0);
    out +=
      inString && code < 0x20
        ? `\\u${code.toString(16).padStart(4, "0")}`
        : character;
  }

  return out;
}

/**
 * Runs a call against the key that owns `serialize`, discovering it by trying
 * each in turn the first time. Only the answer from the owning account is
 * meaningful, so any error is worth moving past — the last one stands if no key
 * can answer.
 */
async function withOwner<T>(
  serialize: string,
  call: (key: string) => Promise<T>,
): Promise<T> {
  const keys = apiKeys();
  const known = keyOfSerialize.get(serialize);
  const order =
    known === undefined
      ? keys.map((_, index) => index)
      : [known, ...keys.map((_, index) => index).filter((i) => i !== known)];

  let last: unknown;
  for (const index of order) {
    try {
      const value = await call(keys[index]);
      keyOfSerialize.set(serialize, index);
      return value;
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("KIRI request failed");
}

/** Submits one walkthrough video for Gaussian Splat reconstruction. */
export async function submitVideo(video: File): Promise<string> {
  const form = new FormData();
  form.append("videoFile", video, video.name);
  // Both flags are documented as required. We only want the splat, and masking
  // would need per-frame subject selection this flow does not collect.
  form.append("isMesh", "0");
  form.append("isMask", "0");

  const keys = apiKeys();
  let last: unknown;
  for (const [index, key] of keys.entries()) {
    try {
      const data = await kiriFetch<{
        serialize: string;
        calculateType: number;
      }>("/3dgs/video", key, { method: "POST", body: form });
      keyOfSerialize.set(data.serialize, index);
      return data.serialize;
    } catch (error) {
      // A spent key is worth stepping past; a rejected video would be rejected
      // by every key, so it fails here rather than being uploaded N more times.
      if (!(error instanceof KiriError) || !error.spent) throw error;
      last = error;
    }
  }
  throw last instanceof Error
    ? new Error(`Every KIRI key is out of credit (${last.message})`)
    : new Error("Every KIRI key is out of credit");
}

export async function getStatus(serialize: string): Promise<KiriStatus> {
  const data = await withOwner(serialize, (key) =>
    kiriFetch<{ serialize: string; status: KiriStatus }>(
      `/model/getStatus?serialize=${encodeURIComponent(serialize)}`,
      key,
    ),
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
  const { modelUrl } = await withOwner(serialize, (key) =>
    kiriFetch<{ modelUrl: string; serialize: string }>(
      `/model/getModelZip?serialize=${encodeURIComponent(serialize)}`,
      key,
    ),
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
