/**
 * Constants shared by the capture UI and the server-side KIRI client. They live
 * apart from kiri.server.ts so importing them into a client component can never
 * drag the API key into the browser bundle.
 */

/** https://docs.kiriengine.app/3dgs-scan/video-upload */
export const MAX_VIDEO_SECONDS = 180;
export const MAX_VIDEO_WIDTH = 1920;
export const MAX_VIDEO_HEIGHT = 1080;

/** https://docs.kiriengine.app/model/retrieve-3d-model-status */
export const KIRI_STATUS = {
  uploading: -1,
  processing: 0,
  failed: 1,
  successful: 2,
  queuing: 3,
  expired: 4,
} as const;

export type KiriStatus = (typeof KIRI_STATUS)[keyof typeof KIRI_STATUS];

export const KIRI_STATUS_LABEL: Record<KiriStatus, string> = {
  [KIRI_STATUS.uploading]: "KIRI is still receiving the video",
  [KIRI_STATUS.processing]: "Reconstructing the scene",
  [KIRI_STATUS.failed]: "KIRI could not reconstruct this walkthrough",
  [KIRI_STATUS.successful]: "Reconstruction finished",
  [KIRI_STATUS.queuing]: "Queued at KIRI",
  [KIRI_STATUS.expired]: "This job expired before its result was downloaded",
};
