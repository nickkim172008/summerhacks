"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  paceEntries,
  spanOf,
  toTimelineEntries,
  type TimelineEntry,
  type TimelineSpan,
} from "./captureTimeline";
import type { Place } from "./types";

/**
 * The playhead behind the map's timeline bar: what instant it points at, which
 * captures that makes visible, and how strongly each one is drawn while it
 * fades in.
 *
 * Two things here are answers to this library's shape rather than to taste.
 * The axis covers filmed *and* upload times, not only the one each capture is
 * dated by, because the last upload lands after the last filming — a track that
 * stopped at the final capture would have nowhere to draw it. And the resting
 * position is "the live end of the axis" rather than a remembered instant, so a
 * capture arriving over onSnapshot while the bar is open widens the track and
 * takes the playhead with it instead of stranding it behind the new tick.
 */

/**
 * Roughly how long the whole run should take. paceEntries treats the two caps
 * as absolute, so this is a target rather than a promise: eight captures at the
 * cap below finish sooner, and that is the better failure.
 */
const RUN_MS = 15_000;
const MAX_STEP_MS = 2_600;
/** A floor, so the four captures inside ten minutes read as four arrivals. */
const MIN_STEP_MS = 520;

/**
 * How long a capture takes to reach full strength once the playhead passes it.
 * Kept in real milliseconds and converted into axis time per step, so the fade
 * lasts the same moment whether the playhead is crawling through the 21:35
 * clump or covering three empty hours in one glide.
 */
const FADE_MS = 420;

/**
 * The heatmap repaints every pixel of the map viewport whenever its weights
 * change, so a fade at frame rate would cost sixty full repaints a second to
 * show differences no one can see. Four steps is the coarsest ramp that still
 * reads as a fade rather than a pop.
 */
const FADE_STEPS = 4;

export interface CaptureTimeline {
  entries: TimelineEntry[];
  /** Null when nothing in scope carries a usable timestamp. */
  span: TimelineSpan | null;
  playheadMs: number;
  playing: boolean;
  /** 0..1 per capture the playhead has reached; absent means not reached yet. */
  weights: Record<string, number>;
  /** Captures the playhead has not reached, for the map to leave out. */
  hiddenIds: Set<string>;
  toggle: () => void;
  /** Stop, and hand the playhead back to the live end of the axis. */
  reset: () => void;
  scrubTo: (at: number) => void;
  /** Jump whole captures — what the arrow keys do on the track. */
  stepBy: (delta: number) => void;
}

