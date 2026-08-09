import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

/** Fallback before GPS resolves (downtown Toronto). */
export const DEFAULT_MAP_CENTER = {
  lat: 43.6532,
  lng: -79.3832,
} as const;

export const CITY_ZOOM = 13;

export type GoogleMapsLibs = {
  Map: typeof google.maps.Map;
  LatLng: typeof google.maps.LatLng;
  LatLngBounds: typeof google.maps.LatLngBounds;
  Marker: typeof google.maps.Marker;
  InfoWindow: typeof google.maps.InfoWindow;
  OverlayView: typeof google.maps.OverlayView;
  SymbolPath: typeof google.maps.SymbolPath;
};

export function getGoogleMapsApiKey() {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? "";
}

export function isGoogleMapsConfigured() {
  return Boolean(getGoogleMapsApiKey());
}

let libsPromise: Promise<GoogleMapsLibs> | null = null;

/**
 * Load current Maps JS. Native HeatmapLayer was removed in 3.65 —
 * we render heat via canvas OverlayView instead.
 */
export function loadGoogleMaps(): Promise<GoogleMapsLibs> {
  if (!libsPromise) {
    const key = getGoogleMapsApiKey();
    if (!key) {
      libsPromise = Promise.reject(
        new Error("Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"),
      );
    } else {
      setOptions({ key, v: "weekly" });
      libsPromise = (async () => {
        const maps = await importLibrary("maps");
        await importLibrary("marker");
        return {
          Map: maps.Map,
          LatLng: google.maps.LatLng,
          LatLngBounds: google.maps.LatLngBounds,
          Marker: google.maps.Marker,
          InfoWindow: maps.InfoWindow,
          OverlayView: google.maps.OverlayView,
          SymbolPath: google.maps.SymbolPath,
        };
      })();
    }
  }
  return libsPromise;
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

export type HeatPoint = {
  lat: number;
  lng: number;
  weight: number;
};

/**
 * One heat point per place; density drives the colour. `weightOf` is how the
 * map timeline fades a capture in: a point that climbs from nothing to one
 * warms its patch of the map instead of arriving at full strength.
 */
export function placesToHeatPoints<
  T extends { location: { lat: number; lng: number } },
>(places: T[], weightOf?: (place: T) => number): HeatPoint[] {
  return places.map((place) => ({
    lat: place.location.lat,
    lng: place.location.lng,
    weight: weightOf ? weightOf(place) : 1,
  }));
}
