/**
 * Turning an image somebody picked into one worth storing.
 *
 * Every picture this app keeps — an avatar, an album cover, a thumbnail chosen
 * by hand over the frame taken off the video — arrives the same way: whatever
 * the camera roll handed over, which on a current phone is a twelve-megapixel
 * HEIC. Behind a tile a few hundred pixels wide those are bytes nobody will
 * ever look at, and it is the person uploading who waits for them. So each one
 * is decoded, drawn down to the size its frame actually needs, and re-encoded
 * as a JPEG on the way out.
 */

/** Refused before decoding, since a panorama can be enormous. */
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const QUALITY = 0.88;

/**
 * Shows only where a squared image cannot cover its frame, which the cover
 * scaling below makes near-impossible — it is here so a rounding error reads as
 * the page's own grey rather than as black.
 */
const MATTE = "#f5f5f7";

/** Round, and small on every screen it appears on. */
export const AVATAR_EDGE = 512;

/**
 * A place thumbnail and an album cover are the same tile at different sizes —
 * a few hundred CSS pixels at the largest, so this covers a retina one with
 * room to spare and still lands well under 100 KB.
 */
export const THUMBNAIL_EDGE = 640;
export const COVER_EDGE = 640;

export interface PrepareImageOptions {
  /** Cap on the longer side, in pixels. */
  maxEdge: number;
  /** Centre-crop to a square, for the frames that are one. */
  square?: boolean;
}

/**
 * A JPEG of `file` sized for its frame. Throws with something worth showing
 * when the file is not an image, is too big to be worth decoding, or cannot be
 * read — all three of which are ordinary things to pick by mistake.
 */
export async function prepareImage(
  file: File,
  { maxEdge, square = false }: PrepareImageOptions,
): Promise<Blob> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("That image is too large. Try one under 12 MB.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    return await redraw(bitmap, maxEdge, square);
  } finally {
    bitmap.close();
  }
}

function redraw(bitmap: ImageBitmap, maxEdge: number, square: boolean) {
  // A square frame is filled by the shorter side and the overflow cropped,
  // which means scaling up a picture smaller than the frame rather than
  // matting it. A free frame only ever shrinks: enlarging to fill a cap that
  // was meant as a ceiling would be inventing detail.
  const scale = square
    ? maxEdge / Math.min(bitmap.width, bitmap.height)
    : Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement("canvas");
  canvas.width = square ? maxEdge : Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = square
    ? maxEdge
    : Math.max(1, Math.round(bitmap.height * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process that image.");
  ctx.fillStyle = MATTE;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  ctx.drawImage(
    bitmap,
    (canvas.width - drawWidth) / 2,
    (canvas.height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not process that image.")),
      "image/jpeg",
      QUALITY,
    ),
  );
}
