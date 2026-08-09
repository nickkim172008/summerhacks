/**
 * Ordering, clustering and pacing for the capture time axis, in one place so
 * the map animation and the tour can never disagree about when something
 * happened or which capture comes next.
 *
 * The library this serves is an evening, not a history: everything was filmed
 * inside about seven hours, and four of the captures share a ten-minute window.
 * That shape is why two of the functions below exist at all. Ticks a couple of
 * pixels apart have to collapse or the axis is an unreadable blob, and playback
 * proportional to real time would be three-quarters dead air between clumps.
 *
 * Pure by intent: no React, no DOM, no Firebase beyond the Place type, so both
 * features can test their behaviour without mounting anything.
 */
import type { Place } from "./types";

/** Whether a point is dated by the video's own clock or by when it landed. */
export type TimeSource = "filmed" | "uploaded";

export interface TimelineEntry {
  id: string;
  name: string;
  /** Epoch ms on the axis: filmedAt when the video carried one, else uploadedAt. */
  at: number;
  source: TimeSource;
  /**
   * Both timestamps travel with the entry, not just the chosen one. Filming and
   * upload are hours apart in this library, so a caller drawing a point dated
   * by upload has to be able to say so rather than imply it was filmed then.
   */
  filmedAt: number | null;
  uploadedAt: number | null;
  hasLocation: boolean;
}

export interface TimelineSpan {
  start: number;
  end: number;
}

export interface TickCluster {
  /** The earliest member's time: the anchor the whole cluster is drawn at. */
  at: number;
  position: number;
  entries: TimelineEntry[];
}

export interface PacedStep {
  entry: TimelineEntry;
  index: number;
  /** How long playback rests on this entry before advancing to the next. */
  holdMs: number;
}

/**
 * Places as points on the axis, ascending. A place carrying neither timestamp
 * has nowhere to sit and is left out — the caller compares lengths to report
 * what it dropped rather than being handed a guess.
 */
export function toTimelineEntries(places: Place[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const place of places) {
    const filmedAt = filmedMs(place);
    const uploadedAt = uploadedMs(place);
    const at = filmedAt ?? uploadedAt;
    if (at === null) continue;
    entries.push({
      id: place.id,
      name: place.name,
      at,
      source: filmedAt === null ? "uploaded" : "filmed",
      filmedAt,
      uploadedAt,
      hasLocation: placeable(place),
    });
  }
  return sortEntries(entries);
}

export function spanOf(entries: TimelineEntry[]): TimelineSpan | null {
  if (entries.length === 0) return null;
  let start = entries[0].at;
  let end = entries[0].at;
  for (const entry of entries) {
    if (entry.at < start) start = entry.at;
    if (entry.at > end) end = entry.at;
  }
  return { start, end };
}

/** Where `at` falls along the span, 0..1, clamped to its ends. */
export function positionOf(at: number, span: TimelineSpan): number {
  const width = span.end - span.start;
  // One capture, or several sharing a timestamp: there is no axis to be partway
  // along, so everything sits at the start instead of dividing by zero.
  if (width <= 0) return 0;
  return clamp((at - span.start) / width, 0, 1);
}

/**
 * Ticks for the axis, with anything closer than minGapPx folded into a single
 * cluster carrying all of it. Load-bearing rather than polish: four captures
 * inside ten minutes of a seven-hour span land within a few pixels of each
 * other, and drawn separately they are one smeared mark that can be neither
 * read nor tapped.
 */
export function clusterTicks(
  entries: TimelineEntry[],
  span: TimelineSpan,
  { widthPx, minGapPx }: { widthPx: number; minGapPx: number },
): TickCluster[] {
  const clusters: TickCluster[] = [];
  let anchorPx = 0;

  for (const entry of sortEntries(entries)) {
    const position = positionOf(entry.at, span);
    const px = position * widthPx;
    const open = clusters[clusters.length - 1];
    // Measured against the tick that will actually be drawn, not against the
    // previous entry. Chaining off each neighbour lets a long run of
    // nearly-touching captures swallow the whole axis into one cluster, while
    // this keeps every drawn tick at least minGapPx from the one before it.
    if (open && px - anchorPx < minGapPx) {
      open.entries.push(entry);
      continue;
    }
    clusters.push({ at: entry.at, position, entries: [entry] });
    anchorPx = px;
  }

  return clusters;
}

