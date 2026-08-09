/**
 * A still lifted off the walkthrough, to stand in for the environment in a grid
 * before anyone opens it.
 *
 * It is taken here, while the video is being picked, rather than off the
 * finished splat — for the same reason the audio is. Reconstruction is 30-90
 * minutes out, the source File is dropped the moment the upload lands, and no
 * File survives a reload, so this is the only window in which the video can be
 * asked anything at all. What comes back is cached beside the audio track and
 * read again when there is finally a Place to attach it to.
 *
 * Two seconds in, not the opening frame: a walkthrough starts on a floor, a
 * ceiling, or a blur while the phone is still coming up, and by two seconds it
 * is pointing at the room.
 */
const POSTER_SECONDS = 2;

/**
 * Longest edge. A grid tile is a few hundred CSS pixels at most, so this covers
 * a retina one with room to spare and still lands well under 100 KB — small
 * enough that keeping one per queued capture costs nothing.
 */
const MAX_EDGE = 640;
const JPEG_QUALITY = 0.82;

/**
 * A decode that never finishes has to end somewhere. Generous, because this
 * races nothing: the splat it belongs to is an hour out either way.
 */
const TIMEOUT_MS = 10_000;

/**
 * A frame off `file` as a JPEG, or null if this browser could not decode it.
 * Never throws — a walkthrough whose video cannot be rendered is still a
 * walkthrough, and it is saved with the gradient tile it would have had anyway.
 */
export async function grabPoster(file: File): Promise<Blob | null> {
  if (typeof document === "undefined") return null;

  const el = document.createElement("video");
  const url = URL.createObjectURL(file);
  try {
    el.preload = "auto";
    // Muted and inline or a browser may decline to decode at all, having
    // decided this is a video that wants permission to play.
    el.muted = true;
    el.playsInline = true;
    return (await seekTo(el, url, POSTER_SECONDS)) ? await toJpeg(el) : null;
  } catch {
    return null;
  } finally {
    // Releasing the object URL alone is not enough: an element still holding a
    // source keeps its decoder, and the file behind it, resident.
    el.removeAttribute("src");
    el.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * Whether a frame at roughly `seconds` is decoded and ready to be drawn.
 * Handlers go on before the source does, since a cached blob can reach
 * `loadedmetadata` in the same task the assignment starts.
 */
function seekTo(
  el: HTMLVideoElement,
  url: string,
  seconds: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;

    function done(ready: boolean) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ready);
    }

    // A container this browser cannot decode, or a seek that never lands.
    const timer = setTimeout(() => done(false), TIMEOUT_MS);
    el.onerror = () => done(false);
    el.onseeked = () => done(true);
    el.onloadedmetadata = () => {
      const duration = el.duration;
      // A walkthrough shorter than the target is all there is to choose from,
      // so take its middle instead of running off the end. The floor matters:
      // seeking to where the playhead already sits fires no `seeked` at all,
      // and the wait would run out for a video that decoded perfectly well.
      el.currentTime =
        Number.isFinite(duration) && duration > seconds
          ? seconds
          : Math.max((duration || 0) / 2, 0.1);
    };

    el.src = url;
  });
}

/** Downscaled to fit MAX_EDGE, aspect intact — the tiles crop it themselves. */
function toJpeg(el: HTMLVideoElement): Promise<Blob | null> {
  const { videoWidth, videoHeight } = el;
  if (!videoWidth || !videoHeight) return Promise.resolve(null);

  const scale = Math.min(1, MAX_EDGE / Math.max(videoWidth, videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(videoWidth * scale));
  canvas.height = Math.max(1, Math.round(videoHeight * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  // Synchronous, so the pixels are copied out before the caller tears the
  // element and its object URL down.
  ctx.drawImage(el, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
}
