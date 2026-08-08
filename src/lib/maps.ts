import type { StyleSpecification } from "maplibre-gl";

/**
 * Esri World Street Map — free raster basemap with real city streets.
 * (OpenStreetMap’s public tile endpoint often 403s; OpenFreeMap can fail
 * behind some networks. Esri’s CDN is reliable for demos.)
 */
export const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    streets: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Tiles © Esri",
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "streets",
      type: "raster",
      source: "streets",
    },
  ],
};

/** Fallback before GPS resolves (downtown Toronto). */
export const DEFAULT_MAP_CENTER = {
  lat: 43.6532,
  lng: -79.3832,
} as const;

export const CITY_ZOOM = 13;

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
