import type { StyleSpecification } from "maplibre-gl";

/** Fallback before GPS resolves (downtown Toronto). */
export const DEFAULT_MAP_CENTER = {
  lat: 43.6532,
  lng: -79.3832,
} as const;

export const CITY_ZOOM = 13;

/** Streets only — heat layers are added in JS after load (more reliable). */
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
 * Build GeoJSON for the heat layer. Duplicates each point with slight jitter
 * so sparse demo pins still read as a dense heat cloud.
 */
export function placesToGeoJSON(
  places: { id: string; name: string; location: { lat: number; lng: number } }[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const place of places) {
    const copies = place.id.startsWith("demo-map-") ? 6 : 1;
    for (let i = 0; i < copies; i++) {
      // Deterministic jitter so setData doesn't reshuffle every render.
      const seed = hashStr(`${place.id}:${i}`);
      const jitterLat = i === 0 ? 0 : ((seed % 1000) / 1000 - 0.5) * 0.014;
      const jitterLng =
        i === 0 ? 0 : (((seed >>> 10) % 1000) / 1000 - 0.5) * 0.014;
      features.push({
        type: "Feature",
        properties: {
          id: place.id,
          name: place.name,
          mag: 3,
        },
        geometry: {
          type: "Point",
          coordinates: [
            place.location.lng + jitterLng,
            place.location.lat + jitterLat,
          ],
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

function hashStr(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0;
  }
  return h;
}
