import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

/** Fallback before GPS resolves (downtown Toronto). */
export const DEFAULT_MAP_CENTER = {
  lat: 43.6532,
  lng: -79.3832,
} as const;

export const CITY_ZOOM = 13;

export function getGoogleMapsApiKey() {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? "";
}

export function isGoogleMapsConfigured() {
  return Boolean(getGoogleMapsApiKey());
}

let ready: Promise<void> | null = null;

/** Load Maps JS + visualization (heatmap) once. */
export function loadGoogleMaps() {
  if (!ready) {
    const key = getGoogleMapsApiKey();
    if (!key) {
      ready = Promise.reject(
        new Error("Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"),
      );
    } else {
      setOptions({ key, v: "weekly" });
      ready = Promise.all([
        importLibrary("maps"),
        importLibrary("visualization"),
        importLibrary("marker"),
      ]).then(() => undefined);
    }
  }
  return ready;
}

export function placesWithLocation<
  T extends { location?: { lat: number; lng: number } },
>(places: T[]) {
  return places.filter(
    (p): p is T & { location: { lat: number; lng: number } } =>
      Boolean(
        p.location &&
          Number.isFinite(p.location.lat) &&
          Number.isFinite(p.location.lng),
      ),
  );
}

/**
 * Heatmap points. Demo pins are jittered into small clouds so the layer
 * reads clearly with few real users.
 */
export function placesToLatLngs(
  places: { id: string; location: { lat: number; lng: number } }[],
): google.maps.LatLngLiteral[] {
  const points: google.maps.LatLngLiteral[] = [];
  for (const place of places) {
    const copies = place.id.startsWith("demo-map-") ? 8 : 1;
    for (let i = 0; i < copies; i++) {
      const seed = hashStr(`${place.id}:${i}`);
      const jitterLat = i === 0 ? 0 : ((seed % 1000) / 1000 - 0.5) * 0.012;
      const jitterLng =
        i === 0 ? 0 : (((seed >>> 10) % 1000) / 1000 - 0.5) * 0.012;
      points.push({
        lat: place.location.lat + jitterLat,
        lng: place.location.lng + jitterLng,
      });
    }
  }
  return points;
}

function hashStr(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0;
  }
  return h;
}