export function useCaptureTimeline(
  places: Place[],
  active: boolean,
): CaptureTimeline {
  const entries = useMemo(() => toTimelineEntries(places), [places]);
  const span = useMemo(() => axisSpan(entries), [entries]);
  const schedule = useMemo(() => buildSchedule(entries, span), [entries, span]);

  const [head, setHead] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const startedAtRef = useRef(0);

  const playing = active && running;
  // Null is the resting state, not "unknown": it means follow the end of the
  // axis, which is what keeps a bar left open honest as captures arrive.
  const playheadMs = (active ? head : null) ?? span?.end ?? 0;

  useEffect(() => {
    if (!playing) return;
    let frame = requestAnimationFrame(function tick() {
      const elapsed = performance.now() - startedAtRef.current;
      if (elapsed >= schedule.totalMs) {
        setRunning(false);
        setHead(null);
        return;
      }
      setHead(headAt(schedule, elapsed));
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
    // A capture landing mid-run rebuilds the schedule. startedAtRef is
    // deliberately not touched here, so the run picks up where it was rather
    // than snapping back to the first capture.
  }, [playing, schedule]);

  const toggle = useCallback(() => {
    if (schedule.segments.length === 0) return;
    if (running) {
      setRunning(false);
      return;
    }
    const from = head === null ? schedule.totalMs : elapsedFor(schedule, head);
    // Parked at the end is where a finished run leaves the playhead, so play
    // there means play again from the top rather than replay nothing.
    const resume = from >= schedule.totalMs ? 0 : from;
    startedAtRef.current = performance.now() - resume;
    setHead(headAt(schedule, resume));
    setRunning(true);
  }, [head, running, schedule]);

  const reset = useCallback(() => {
    setRunning(false);
    setHead(null);
  }, []);

  const scrubTo = useCallback(
    (at: number) => {
      if (!span) return;
      setRunning(false);
      setHead(clamp(at, span.start, span.end));
    },
    [span],
  );

  const stepBy = useCallback(
    (delta: number) => {
      if (entries.length === 0) return;
      setRunning(false);
      const reached = entries.filter((entry) => entry.at <= playheadMs).length;
      const next = clamp(reached - 1 + delta, 0, entries.length - 1);
      setHead(entries[next].at);
    },
    [entries, playheadMs],
  );

  // Quantised first as a string, because identity is what the map watches: a
  // fresh weights object every frame would repaint the heatmap sixty times a
  // second, while this one only changes when the picture does.
  const signature = useMemo(() => {
    const parts: string[] = [];
    for (const segment of schedule.segments) {
      if (playheadMs < segment.from) continue;
      const raw =
        segment.fadeAxisMs > 0
          ? Math.min(1, (playheadMs - segment.from) / segment.fadeAxisMs)
          : 1;
      parts.push(`${segment.id}=${Math.round(raw * FADE_STEPS) / FADE_STEPS}`);
    }
    return parts.join("\n");
  }, [playheadMs, schedule]);

  const weights = useMemo(() => {
    const byId: Record<string, number> = {};
    for (const part of signature ? signature.split("\n") : []) {
      const cut = part.lastIndexOf("=");
      byId[part.slice(0, cut)] = Number(part.slice(cut + 1));
    }
    return byId;
  }, [signature]);

  const hiddenIds = useMemo(
    () =>
      new Set(
        entries
          .filter((entry) => !(entry.id in weights))
          .map((entry) => entry.id),
      ),
    [entries, weights],
  );

  return {
    entries,
    span,
    playheadMs,
    playing,
    weights,
    hiddenIds,
    toggle,
    reset,
    scrubTo,
    stepBy,
  };
}

/**
 * The span both rows of the bar are drawn against: every timestamp in scope,
 * not only the one each capture is dated by. Filming and upload are hours apart
 * here, and the second row cannot draw a connector to a point off the end of
 * its own axis.
 */
function axisSpan(entries: TimelineEntry[]): TimelineSpan | null {
  const base = spanOf(entries);
  if (!base) return null;

  let { start, end } = base;
  for (const entry of entries) {
    for (const at of [entry.filmedAt, entry.uploadedAt]) {
      if (at === null) continue;
      if (at < start) start = at;
      if (at > end) end = at;
    }
  }
  return { start, end };
}

interface Segment {
  id: string;
  /** Axis time this capture arrives at. */
  from: number;
  /** Axis time the playhead has reached when the step ends. */
  to: number;
  startMs: number;
  holdMs: number;
  /** The fade, measured in axis time, so opacity derives from the playhead. */
  fadeAxisMs: number;
}

interface Schedule {
  segments: Segment[];
  totalMs: number;
}

function buildSchedule(
  entries: TimelineEntry[],
  span: TimelineSpan | null,
): Schedule {
  const steps = paceEntries(entries, {
    totalMs: RUN_MS,
    maxStepMs: MAX_STEP_MS,
    minStepMs: MIN_STEP_MS,
  });

  const segments: Segment[] = [];
  let cursor = 0;

  steps.forEach((step, index) => {
    const next = steps[index + 1];
    const from = step.entry.at;
    // The last capture glides on to the end of the axis instead of stopping
    // short of it: a run has to finish with the playhead parked on the right
    // edge, and that tail is real time — the last upload is after the last
    // filming.
    const to = next ? next.entry.at : Math.max(from, span?.end ?? from);
    segments.push({
      id: step.entry.id,
      from,
      to,
      startMs: cursor,
      holdMs: step.holdMs,
      fadeAxisMs: (to - from) * Math.min(1, FADE_MS / Math.max(step.holdMs, 1)),
    });
    cursor += step.holdMs;
  });

  return { segments, totalMs: cursor };
}

/** Where the playhead sits this far into a run. Segments are contiguous. */
function headAt(schedule: Schedule, elapsed: number): number {
  const { segments } = schedule;
  if (segments.length === 0) return 0;

  let current = segments[segments.length - 1];
  for (const segment of segments) {
    if (elapsed < segment.startMs + segment.holdMs) {
      current = segment;
      break;
    }
  }

  const through =
    current.holdMs > 0
      ? clamp((elapsed - current.startMs) / current.holdMs, 0, 1)
      : 1;
  return current.from + (current.to - current.from) * through;
}

/** The inverse, so resuming after a pause or a scrub continues where it is. */
function elapsedFor(schedule: Schedule, at: number): number {
  const { segments } = schedule;
  if (segments.length === 0) return 0;
  if (at <= segments[0].from) return 0;

  for (const segment of segments) {
    if (at < segment.to) {
      const width = segment.to - segment.from;
      return (
        segment.startMs +
        (width > 0 ? ((at - segment.from) / width) * segment.holdMs : 0)
      );
    }
  }
  return schedule.totalMs;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
