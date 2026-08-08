/**
 * Capturing several videos at once means several uploads, downloads and saves
 * want to run together, and each stage has a measured ceiling above which it
 * stops being concurrency and starts being a stall:
 *
 * - Saving transcodes PLY→SPZ on the main thread and holds a ~65MB ArrayBuffer
 *   per video, so a second one freezes the tab and a third can take it out with
 *   an OOM. Hence SAVE_LIMIT of one.
 * - /api/capture/submit calls req.formData(), buffering an entire video in the
 *   Node process before it relays anything to KIRI.
 * - /api/capture/model unzips KIRI's result with fflate's synchronous
 *   unzipSync, which blocks the Node event loop for the whole decompress.
 * - extractAudio opens two OfflineAudioContexts per video and reads the whole
 *   file into memory to decode it. Browsers cap how many audio contexts one
 *   document may hold — around six — and refuse the ones past that. Which is
 *   the reason for AUDIO_LIMIT of two rather than a higher one: the refusal is
 *   silent. extractAudio answers null, null is also what a video with no sound
 *   answers, and the capture is saved mute with nothing said about it.
 *
 * The gate is FIFO, so the first video a user picked is also the first one that
 * finishes.
 */
export const UPLOAD_LIMIT = 2;
export const DOWNLOAD_LIMIT = 2;
export const SAVE_LIMIT = 1;
export const AUDIO_LIMIT = 2;

export function createLimiter(
  max: number,
): <T>(task: () => Promise<T>) => Promise<T> {
  const ceiling = Math.max(1, Math.floor(max)); // Below one, nothing ever runs.
  let active = 0;
  const waiting: Array<() => void> = [];

  function release() {
    // The freed slot passes straight to the next waiter instead of being given
    // back to the pool: a caller arriving in the gap before that waiter resumes
    // would otherwise claim it too and put two extra tasks in flight.
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  }

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active < ceiling) active += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      // A rejected task still owes its slot back, and its rejection belongs to
      // its own caller alone — the queue behind it carries on.
      release();
    }
  };
}
