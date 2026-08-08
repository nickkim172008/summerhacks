import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { DEMO_MAP_PLACES } from "./demoMapData";

/** Fallback before GPS resolves (downtown Toronto). */
export const DEFAULT_MAP_CENTER = {
  lat: 43.6532,
  lng: -79.3832,
} as const;

export const CITY_ZOOM = 13;

export type HeatWeightedPoint = {
  location: google.maps.LatLng;
  weight: number;
};

export type GoogleMapsLibs = {
  Map: typeof google.maps.Map;
  LatLng: typeof google.maps.LatLng;
  LatLngBounds: typeof google.maps.LatLngBounds;
  Marker: typeof google.maps.Marker;
  InfoWindow: typeof google.maps.InfoWindow;
  // visualization.HeatmapLayer is stubbed in @types — keep loose
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HeatmapLayer: new (opts?: any) => any;
  SymbolPath: typeof google.maps.SymbolPath;
};

export function getGoogleMapsApiKey() {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? "";
}

export function isGoogleMapsConfigured() {
  return Boolean(getGoogleMapsApiKey());
}

let libsPromise: Promise<GoogleMapsLibs> | null = null;

/** Load Maps JS + visualization heatmap library once. */
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
        const visualization = await importLibrary("visualization");
        await importLibrary("marker");
        return {
          Map: maps.Map,
          LatLng: google.maps.LatLng,
          LatLngBounds: google.maps.LatLngBounds,
          Marker: google.maps.Marker,
          InfoWindow: maps.InfoWindow,
          HeatmapLayer: (
            visualization as unknown as {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              HeatmapLayer: new (opts?: any) => any;
            }
          ).HeatmapLayer,
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

/** Always have something to heat — fall back to Toronto demo pins. */
export function heatPlacesFor(
  places: { id: string; location: { lat: number; lng: number } }[],
) {
  return places.length > 0 ? places : placesWithLocation(DEMO_MAP_PLACES);
}

/**
 * Weighted points for google.maps.visualization.HeatmapLayer.
 * Demo pins expand into dense clouds so the overlay is obvious.
 */
export function placesToHeatData(
  places: { id: string; location: { lat: number; lng: number } }[],
): HeatWeightedPoint[] {
  const points: HeatWeightedPoint[] = [];
  const source = heatPlacesFor(places);

  for (const place of source) {
    const copies = place.id.startsWith("demo-map-") ? 12 : 3;
    for (let i = 0; i < copies; i++) {
      const seed = hashStr(`${place.id}:${i}`);
      const jitterLat = i === 0 ? 0 : ((seed % 1000) / 1000 - 0.5) * 0.01;
      const jitterLng =
        i === 0 ? 0 : (((seed >>> 10) % 1000) / 1000 - 0.5) * 0.01;
      points.push({
        location: new google.maps.LatLng(
          place.location.lat + jitterLat,
          place.location.lng + jitterLng,
        ),
        weight: place.id.startsWith("demo-map-") ? 2 : 1,
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
