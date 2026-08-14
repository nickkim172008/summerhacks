"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { CAPTURE_STATUS_LABEL } from "@/lib/captureStatus";
import {
  isDetailable,
  isRetryable,
  type CaptureItem,
  type CapturePhase,
  type Provenance,
} from "@/lib/captureRunner";

/**
 * How the queue draws itself. "rows" is the capture form's wide list; "tiles"
 * is the album's square white cell, so a capture still reconstructing sits in
 * the places grid beside the places that finished rather than in a list of its
 * own underneath it. Nothing but the layout differs — every phase, field,
 * action and guard below is shared.
 */
export type QueueLayout = "rows" | "tiles";

interface CaptureQueueProps {
  items: CaptureItem[];
  previewId: string | null;
  /** Ticks slowly at the page level so N rows share one clock, not N timers. */
  now: number;
  albumId: string | null;
  canSave: boolean;
  /** Whether anything in the queue is actually startable, from `canStart()`. */
  canStart: boolean;
  layout?: QueueLayout;
  onRename: (id: string, name: string) => void;
  onWhenChange: (id: string, whenLocal: string) => void;
  onLocationName: (id: string, locationName: string) => void;
  onPreview: (id: string) => void;
  onStart: () => void;
  onSave: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}

const MICRO =
  "text-[11px] font-semibold uppercase leading-3 tracking-[0.12em] text-[#6B7178]";
const CHIP =
  "shrink-0 rounded-full px-[11px] py-[5px] text-[11px] font-semibold uppercase leading-3 tracking-[0.08em]";
const CHIP_NEUTRAL = "bg-[rgba(20,22,26,0.05)] text-[#4A4F57]";
const CHIP_ACCENT = "bg-[rgba(0,113,227,0.08)] text-[#0071E3]";
const CHIP_DANGER = "bg-[rgba(192,54,44,0.08)] text-[#C0362C]";
/* Not a token of its own: the one warning colour in the system, used for an
   answer that looks filled in whether or not it is right. */
const CHIP_AMBER = "bg-[rgba(138,90,18,0.1)] text-[#8A5A12]";

const PILL = "flex h-[34px] items-center rounded-full text-[14px] font-medium";
const PILL_WHITE = `${PILL} border border-[rgba(20,22,26,0.14)] bg-white px-4 text-[#14161A] transition hover:bg-[#FAF9F7]`;
const PILL_INK = `${PILL} bg-[#14161A] px-[18px] text-white transition hover:bg-[#2A2E35] disabled:opacity-40`;
/* The one accent action on this screen: a capture that reconstructed and is
   waiting to become a place. */
const PILL_ACCENT = `${PILL} bg-[#0071E3] px-[18px] text-white shadow-[0_6px_18px_-8px_rgba(0,113,227,0.8)] transition hover:bg-[#0077ED] disabled:opacity-40 disabled:shadow-none`;

const FIELD =
  "w-full rounded-[10px] border border-[rgba(20,22,26,0.12)] bg-[#FAF9F7] px-3 py-2 text-[14px] text-[#14161A] outline-none transition placeholder:text-[#8A9098] focus:border-[#0071E3]";

export default function CaptureQueue(props: CaptureQueueProps) {
  if (props.items.length === 0) return null;
  const tiles = props.layout === "tiles";
  return (
    <ul
      className={
        tiles
          ? "mt-6 grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 md:grid-cols-4"
          : "mt-4 flex flex-col gap-3"
      }
    >
      {props.items.map((item) => (
        <CaptureRow key={item.id} item={item} {...props} />
      ))}
    </ul>
  );
}

