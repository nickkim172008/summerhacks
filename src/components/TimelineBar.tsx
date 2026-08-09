"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  clusterTicks,
  positionOf,
  type TickCluster,
} from "@/lib/captureTimeline";
import type { CaptureTimeline } from "@/lib/timelinePlayback";

/**
 * The map's time axis. Fixed to the bottom of the viewport rather than laid out
 * inside the map, so panning and zooming happen underneath it.
 *
 * Two rows, and the second is the point. The top row animates the heatmap. The
 * bottom one puts each capture's filming beside its upload and draws the wait
 * between them, which at this size says more than the heatmap does: this
 * library was filmed in bursts and uploaded in batches hours later, and four
 * captures share one upload minute because they were reconstructed in parallel.
 */

/** Below this the ticks stop being separate marks and become a smear. */
const MIN_TICK_GAP_PX = 14;

/** Kept off the ends so a tooltip or the readout cannot leave the bar. */
const EDGE_INSET_PCT = 6;

export default function TimelineBar({
  timeline,
  scopeCount,
  scopeLabel,
  onClose,
}: {
  timeline: CaptureTimeline;
  /** Everything the scope holds, including what has no place on the axis. */
  scopeCount: number;
  scopeLabel: string;
  onClose: () => void;
}) {
  const { entries, span, playheadMs, playing, weights } = timeline;
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  // Clustering is measured in pixels, so the track has to say how wide it is.
  useEffect(() => {
    const node = trackRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setTrackWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Nothing is drawn before the track has been measured: clustering at a width
  // of zero folds every capture into one tick reading "8", and a wrong count
  // for a frame is worse than an empty track for one.
  const clusters = useMemo(
    () =>
      span && trackWidth > 0
        ? clusterTicks(entries, span, {
            widthPx: trackWidth,
            minGapPx: MIN_TICK_GAP_PX,
          })
        : [],
    [entries, span, trackWidth],
  );

  const onMap = entries.filter((entry) => entry.hasLocation);
  const reachedOnMap = onMap.filter((entry) => entry.id in weights).length;
  const offMap = entries.length - onMap.length;
  // A place with neither a filmed nor an upload time has nowhere to sit on the
  // axis, so it is never animated and never hidden either.
  const undated = Math.max(0, scopeCount - entries.length);

  const spansDays = span
    ? formatDay(span.start) !== formatDay(span.end)
    : false;
  const playPct = span ? positionOf(playheadMs, span) * 100 : 0;

  function scrubToEvent(clientX: number) {
    const node = trackRef.current;
    if (!node || !span) return;
    const rect = node.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    timeline.scrubTo(span.start + ratio * (span.end - span.start));
  }

  return (
    <div
      className="fixed inset-x-0 z-30 border-t border-black/10 bg-white/95 shadow-[0_-8px_28px_rgba(0,0,0,0.07)] backdrop-blur-xl"
      // Above the tab bar rather than over it: the tabs stay reachable while
      // the timeline is open.
      style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto max-w-5xl px-4 pb-2 pt-2">
        <div className="flex items-center gap-2.5">
          <button
            onClick={timeline.toggle}
            disabled={entries.length === 0}
            aria-label={playing ? "Pause timeline" : "Play timeline"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0071e3] text-white shadow-sm shadow-[#0071e3]/25 transition hover:bg-[#0077ed] disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none"
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>

          <div className="min-w-0 flex-1">
            {/* One line, not two: the bar sits over the map, and the note is
                context rather than something to read every frame. */}
            <p className="truncate text-[12px] leading-tight">
              <span className="font-medium tracking-tight">Timeline</span>
              <span className="text-neutral-300"> · </span>
              <span className="text-neutral-500">{scopeLabel}</span>
              <span className="text-neutral-300"> · </span>
              <span className="text-neutral-500">
                {exclusionNote(entries.length, scopeCount, offMap, undated)}
              </span>
            </p>
          </div>

          {onMap.length > 0 && (
            <p className="shrink-0 text-[12px] leading-none text-neutral-500">
              <span className="text-[14px] font-medium tabular-nums text-[#1d1d1f]">
                {reachedOnMap} of {onMap.length}
              </span>{" "}
              on the map
            </p>
          )}

          <button
            onClick={onClose}
            aria-label="Close timeline"
            className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-100 hover:text-[#1d1d1f]"
          >
            <CloseIcon />
          </button>
        </div>

        {span && (
          <>
            <div className="relative mt-2 h-[16px] select-none">
              <div
                className="absolute -translate-x-1/2 whitespace-nowrap rounded-full bg-[#1d1d1f] px-2 py-[3px] text-[10px] font-medium tabular-nums text-white"
                style={{ left: `${inset(playPct)}%` }}
              >
                {formatClock(playheadMs)}
                {spansDays && ` · ${formatDay(playheadMs)}`}
              </div>
            </div>

            <div
              ref={trackRef}
              role="slider"
              tabIndex={0}
              aria-label="Capture timeline"
              aria-valuemin={span.start}
              aria-valuemax={span.end}
              aria-valuenow={Math.round(playheadMs)}
              aria-valuetext={`${formatClock(playheadMs)}, ${reachedOnMap} of ${onMap.length} on the map`}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragging(true);
                scrubToEvent(event.clientX);
              }}
              onPointerMove={(event) => {
                if (dragging) scrubToEvent(event.clientX);
              }}
              onPointerUp={() => setDragging(false)}
              onPointerCancel={() => setDragging(false)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") timeline.stepBy(1);
                else if (event.key === "ArrowLeft") timeline.stepBy(-1);
                else return;
                event.preventDefault();
              }}
              className="relative h-7 cursor-pointer touch-none select-none"
            >
              <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-neutral-200" />
              <div
                className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[#0071e3]/40"
                style={{ width: `${playPct}%` }}
              />

              {clusters.map((cluster) => (
                <Tick
                  key={cluster.entries[0].id}
                  cluster={cluster}
                  weights={weights}
                  spansDays={spansDays}
                  hovered={hovered === cluster.entries[0].id}
                  onHover={(on) =>
                    setHovered(on ? cluster.entries[0].id : null)
                  }
                />
              ))}

              <div
                className="pointer-events-none absolute top-0 h-full w-[2px] -translate-x-1/2 rounded-full bg-[#1d1d1f]"
                style={{ left: `${playPct}%` }}
              >
                <span className="absolute -top-[3px] left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-[#1d1d1f] ring-2 ring-white" />
              </div>
            </div>

            <div className="mt-0.5 flex items-baseline justify-between gap-3 text-[10px] tabular-nums text-neutral-400">
              <span>{formatStamp(span.start, spansDays)}</span>
              <span className="text-neutral-500">
                {formatDuration(span.end - span.start)} end to end
              </span>
              <span>{formatStamp(span.end, spansDays)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Tick({
  cluster,
  weights,
  spansDays,
  hovered,
  onHover,
}: {
  cluster: TickCluster;
  weights: Record<string, number>;
  spansDays: boolean;
  hovered: boolean;
  onHover: (on: boolean) => void;
}) {
  // The axis always shows everything that exists; the playhead is what colours
  // it in. A tick it has not reached stays grey rather than disappearing.
  const reached = Math.max(
    0,
    ...cluster.entries.map((entry) => weights[entry.id] ?? 0),
  );
  const anyReached = cluster.entries.some((entry) => entry.id in weights);
  const allFilmed = cluster.entries.every((entry) => entry.source === "filmed");
  const count = cluster.entries.length;
  const pct = cluster.position * 100;

  return (
    <div
      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${pct}%` }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <span
        className={`block rounded-full ring-2 ring-white transition-colors ${
          count > 1 ? "h-4 min-w-4 px-[3px]" : "h-[11px] w-[11px]"
        } ${
          // Hollow says "this time is when it was uploaded, not filmed" — the
          // difference the second row exists to explain.
          allFilmed
            ? anyReached
              ? "bg-[#0071e3]"
              : "bg-neutral-300"
            : anyReached
              ? "border-[2px] border-[#0071e3] bg-white"
              : "border-[2px] border-neutral-300 bg-white"
        }`}
        style={{ opacity: anyReached ? 0.45 + 0.55 * reached : 1 }}
      >
        {count > 1 && (
          <span
            className={`block text-center text-[9px] font-semibold leading-4 ${
              allFilmed ? "text-white" : "text-[#0071e3]"
            }`}
          >
            {count}
          </span>
        )}
      </span>

      {hovered && (
        <div
          className="pointer-events-none absolute bottom-full z-10 mb-2.5 w-max max-w-[16rem] space-y-1 rounded-xl bg-white px-3 py-2 shadow-lg ring-1 ring-black/10"
          style={tickTooltipAnchor(pct)}
        >
          {cluster.entries.slice(0, 4).map((entry) => (
            <p key={entry.id} className="text-[11px] leading-snug">
              <span className="font-medium text-[#1d1d1f]">{entry.name}</span>
              <br />
              <span className="tabular-nums text-neutral-500">
                {formatStamp(entry.at, spansDays)}
              </span>
              <span className="text-neutral-300"> · </span>
              <span className="text-neutral-500">
                {entry.source === "filmed" ? "filmed" : "uploaded"}
              </span>
              {!entry.hasLocation && (
                <span className="text-neutral-400"> · no location</span>
              )}
            </p>
          ))}
          {count > 4 && (
            <p className="text-[11px] text-neutral-400">
              +{count - 4} more at this moment
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function exclusionNote(
  dated: number,
  scopeCount: number,
  offMap: number,
  undated: number,
) {
  if (dated === 0) {
    return scopeCount === 0
      ? "Nothing in this scope, so there is nothing to animate."
      : `None of these ${scopeCount} environments carry a date.`;
  }

  const parts: string[] = [];
  if (offMap > 0) {
    parts.push(
      `${offMap} of ${undated > 0 ? `${dated} dated` : scopeCount} environment${
        (undated > 0 ? dated : scopeCount) === 1 ? "" : "s"
      } ${offMap === 1 ? "has" : "have"} no location — on the axis, never on the map`,
    );
  }
  if (undated > 0) {
    parts.push(
      `${undated} carr${undated === 1 ? "ies" : "y"} no date at all, and stay${
        undated === 1 ? "s" : ""
      } on the map throughout`,
    );
  }
  if (parts.length === 0) {
    parts.push(`all ${scopeCount} located and dated`);
  }
  return parts.join(" · ");
}

/**
 * Keeps a hover card inside the bar rather than hanging off the end of the
 * track. A tick's card is anchored on the tick, which already sits at the right
 * x; a lane's is anchored on the whole row, so it has to carry the position.
 */
function tickTooltipAnchor(pct: number) {
  if (pct < 18) return { left: 0 };
  if (pct > 82) return { right: 0 };
  return { left: "50%", transform: "translateX(-50%)" };
}

function inset(pct: number) {
  return Math.min(Math.max(pct, EDGE_INSET_PCT), 100 - EDGE_INSET_PCT);
}

const CLOCK = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const DAY = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

function formatClock(at: number) {
  return CLOCK.format(at);
}

function formatDay(at: number) {
  return DAY.format(at);
}

/**
 * The library is an evening, so the date is noise on every readout — it earns
 * its place only once the span actually crosses midnight.
 */
function formatStamp(at: number, spansDays: boolean) {
  return spansDays ? `${formatClock(at)} ${formatDay(at)}` : formatClock(at);
}

function formatDuration(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="currentColor"
      aria-hidden
    >
      <path d="M6.5 4.3a.75.75 0 0 1 1.14-.64l8 5.7a.75.75 0 0 1 0 1.28l-8 5.7A.75.75 0 0 1 6.5 15.7V4.3Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="currentColor"
      aria-hidden
    >
      <path d="M6 4h2.5v12H6V4Zm5.5 0H14v12h-2.5V4Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="currentColor"
      aria-hidden
    >
      <path d="M5.22 5.22a.75.75 0 0 1 1.06 0L10 8.94l3.72-3.72a.75.75 0 1 1 1.06 1.06L11.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06L10 11.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06L8.94 10 5.22 6.28a.75.75 0 0 1 0-1.06Z" />
    </svg>
  );
}
