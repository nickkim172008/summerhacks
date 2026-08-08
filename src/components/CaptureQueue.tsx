"use client";

import Link from "next/link";
import { KIRI_STATUS_LABEL } from "@/lib/kiri";
import {
  isDetailable,
  isRetryable,
  type CaptureItem,
  type CapturePhase,
  type Provenance,
} from "@/lib/captureRunner";

interface CaptureQueueProps {
  items: CaptureItem[];
  previewId: string | null;
  /** Ticks slowly at the page level so N rows share one clock, not N timers. */
  now: number;
  albumId: string | null;
  canSave: boolean;
  onRename: (id: string, name: string) => void;
  onWhenChange: (id: string, whenLocal: string) => void;
  onLocationName: (id: string, locationName: string) => void;
  onPreview: (id: string) => void;
  onSave: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}

export default function CaptureQueue(props: CaptureQueueProps) {
  if (props.items.length === 0) return null;
  return (
    <ul className="mt-8 flex flex-col gap-3">
      {props.items.map((item) => (
        <CaptureRow key={item.id} item={item} {...props} />
      ))}
    </ul>
  );
}

function CaptureRow({
  item,
  previewId,
  now,
  albumId,
  canSave,
  onRename,
  onWhenChange,
  onLocationName,
  onPreview,
  onSave,
  onRetry,
  onRemove,
}: CaptureQueueProps & { item: CaptureItem }) {
  const previewing = previewId === item.id;
  const editing = isDetailable(item.phase);
  // Once the answers are committed they stop being fields and become a line of
  // text, which is also all a resumed row has ever had of them.
  const summary = editing ? "" : describeDetails(item);
  return (
    <li
      className={`rounded-2xl border px-4 py-3.5 transition ${
        previewing
          ? "border-[#0071e3] bg-[#0071e3]/[0.04]"
          : "border-black/10 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {isNameable(item.phase) ? (
            <input
              value={item.name}
              onChange={(e) => onRename(item.id, e.target.value)}
              placeholder="What is this place called?"
              aria-label="Environment name"
              className="w-full rounded-lg border border-transparent bg-neutral-50 px-2.5 py-1.5 text-[15px] font-medium outline-none focus:border-[#0071e3]"
            />
          ) : (
            <p className="truncate px-0.5 text-[15px] font-medium">
              {item.name || "Untitled"}
            </p>
          )}
          <p
            className={`mt-1.5 px-0.5 text-sm ${
              item.phase === "blocked" ? "text-amber-600" : "text-neutral-500"
            }`}
          >
            {describePhase(item)}
          </p>
          {item.phase === "waiting" && item.startedAt !== null && (
            <p className="mt-0.5 px-0.5 text-xs text-neutral-400">
              {describeWait(item.startedAt, now)}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <RowActions
            item={item}
            previewing={previewing}
            albumId={albumId}
            canSave={canSave}
            onPreview={onPreview}
            onSave={onSave}
            onRetry={onRetry}
            onRemove={onRemove}
          />
        </div>
      </div>

      {editing && item.phase !== "blocked" && (
        <section className="mt-3 flex flex-col gap-3 rounded-xl border border-black/10 px-3.5 py-3">
          <p className="text-xs text-neutral-500">
            Kept with the environment. Anything the video did not carry is yours
            to correct, fill in, or leave blank.
          </p>

          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2 text-[13px] text-neutral-500">
              Filmed
              <Source from={item.whenFrom} />
            </span>
            <input
              type="datetime-local"
              value={item.whenLocal}
              onChange={(e) => onWhenChange(item.id, e.target.value)}
              className="rounded-lg border border-black/10 bg-neutral-50 px-3 py-2 text-[15px] outline-none focus:border-[#0071e3]"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2 text-[13px] text-neutral-500">
              Location
              <Source from={item.location ? "video" : "none"} />
            </span>
            {item.location && (
              <span className="text-[15px] tabular-nums">
                {formatCoords(item.location)}
              </span>
            )}
            <input
              value={item.locationName}
              onChange={(e) => onLocationName(item.id, e.target.value)}
              placeholder={
                item.location
                  ? "Name it in words too, like Grandma's kitchen"
                  : "Where was this? Type it in"
              }
              className="rounded-lg border border-black/10 bg-neutral-50 px-3 py-2 text-[15px] outline-none focus:border-[#0071e3]"
            />
          </label>

          <p className="text-sm text-neutral-500">{describeAudio(item.audio)}</p>
        </section>
      )}

      {summary && (
        <p className="mt-2 px-0.5 text-xs text-neutral-400">{summary}</p>
      )}

      <Progress item={item} />
      {item.error && <p className="mt-2.5 text-sm text-red-500">{item.error}</p>}
    </li>
  );
}

/**
 * Which answers came off the video, which are only a guess, and which the user
 * owes us. The middle one is worth being loud about: it looks filled in whether
 * or not it is right.
 */
function Source({ from }: { from: Provenance }) {
  if (from === "video") {
    return (
      <span className="rounded-full bg-[#0071e3]/10 px-2 py-0.5 text-[11px] font-medium text-[#0071e3]">
        From the video
      </span>
    );
  }
  if (from === "file") {
    return (
      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700">
        Guessed from the file — check it
      </span>
    );
  }
  return null;
}

function describeAudio(audio: CaptureItem["audio"]) {
  if (audio === undefined) return "Lifting the sound off the video…";
  if (!audio) return "No sound this browser could read off this video.";
  return `${formatClock(audio.seconds)} of sound, which plays when you walk in.`;
}

function RowActions({
  item,
  previewing,
  albumId,
  canSave,
  onPreview,
  onSave,
  onRetry,
  onRemove,
}: {
  item: CaptureItem;
  previewing: boolean;
  albumId: string | null;
  canSave: boolean;
  onPreview: (id: string) => void;
  onSave: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const hasSplat = item.splat !== null;
  return (
    <>
      {hasSplat && !previewing && (
        <button
          onClick={() => onPreview(item.id)}
          className="rounded-full border border-black/10 px-4 py-1.5 text-[13px] transition hover:bg-neutral-50"
        >
          Preview
        </button>
      )}
      {item.phase === "previewable" && (
        <button
          onClick={() => onSave(item.id)}
          disabled={!canSave}
          className="rounded-full bg-[#0071e3] px-4 py-1.5 text-[13px] font-medium text-white transition hover:bg-[#0077ed] disabled:opacity-40"
        >
          {albumId ? "Add to Album" : "Save"}
        </button>
      )}
      {item.phase === "saved" && item.placeId && (
        <Link
          href={`/place/${item.placeId}`}
          className="rounded-full border border-black/10 px-4 py-1.5 text-[13px] text-[#0071e3] transition hover:bg-neutral-50"
        >
          Open
        </Link>
      )}
      {item.splat && (
        <a
          href={item.splat.url}
          download={item.splat.file.name}
          className="px-1 text-[13px] text-[#0071e3]"
        >
          .ply
        </a>
      )}
      {isRetryable(item) && (
        <button
          onClick={() => onRetry(item.id)}
          className="rounded-full bg-[#0071e3] px-4 py-1.5 text-[13px] font-medium text-white transition hover:bg-[#0077ed]"
        >
          Try Again
        </button>
      )}
      <button
        onClick={() => onRemove(item.id)}
        aria-label={`Remove ${item.name || "this capture"}`}
        className="px-1.5 text-[15px] leading-none text-neutral-400 transition hover:text-red-500"
      >
        ×
      </button>
    </>
  );
}

function Progress({ item }: { item: CaptureItem }) {
  if (item.phase === "uploading") {
    return (
      <div className="mt-3 overflow-hidden rounded-full bg-neutral-100">
        <div
          className="h-1.5 rounded-full bg-[#0071e3] transition-[width]"
          style={{ width: `${Math.round(item.uploadFraction * 100)}%` }}
        />
      </div>
    );
  }
  // Reconstruction reports no percentage of its own, and a bar frozen at zero
  // for an hour reads as broken, so these stages get motion instead of a number.
  if (INDETERMINATE.has(item.phase)) {
    return (
      <div className="mt-3 overflow-hidden rounded-full bg-neutral-100">
        <div className="h-1.5 w-1/3 animate-pulse rounded-full bg-[#0071e3]" />
      </div>
    );
  }
  return null;
}

const INDETERMINATE = new Set<CapturePhase>([
  "checking",
  "waiting",
  "downloading",
  "saving",
]);

function isNameable(phase: CapturePhase) {
  return phase === "checking" || phase === "ready-to-upload" || phase === "blocked";
}

function describePhase(item: CaptureItem) {
  switch (item.phase) {
    case "checking":
      return item.file ? "Checking the video…" : "Looking for a local copy…";
    case "blocked":
      return item.problem ?? "This video can't be used";
    case "ready-to-upload":
      return item.meta
        ? `${item.meta.width}×${item.meta.height}, ${item.meta.seconds.toFixed(0)}s — ready`
        : "Ready";
    case "uploading":
      // Only two videos upload at a time, so the rest sit at zero and deserve to
      // be told they are queued rather than looking stalled.
      return item.uploadFraction > 0
        ? `Uploading ${Math.round(item.uploadFraction * 100)}%`
        : "Waiting for an upload slot…";
    case "waiting":
      if (item.demo) return "Queued for reconstruction";
      return item.status === null
        ? "Checking on it…"
        : `${KIRI_STATUS_LABEL[item.status]}.`;
    case "downloading":
      return "Downloading your environment…";
    case "previewable":
      return "Ready to save";
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "failed":
      return item.fatal ? "Stopped" : "Something went wrong";
  }
}

function describeWait(startedAt: number, now: number) {
  const minutes = Math.floor((now - startedAt) / 60_000);
  if (minutes < 1) return "Just started.";
  return `Waiting ${minutes} minute${minutes === 1 ? "" : "s"} so far.`;
}

/**
 * The committed answers as one line. A row that has spent its details — and a
 * row resumed from storage, which never had the fields — both show this instead
 * of the editor, so what was saved with the capture stays visible.
 */
function describeDetails(item: CaptureItem) {
  const parts: string[] = [];
  if (item.capturedAt) parts.push(`Filmed ${formatWhen(item.capturedAt)}`);
  const where =
    item.locationName.trim() ||
    (item.location ? formatCoords(item.location) : "");
  if (where) parts.push(where);
  const seconds = item.audio?.seconds ?? item.audioSeconds;
  if (seconds) parts.push(`${formatClock(seconds)} of sound`);
  return parts.join(" · ");
}

function formatWhen(iso: string) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Five decimals is about a metre — past that it is noise from the phone. */
function formatCoords({ lat, lng }: { lat: number; lng: number }) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function formatClock(seconds: number) {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
