/**
 * Pulls the next capture's bytes down while the current one is on screen.
 *
 * A published capture is five or six megabytes and the fade between two of them
 * is under half a second, so a walkthrough that starts downloading on arrival
 * is a slideshow of loading screens. /api/places/asset serves these immutable
 * for a year, so a plain fetch leaves them in the browser's own HTTP cache and
 * the SplatMesh's fetch for the identical URL reads off disk instead.
 *
 * Deliberately not splatCache. Cache Storage is only reachable by code that
 * reads it back, and nothing does here: Spark takes a URL and fetches it inside
 * its own worker. Writing there would evict the capture pipeline's blobs — a
 * hundred megabytes and an hour of reconstruction each, under a six-entry
 * budget — to store bytes no one would ever read.
 */
import { storedAssetUrl } from "./assetUrl";

/**
 * One warm per URL per session. A second fetch would be a cache hit rather than
 * a download, but the tour asks for the same neighbour on every step back and
 * forth, and each ask reads the whole body into memory to complete it.
 */
const warmed = new Set<string>();

export async function warmSplat(splatUrl: string | undefined) {
  if (!splatUrl || typeof fetch === "undefined") return;

  const url = storedAssetUrl(splatUrl);
  if (warmed.has(url)) return;
  warmed.add(url);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      // Some older records name files that are not in storage. The tour says so
      // when it gets there; there is nothing to warm in the meantime, and
      // forgetting the attempt lets a later retry find a file that has landed.
      warmed.delete(url);
      return;
    }
    // A response only enters the cache once it has been read to the end.
    await response.blob();
  } catch {
    warmed.delete(url);
  }
}
