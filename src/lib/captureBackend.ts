import { MAX_UPLOAD_BYTES } from "./worldlabs";
import {
  MAX_VIDEO_HEIGHT,
  MAX_VIDEO_SECONDS,
  MAX_VIDEO_WIDTH,
} from "./kiri";

/**
 * Which service turns a walkthrough into a place.
 *
 * They are not interchangeable behind one interface, which is why this exists
 * rather than a boolean somewhere. They disagree about what a video may be,
 * what comes back, how long it takes, and what a failure costs — and every one
 * of those differences reaches the person waiting on the capture.
 */
export type CaptureBackend = "worldlabs" | "kiri";

export const DEFAULT_BACKEND: CaptureBackend = "worldlabs";

export function isCaptureBackend(value: unknown): value is CaptureBackend {
  return value === "worldlabs" || value === "kiri";
}

export interface BackendProfile {
  id: CaptureBackend;
  label: string;
  /** One line, for the control that picks between them. */
  summary: string;
  /** What the result arrives as. KIRI's PLY is transcoded in the browser. */
  returns: "spz" | "ply";
  /** Roughly how long, in words. Both are honest about being wide. */
  duration: string;
  /** Longest walkthrough, or null where the service publishes no limit. */
  maxSeconds: number | null;
  /** Largest file, or null. World Labs signs its upload URL over 100 MB. */
  maxBytes: number | null;
  maxWidth: number | null;
  maxHeight: number | null;
  /** Said plainly on the picker, because it is the surprising one. */
  notes: string[];
}

export const BACKENDS: Record<CaptureBackend, BackendProfile> = {
  worldlabs: {
    id: "worldlabs",
    label: "World Labs",
    summary: "Generative. Minutes, and walkable well past what you filmed.",
    returns: "spz",
    duration: "about 6 minutes for a short clip, longer for a long one",
    maxSeconds: null,
    maxBytes: MAX_UPLOAD_BYTES,
    maxWidth: null,
    maxHeight: null,
    notes: [
      "Fills in what the camera never saw, so the far side of a room is invented rather than reconstructed",
      "Credits are charged when the job starts and are not returned if it fails",
      "No view-dependent lighting: glass and screens read flat",
      "100 MB ceiling — about two and a half minutes of 1080p from a phone",
    ],
  },
  kiri: {
    id: "kiri",
    label: "KIRI Engine",
    summary: "Photogrammetric. Slow, and only ever what the camera saw.",
    returns: "ply",
    duration: "30 to 90 minutes",
    maxSeconds: MAX_VIDEO_SECONDS,
    maxBytes: null,
    maxWidth: MAX_VIDEO_WIDTH,
    maxHeight: MAX_VIDEO_HEIGHT,
    notes: [
      "Reconstructs only what was filmed, so nothing in the capture is invented",
      "Geometry thins at the edges of what the walkthrough covered",
      "Returns PLY, transcoded to SPZ in the browser before it is stored",
      "3 minutes and 1920×1080 maximum",
    ],
  },
};

/**
 * Which limit a video breaks for a given backend, in words, or null if none.
 *
 * Per backend because the limits genuinely differ: a 150-second walkthrough is
 * fine for KIRI and over World Labs' size ceiling, and a 4K clip is the other
 * way round. Checking the wrong service's rules either refuses a video that
 * would have worked or accepts one that is about to be refused after the whole
 * file has been uploaded.
 */
export function describeVideoProblem(
  backend: CaptureBackend,
  video: { seconds: number; width: number; height: number; bytes?: number },
): string | null {
  const profile = BACKENDS[backend];

  if (
    profile.maxBytes !== null &&
    video.bytes !== undefined &&
    video.bytes > profile.maxBytes
  ) {
    return `too big at ${Math.round(video.bytes / 1e6)} MB, max ${Math.round(profile.maxBytes / 1e6)} MB`;
  }
  if (profile.maxSeconds !== null && video.seconds > profile.maxSeconds) {
    return `too long, max ${profile.maxSeconds / 60} minutes`;
  }
  // The cap is a frame size, not an orientation, and phones record portrait —
  // so measure the long and short sides, or every handheld walkthrough is
  // rejected at 1080×1920.
  if (profile.maxWidth !== null && profile.maxHeight !== null) {
    if (
      Math.max(video.width, video.height) > profile.maxWidth ||
      Math.min(video.width, video.height) > profile.maxHeight
    ) {
      return `too large, max ${profile.maxWidth}×${profile.maxHeight}`;
    }
  }
  return null;
}
