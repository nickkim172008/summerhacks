/**
 * What a reconstruction job is doing, in the app's own words.
 *
 * These codes began as KIRI's and are kept at their original numbers on
 * purpose: a capture row survives a reload by sitting in localStorage with its
 * status already written down, so changing what 2 means would strand every job
 * in flight at the moment this ships.
 *
 * The vocabulary is the app's now rather than any one backend's. World Labs
 * reports IN_PROGRESS / SUCCEEDED / FAILED and nothing else, so `uploading`,
 * `queuing` and `expired` are unreachable through it — they stay because a
 * stored job may still carry one, and because the labels have to answer for
 * whatever it finds there.
 */
export const CAPTURE_STATUS = {
  uploading: -1,
  processing: 0,
  failed: 1,
  successful: 2,
  queuing: 3,
  expired: 4,
} as const;

export type CaptureStatus =
  (typeof CAPTURE_STATUS)[keyof typeof CAPTURE_STATUS];

export const CAPTURE_STATUS_LABEL: Record<CaptureStatus, string> = {
  [CAPTURE_STATUS.uploading]: "Still receiving the video",
  [CAPTURE_STATUS.processing]: "Reconstructing the scene",
  [CAPTURE_STATUS.failed]: "This walkthrough could not be reconstructed",
  [CAPTURE_STATUS.successful]: "Reconstruction finished",
  [CAPTURE_STATUS.queuing]: "Queued",
  [CAPTURE_STATUS.expired]: "This job expired before its result was downloaded",
};

/**
 * What a finished world is worth keeping besides its splat.
 *
 * `metricScaleFactor` and `groundPlaneOffset` are the two that do work rather
 * than describe: raw output arrives at arbitrary scale — the four generated so
 * far ranged from 1.1x to 3.1x — so anything measuring, colliding or standing a
 * person at eye height needs them applied. The rest is provenance, and the
 * reason to store it is that regenerating a world to find it out again costs
 * 1,500 credits.
 */
export interface WorldLabsCapture {
  worldId: string;
  /** The scene as the model described it, unprompted. */
  caption?: string;
  /** Multiply positions and sizes by this to get metres. */
  metricScaleFactor?: number;
  /** Subtract from y to put the ground at zero. */
  groundPlaneOffset?: number;
  /** Walkable collision geometry, hosted by World Labs. */
  colliderMeshUrl?: string;
  /** This world in World Labs' own viewer. */
  marbleUrl?: string;
  model?: string;
}
