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

export default function TimelineBar({
  timeline,
  scopeCount,
  onClose,
}: {
  timeline: CaptureTimeline;
  /** Everything the scope holds, including what has no place on the axis. */
  scopeCount: number;
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
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-3"
      // Clear of the tab bar rather than a slab across the bottom: the map is
      // the thing being looked at, and the timeline is a control on it. The
      // extra 0.75rem is breathing room — flush against the tabs it read as
      // part of them.
      style={{ bottom: "calc(3.75rem + env(safe-area-inset-bottom))" }}
    >
      <div className="pointer-events-auto flex w-full max-w-3xl items-center gap-2.5 rounded-full bg-white/90 py-1.5 pl-1.5 pr-2.5 shadow-lg ring-1 ring-black/10 backdrop-blur-xl">
        <button
          onClick={timeline.toggle}
          disabled={entries.length === 0}
          aria-label={playing ? "Pause timeline" : "Play timeline"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0071e3] text-white transition hover:bg-[#0077ed] disabled:bg-neutral-200 disabled:text-neutral-400"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>

        {span ? (
          <>
            <span className="shrink-0 text-[10px] tabular-nums text-neutral-400">
              {formatStamp(span.start, spansDays)}
            </span>

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
              className="relative h-7 min-w-0 flex-1 cursor-pointer touch-none select-none"
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
                {/* The clock rides the playhead rather than sitting in a row of
                    its own, which is a whole line of screen back. */}
                <span className="absolute -top-[19px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#1d1d1f] px-1.5 py-px text-[10px] font-medium tabular-nums text-white">
                  {formatClock(playheadMs)}
                </span>
              </div>
            </div>

            <span className="shrink-0 text-[10px] tabular-nums text-neutral-400">
              {formatStamp(span.end, spansDays)}
            </span>

            {/* The count carries the honesty about what is missing, since there
                is no second line left to put it on. */}
            <span
              title={exclusionNote(entries.length, scopeCount, offMap, undated)}
              className="shrink-0 text-[13px] font-medium tabular-nums text-[#1d1d1f]"
            >
              {reachedOnMap}/{onMap.length}
              {offMap + undated > 0 && (
                <span className="ml-1 text-[10px] font-normal text-neutral-500">
                  +{offMap + undated} off
                </span>
              )}
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-500">
            {exclusionNote(entries.length, scopeCount, offMap, undated)}
          </span>
        )}

        <button
          onClick={onClose}
          aria-label="Close timeline"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-100 hover:text-[#1d1d1f]"
        >
          <CloseIcon />
        </button>
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
      : `None of these ${scopeCount} places carry a date.`;
  }

  const parts: string[] = [];
  if (offMap > 0) {
    parts.push(
      `${offMap} of ${undated > 0 ? `${dated} dated` : scopeCount} place${
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
