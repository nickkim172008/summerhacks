const BUCKET = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "";

/**
 * Where to read a stored splat or audio track from.
 *
 * Firebase Storage serves object downloads without an access-control header
 * unless the bucket has a CORS rule, and a browser refused that header cannot
 * read the file at all — a capture that saved perfectly comes back as a black
 * screen and silence. Routing through this app's own origin sidesteps the
 * question entirely.
 *
 * Anything not in this project's bucket is handed back untouched: blob: URLs
 * from a capture that has not been saved yet, and the relative paths left by
 * the old on-disk store, both want to be fetched exactly as they are.
 */
export function storedAssetUrl(url: string) {
  if (!BUCKET) return url;
  if (!url.startsWith(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/`)) {
    return url;
  }
  return `/api/places/asset?url=${encodeURIComponent(url)}`;
}
