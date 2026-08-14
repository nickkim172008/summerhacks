/**
 * Standing between a walkthrough's real coordinates and what gets stored.
 *
 * A phone writes GPS into the video container, and this app reads it — which is
 * the feature that puts a capture on the map without anyone typing anything. It
 * is also the feature that publishes the filming location of a room to everyone
 * who opens a public journey, and a room is usually somebody's home. The map
 * only needs pins that look like a life; it does not need true ones.
 *
 * So a capture is pinned somewhere in Toronto that is not where it was filmed.
 */

/**
 * Toronto proper, near enough. Wide enough that a scatter reads as a city
 * rather than a cluster, and stops short of the lake on the south edge so no
 * capture lands in open water.
 */
const TORONTO = {
  minLat: 43.628,
  maxLat: 43.798,
  minLng: -79.545,
  maxLng: -79.255,
} as const;

/**
 * On unless explicitly turned off. A privacy default that has to be switched on
 * protects nobody, and the cost of it being wrong runs one way: a pin that is
 * vague when it could have been exact is a small loss, and a pin that is exact
 * when it should have been vague cannot be taken back once a journey is public.
 */
export const ANONYMISE_LOCATIONS =
  process.env.NEXT_PUBLIC_ANONYMISE_LOCATIONS !== "false";

/**
 * A stable 32-bit hash. Not for security — only to turn an id into the same
 * number every time, which is the whole point below.
 */
function hash(seed: string) {
  let value = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    value ^= seed.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/**
 * Where a capture is pinned instead of where it was filmed.
 *
 * Derived from the seed rather than drawn fresh, so one capture keeps one pin.
 * A random point per read would slide a place around the map between visits,
 * scatter a journey's captures differently every time a tour played, and make
 * two viewers of the same public place disagree about where it is — all of
 * which read as a broken map rather than a private one.
 *
 * Deriving it from an id also means nothing has to be stored to remember the
 * choice, and no real coordinate has to be kept anywhere to map back from.
 */
export function anonymisedLocation(seed: string): { lat: number; lng: number } {
  const h = hash(seed);
  // Two independent halves: the low and high bits of one hash, so latitude and
  // longitude do not move together and the scatter does not fall on a diagonal.
  const a = (h & 0xffff) / 0xffff;
  const b = ((h >>> 16) & 0xffff) / 0xffff;
  return {
    lat: TORONTO.minLat + a * (TORONTO.maxLat - TORONTO.minLat),
    lng: TORONTO.minLng + b * (TORONTO.maxLng - TORONTO.minLng),
  };
}

/**
 * The location to store for a capture: the decoy when anonymising is on, and
 * whatever was read otherwise.
 *
 * Takes the real one only to be able to return it when the feature is off — it
 * is never mixed into the seed, so no stored pin carries any trace of where the
 * walkthrough was actually filmed.
 */
export function locationToStore(
  seed: string,
  real: { lat: number; lng: number } | null | undefined,
): { lat: number; lng: number } | null {
  if (!ANONYMISE_LOCATIONS) return real ?? null;
  return anonymisedLocation(seed);
}