/**
 * How long playback rests on each capture, in order.
 *
 * Gaps stay proportional so the evening keeps its rhythm, but they are capped:
 * across seven hours with four captures in ten minutes, honest real-time
 * playback is mostly an empty axis, and the run has to fit in roughly totalMs.
 * Every step also gets a floor, so a clump sharing a minute still reads as
 * several arrivals rather than one flicker.
 *
 * The caps are absolute, so the two of them win over totalMs where they
 * conflict: fewer captures than totalMs / maxStepMs runs short, more than
 * totalMs / minStepMs runs long.
 */
export function paceEntries(
  entries: TimelineEntry[],
  {
    totalMs,
    maxStepMs,
    minStepMs,
  }: { totalMs: number; maxStepMs: number; minStepMs: number },
): PacedStep[] {
  const ordered = sortEntries(entries);
  if (ordered.length === 0) return [];

  const floor = Math.max(0, minStepMs);
  const ceiling = Math.max(floor, maxStepMs);

  // The last capture has nothing after it to wait for, so it holds the floor;
  // whatever pause ends the run belongs to the caller, not to the axis.
  const gaps = ordered.map((entry, index) => {
    const next = ordered[index + 1];
    return next ? Math.max(0, next.at - entry.at) : 0;
  });

  let spread = 0;
  let smallest = Infinity;
  for (const gap of gaps) {
    spread += gap;
    if (gap > 0 && gap < smallest) smallest = gap;
  }

  // Nothing to be proportional to — one capture, or a set that all share a
  // timestamp — so the run is simply divided evenly and then clamped.
  if (spread === 0) {
    const even = clamp(totalMs / ordered.length, floor, ceiling);
    return ordered.map((entry, index) => ({ entry, index, holdMs: even }));
  }

  const scaled = (scale: number) =>
    gaps.map((gap) => clamp(gap * scale, floor, ceiling));

  // Clamping makes the total a step function of the scale rather than a
  // multiple of it, so the scale that fills totalMs is bisected for. The upper
  // bound is the one that saturates even the shortest real gap, which is the
  // longest this run can possibly last.
  let low = 0;
  let high = ceiling / smallest;
  for (let i = 0; i < 40; i += 1) {
    const mid = (low + high) / 2;
    if (sum(scaled(mid)) < totalMs) low = mid;
    else high = mid;
  }

  const holds = scaled(high);
  return ordered.map((entry, index) => ({
    entry,
    index,
    holdMs: holds[index],
  }));
}

/**
 * Everything at or before the playhead, which is a time on the axis rather than
 * an offset into playback. Inclusive, so a capture appears the instant the
 * playhead reaches it and the final step leaves the whole set on screen.
 */
export function visibleAt(
  entries: TimelineEntry[],
  playheadMs: number,
): TimelineEntry[] {
  return entries.filter((entry) => entry.at <= playheadMs);
}

/**
 * Ascending, ties broken by id. Ties are the common case here, not an edge —
 * four captures share a minute — and leaving them in input order would let the
 * tour reshuffle itself whenever a snapshot arrived in a different order.
 */
function sortEntries(entries: TimelineEntry[]): TimelineEntry[] {
  return [...entries].sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at;
    if (a.id === b.id) return 0;
    // Codepoint order rather than localeCompare, so the tie-break is the same
    // wherever this runs.
    return a.id < b.id ? -1 : 1;
  });
}

/** Some capturedAt values were typed by hand, so unparseable reads as absent. */
function filmedMs(place: Place): number | null {
  if (!place.capturedAt) return null;
  const ms = Date.parse(place.capturedAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A place saved a moment ago has createdAt null until the server timestamp
 * resolves, so this is missing far more often than the type admits.
 */
function uploadedMs(place: Place): number | null {
  const ms = place.createdAt?.toMillis?.();
  return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
}

/**
 * Whether the map could ever place this, which is the question the exclusion
 * count answers. A name with no coordinates counts: geocode.ts resolves those.
 */
function placeable(place: Place): boolean {
  const { location } = place;
  if (
    location &&
    Number.isFinite(location.lat) &&
    Number.isFinite(location.lng)
  ) {
    return true;
  }
  return Boolean(place.locationName?.trim());
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