function CaptureRow({
  item,
  layout,
  previewId,
  now,
  albumId,
  canSave,
  canStart,
  onRename,
  onWhenChange,
  onLocationName,
  onPreview,
  onStart,
  onSave,
  onRetry,
  onRemove,
}: CaptureQueueProps & { item: CaptureItem }) {
  const previewing = previewId === item.id;
  const editing = isDetailable(item.phase);
  // Once the answers are committed they stop being fields and become a line of
  // text, which is also all a resumed row has ever had of them.
  const summary = editing ? "" : describeDetails(item);
  const posterUrl = usePosterUrl(item.poster);
  const chip = phaseChip(item);

  const title = isNameable(item.phase) ? (
    <input
      value={item.name}
      onChange={(e) => onRename(item.id, e.target.value)}
      placeholder="What is this place called?"
      aria-label="Place name"
      // A title that happens to be editable, not a form control that happens to
      // hold a title: no chrome until it is focused.
      className="-ml-2 w-[calc(100%+8px)] rounded-lg border border-transparent bg-transparent px-2 py-1 font-display text-[20px] tracking-[-0.01em] text-[#14161A] outline-none transition placeholder:text-[#8A9098] focus:border-[rgba(20,22,26,0.14)]"
    />
  ) : (
    <p className="truncate font-display text-[20px] leading-[26px] tracking-[-0.01em] text-[#14161A]">
      {item.name || "Untitled"}
    </p>
  );

  const status = (
    <>
      <p
        className={`text-[13px] leading-[18px] tabular-nums ${
          item.phase === "failed"
            ? "text-[#C0362C]"
            : item.phase === "blocked"
              ? "text-[#8A5A12]"
              : "text-[#6B7178]"
        }`}
      >
        {describePhase(item)}
      </p>
      {item.phase === "waiting" && item.startedAt !== null && (
        <p className="mt-0.5 text-[12px] leading-[16px] tabular-nums text-[#6B7178]">
          {describeWait(item.startedAt, now)}
        </p>
      )}
    </>
  );

  const actions = (
    <RowActions
      item={item}
      previewing={previewing}
      albumId={albumId}
      canSave={canSave}
      canStart={canStart}
      onPreview={onPreview}
      onStart={onStart}
      onSave={onSave}
      onRetry={onRetry}
      onRemove={onRemove}
    />
  );

  const body = (
    <>
      {editing && item.phase !== "blocked" && (
        <Details
          item={item}
          onWhenChange={onWhenChange}
          onLocationName={onLocationName}
        />
      )}

      {summary && (
        <p className="mt-2 text-[12px] leading-[16px] tabular-nums text-[#6B7178]">
          {summary}
        </p>
      )}

      <Progress item={item} className="mt-3" />

      {item.error && (
        <p className="mt-2.5 text-[13px] leading-[18px] text-[#C0362C]">
          {item.error}
        </p>
      )}
    </>
  );

  if (layout === "tiles") {
    return (
      <li className="flex min-w-0 flex-col gap-2.5">
        <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[14px] border border-[rgba(20,22,26,0.09)] bg-white">
          {posterUrl && (
            <span
              aria-hidden
              className="absolute inset-0 bg-cover bg-center opacity-60"
              style={{ backgroundImage: `url(${posterUrl})` }}
            />
          )}
          <div className="relative flex flex-col items-center gap-2.5 px-4 text-center">
            {/* The one thing on this screen that moves on its own, and it stops
                under prefers-reduced-motion because .atlas-pulse does. */}
            {working(item.phase) && (
              <span
                aria-hidden
                className="atlas-pulse h-[34px] w-[34px] rounded-full border-2 border-[rgba(20,22,26,0.1)] border-t-[#4A4F57]"
              />
            )}
            {chip && (
              <span className={`${CHIP} ${chip.className}`}>{chip.label}</span>
            )}
          </div>
        </div>
        <div className="min-w-0">
          {title}
          <div className="mt-0.5">{status}</div>
          {body}
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </li>
    );
  }

  return (
    <li
      className={`rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(20,22,26,0.04)] transition ${
        item.phase === "failed"
          ? "border-[rgba(192,54,44,0.3)]"
          : previewing
            ? "border-[rgba(20,22,26,0.24)]"
            : "border-[rgba(20,22,26,0.09)]"
      }`}
    >
      <div className="flex gap-4">
        <div
          aria-hidden
          className="h-[88px] w-[88px] shrink-0 rounded-xl bg-cover bg-center"
          style={{
            backgroundImage: posterUrl
              ? `url(${posterUrl})`
              : gradientFor(item.serialize ?? item.id),
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {title}
              <div className="mt-1">{status}</div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {chip && (
                <span className={`${CHIP} ${chip.className}`}>{chip.label}</span>
              )}
              {actions}
            </div>
          </div>
          {body}
        </div>
      </div>
    </li>
  );
}

/**
 * A frame off the walkthrough, once one has been grabbed. Held as a Blob by the
 * queue — it is the Place's thumbnail-to-be, not a picture the row was given —
 * so the row mints a URL for the life of the render and hands it back after.
 */
function usePosterUrl(poster: Blob | null | undefined) {
  const url = useMemo(
    () => (poster ? URL.createObjectURL(poster) : null),
    [poster],
  );
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);
  return url;
}

/* A row with no frame yet still needs to look like something. The colour is a
   hash of the job id, so a capture keeps the same one across a reload. */
const GRADIENTS = [
  "linear-gradient(140deg,#8FB6D9,#5F6FA8)",
  "linear-gradient(140deg,#E3C58F,#C78A54)",
  "linear-gradient(140deg,#8EC3AC,#4C8478)",
  "linear-gradient(140deg,#D9A1A8,#A3607A)",
  "linear-gradient(140deg,#A89ECD,#6B5F9C)",
  "linear-gradient(140deg,#8FC6D4,#4B7EA6)",
];

function gradientFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

/** The phase in one word, for the chip. `previewable` says it with its buttons. */
function phaseChip(item: CaptureItem): { label: string; className: string } | null {
  switch (item.phase) {
    case "checking":
      return { label: "Checking", className: CHIP_NEUTRAL };
    case "ready-to-upload":
      return { label: "Ready", className: CHIP_ACCENT };
    case "blocked":
      return { label: "Can't use", className: CHIP_AMBER };
    case "uploading":
      return { label: "Uploading", className: CHIP_NEUTRAL };
    case "waiting":
      return { label: "Reconstructing", className: CHIP_NEUTRAL };
    case "downloading":
      return { label: "Downloading", className: CHIP_NEUTRAL };
    case "saving":
      return { label: "Saving", className: CHIP_NEUTRAL };
    case "saved":
      return { label: "Saved", className: CHIP_NEUTRAL };
    case "failed":
      return { label: "Failed", className: CHIP_DANGER };
    case "previewable":
      return null;
  }
}

function Details({
  item,
  onWhenChange,
  onLocationName,
}: {
  item: CaptureItem;
  onWhenChange: (id: string, whenLocal: string) => void;
  onLocationName: (id: string, locationName: string) => void;
}) {
  return (
    <section className="mt-3.5 flex flex-col gap-2.5">
      <p className="text-[12px] leading-[16px] text-[#6B7178]">
        Kept with the place. Anything the video did not carry is yours to
        correct, fill in, or leave blank.
      </p>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className={MICRO}>Filmed</span>
            <Source from={item.whenFrom} />
          </span>
          <input
            type="datetime-local"
            value={item.whenLocal}
            onChange={(e) => onWhenChange(item.id, e.target.value)}
            className={`${FIELD} tabular-nums`}
          />
        </label>

        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className={MICRO}>Where</span>
            <Source from={item.location ? "video" : "none"} />
          </span>
          <input
            value={item.locationName}
            onChange={(e) => onLocationName(item.id, e.target.value)}
            placeholder={
              item.location
                ? "Name it in words too, like Grandma's kitchen"
                : "Where was this? Type it in"
            }
            className={FIELD}
          />
          {item.location && (
            <span className="text-[12px] leading-[16px] tabular-nums text-[#6B7178]">
              {formatCoords(item.location)}
            </span>
          )}
        </label>
      </div>

      <span className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border border-[rgba(20,22,26,0.1)] px-2.5 py-1 text-[12px] leading-[16px] text-[#4A4F57]">
        <svg
          viewBox="0 0 24 24"
          className="h-[11px] w-[11px] shrink-0"
          fill="currentColor"
          aria-hidden
        >
          <path d="M4 9v6h4l5 4V5L8 9H4Z" />
        </svg>
        {describeAudio(item.audio)}
      </span>
    </section>
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
      <span className={`${CHIP} ${CHIP_ACCENT}`}>From the video</span>
    );
  }
  if (from === "file") {
    return (
      <span className={`${CHIP} ${CHIP_AMBER}`}>
        Guessed from the file, check it
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
  canStart,
  onPreview,
  onStart,
  onSave,
  onRetry,
  onRemove,
}: {
  item: CaptureItem;
  previewing: boolean;
  albumId: string | null;
  canSave: boolean;
  canStart: boolean;
  onPreview: (id: string) => void;
  onStart: () => void;
  onSave: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const hasSplat = item.splat !== null;
  return (
    <>
      {/* Starting is a queue-wide move — every measured video goes up together —
          but it is asked for from the row that is waiting on it. */}
      {item.phase === "ready-to-upload" && (
        <button onClick={onStart} disabled={!canStart} className={PILL_INK}>
          Start
        </button>
      )}
      {hasSplat && !previewing && (
        <button onClick={() => onPreview(item.id)} className={PILL_WHITE}>
          Preview
        </button>
      )}
      {item.phase === "previewable" && (
        <button
          onClick={() => onSave(item.id)}
          disabled={!canSave}
          className={PILL_ACCENT}
        >
          {albumId ? "Add to journey" : "Save"}
        </button>
      )}
      {item.phase === "saved" && item.placeId && (
        <Link href={`/place/${item.placeId}`} className={PILL_WHITE}>
          Open
        </Link>
      )}
      {item.splat && (
        <a
          href={item.splat.url}
          download={item.splat.file.name}
          className="px-1 text-[12px] text-[#6B7178] transition hover:text-[#14161A]"
        >
          .ply
        </a>
      )}
      {isRetryable(item) && (
        <button onClick={() => onRetry(item.id)} className={PILL_INK}>
          Try Again
        </button>
      )}
      <button
        onClick={() => onRemove(item.id)}
        aria-label={`Remove ${item.name || "this capture"}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[15px] leading-none text-[#6B7178] transition hover:bg-[rgba(20,22,26,0.05)] hover:text-[#14161A]"
      >
        ×
      </button>
    </>
  );
}

function Progress({ item, className }: { item: CaptureItem; className: string }) {
  if (item.phase === "uploading") {
    return (
      <div
        className={`h-1 overflow-hidden rounded-full bg-[rgba(20,22,26,0.07)] ${className}`}
      >
        <div
          className="h-full rounded-full bg-[#0071E3]"
          style={{ width: `${Math.round(item.uploadFraction * 100)}%` }}
        />
      </div>
    );
  }
  // Reconstruction reports no percentage of its own, and a bar frozen at zero
  // for an hour reads as broken, so these stages get motion instead of a number.
  if (INDETERMINATE.has(item.phase)) {
    return (
      <div
        className={`h-1 overflow-hidden rounded-full bg-[rgba(20,22,26,0.07)] ${className}`}
      >
        <div className="atlas-pulse h-full w-[46%] rounded-full bg-[#0071E3]" />
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

/** Whether the row is mid-something, which is what the album tile's ring says. */
function working(phase: CapturePhase) {
  return phase === "uploading" || INDETERMINATE.has(phase);
}

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
        ? `${item.meta.width}×${item.meta.height}, ${item.meta.seconds.toFixed(0)}s, ready`
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
        : `${CAPTURE_STATUS_LABEL[item.status]}.`;
    case "downloading":
      return "Downloading your place…";
    case "previewable":
      return "Ready to save";
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "failed":
      // "Stopped" reads like something paused. A walkthrough KIRI refused is
      // over, and the row should not leave that ambiguous.
      return item.fatal
        ? "Failed. This walkthrough could not be reconstructed."
        : "Failed";
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
