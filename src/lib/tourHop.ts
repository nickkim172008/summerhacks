/**
 * The camera move between two captures in a walkthrough: pull back far enough
 * to see both, travel, drop into the next one.
 *
 * How far back is the whole point. Two captures in the same park should barely
 * lift off the ground, while two across a city should show the city — so the
 * pull-back is the zoom that would fit both points in the frame, not a fixed
 * step. A constant would either fly to orbit between neighbours or leave a
 * cross-town hop looking like a jump cut.
 */
export interface HopPoint {
  lat: number;
  lng: number;
}

export interface HopStage {
  lat: number;
  lng: number;
  zoom: number;
}

export interface HopPlan {
  stages: HopStage[];
  distanceKm: number;
  /** The pull-back zoom, kept for the caption and for tests. */
  outZoom: number;
}

/** Google's tile size; the zoom maths is all relative to it. */
const WORLD_PX = 256;

/**
 * Never pull back to the whole globe for a flight between two cities, and
 * never leave a hop so tight that it reads as a cut rather than a move.
 */
const MIN_OUT_ZOOM = 3;
const MIN_PULL_BACK = 1;

/**
 * Below this the two captures are close enough that the frame already holds
 * both, and a separate pull-back stage would be a wobble rather than a move.
 */
export const NEIGHBOUR_KM = 0.35;

export function distanceKm(a: HopPoint, b: HopPoint) {
  const R = 6371;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The zoom at which both points sit inside a viewport of this size. Mercator
 * stretches latitude, so the two axes are measured separately and the tighter
 * one wins.
 */
export function fitZoom(
  a: HopPoint,
  b: HopPoint,
  viewport: { width: number; height: number },
) {
  const lngSpan = Math.abs(a.lng - b.lng);
  const latSpan = Math.abs(mercatorY(a.lat) - mercatorY(b.lat));

  // Two captures at the same coordinates have no span to fit, and the caller
  // wants to know that rather than divide by zero.
  const byLng =
    lngSpan > 0
      ? Math.log2((viewport.width * 360) / (WORLD_PX * lngSpan))
      : Infinity;
  const byLat =
    latSpan > 0 ? Math.log2(viewport.height / (WORLD_PX * latSpan)) : Infinity;

  return Math.min(byLng, byLat);
}

/**
 * `closeZoom` is where a capture is watched from; the plan starts and ends
 * there. A hop between neighbours skips the pull-back entirely and is a single
 * pan, which is what "it should be relative to distance" means at the short
 * end.
 */
export function planHop(
  from: HopPoint | null,
  to: HopPoint | null,
  {
    closeZoom,
    viewport,
  }: { closeZoom: number; viewport: { width: number; height: number } },
): HopPlan {
  // Nothing to fly between: the caller cuts instead.
  if (!from || !to) {
    return { stages: [], distanceKm: 0, outZoom: closeZoom };
  }

  const km = distanceKm(from, to);
  const arrival: HopStage = { ...to, zoom: closeZoom };

  if (km <= NEIGHBOUR_KM) {
    return { stages: [arrival], distanceKm: km, outZoom: closeZoom };
  }

  const fitted = fitZoom(from, to, viewport);
  const outZoom = Math.round(
    clamp(
      Number.isFinite(fitted) ? fitted - 0.5 : closeZoom - MIN_PULL_BACK,
      MIN_OUT_ZOOM,
      closeZoom - MIN_PULL_BACK,
    ),
  );

  return {
    stages: [{ ...midpoint(from, to), zoom: outZoom }, arrival],
    distanceKm: km,
    outZoom,
  };
}

/**
 * Halfway along the straight line, which is close enough at these distances —
 * the great-circle midpoint only diverges over hundreds of kilometres, and the
 * pull-back frames both ends anyway.
 */
export function midpoint(a: HopPoint, b: HopPoint): HopPoint {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

function mercatorY(lat: number) {
  const clamped = clamp(lat, -85.05112878, 85.05112878);
  const rad = radians(clamped);
  return (
    (Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI)) * WORLD_PX * 2
  );
}

function radians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function clamp(value: number, low: number, high: number) {
  return Math.min(high, Math.max(low, value));
}
