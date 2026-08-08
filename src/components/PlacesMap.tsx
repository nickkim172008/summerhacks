"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  GeolocateControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { CITY_ZOOM, DEFAULT_MAP_CENTER, MAP_STYLE } from "@/lib/maps";
import type { LatLng } from "@/lib/geolocation";
import type { Place } from "@/lib/types";

type LocatedPlace = Place & { location: { lat: number; lng: number } };

const SOURCE_ID = "places";
const HEAT_LAYER = "places-heat";
const POINT_LAYER = "places-points";

export default function PlacesMap({
  places,
  liveLocation = null,
  className = "",
}: {
  places: LocatedPlace[];
  liveLocation?: LatLng | null;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const liveMarkerRef = useRef<Marker | null>(null);
  const placesRef = useRef(places);
  const liveRef = useRef(liveLocation);
  const didCenterOnLiveRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  placesRef.current = places;
  liveRef.current = liveLocation;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const start = liveRef.current ?? DEFAULT_MAP_CENTER;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: containerRef.current,
        style: MAP_STYLE,
        center: [start.lng, start.lat],
        zoom: CITY_ZOOM,
        attributionControl: { compact: true },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the map");
      return;
    }

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showAccuracyCircle: true,
        showUserLocation: false,
      }),
      "top-right",
    );
    mapRef.current = map;

    const resize = () => map.resize();
    requestAnimationFrame(resize);
    const ro = new ResizeObserver(resize);
    ro.observe(containerRef.current);

    map.on("error", (e) => {
      const message = e.error?.message ?? "Map failed to load tiles";
      // Ignore noisy tile aborts; surface real failures.
      if (!/abort|cancel/i.test(message)) setError(message);
    });

    map.on("load", () => {
      setError(null);
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: toFeatureCollection(placesRef.current),
        });
      }

      if (!map.getLayer(HEAT_LAYER)) {
        map.addLayer({
          id: HEAT_LAYER,
          type: "heatmap",
          source: SOURCE_ID,
          maxzoom: 17,
          paint: {
            "heatmap-weight": 1,
            "heatmap-intensity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              0.5,
              14,
              1.3,
            ],
            "heatmap-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              6,
              14,
              32,
            ],
            "heatmap-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              12,
              0.85,
              16,
              0.4,
            ],
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(0,113,227,0)",
              0.2,
              "rgba(0,113,227,0.35)",
              0.45,
              "rgba(52,199,89,0.55)",
              0.7,
              "rgba(255,204,0,0.7)",
              1,
              "rgba(255,59,48,0.85)",
            ],
          },
        });
      }

      if (!map.getLayer(POINT_LAYER)) {
        map.addLayer({
          id: POINT_LAYER,
          type: "circle",
          source: SOURCE_ID,
          minzoom: 11,
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              11,
              4,
              16,
              9,
            ],
            "circle-color": "#0071e3",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
            "circle-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              11,
              0.4,
              13,
              1,
            ],
          },
        });
      }

      map.on("mouseenter", POINT_LAYER, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", POINT_LAYER, () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("click", POINT_LAYER, (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const [lng, lat] = feature.geometry.coordinates as [number, number];
        const name = String(feature.properties?.name ?? "Environment");
        const id = String(feature.properties?.id ?? "");
        const isDemo = id.startsWith("demo-map-");
        new Popup({ offset: 12 })
          .setLngLat([lng, lat])
          .setHTML(
            `<div style="font:14px/1.3 -apple-system,BlinkMacSystemFont,sans-serif;padding:2px 4px">
              <strong>${escapeHtml(name)}</strong><br/>
              ${
                isDemo
                  ? `<span style="color:#86868b">Demo pin</span>`
                  : `<a href="/place/${escapeHtml(id)}" style="color:#0071e3;text-decoration:none">Open environment →</a>`
              }
            </div>`,
          )
          .addTo(map);
      });

      resize();

      if (liveRef.current) {
        ensureLiveMarker(map, liveRef.current, liveMarkerRef);
        centerOnLive(
          map,
          liveRef.current,
          placesRef.current,
          didCenterOnLiveRef,
        );
      } else if (placesRef.current.length > 0) {
        fitToPlaces(map, placesRef.current);
      }
    });

    return () => {
      ro.disconnect();
      liveMarkerRef.current?.remove();
      liveMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      didCenterOnLiveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      if (!source) return;
      source.setData(toFeatureCollection(places));
      if (places.length > 0 && !liveRef.current) {
        fitToPlaces(map, places);
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [places]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !liveLocation) return;

    const apply = () => {
      ensureLiveMarker(map, liveLocation, liveMarkerRef);
      centerOnLive(map, liveLocation, placesRef.current, didCenterOnLiveRef);
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [liveLocation]);

  return (
    <div className={`relative h-full w-full ${className}`}>
      <div ref={containerRef} className="places-map absolute inset-0 h-full w-full" />
      {error && (
        <div className="absolute inset-x-4 bottom-24 z-10 rounded-xl bg-white/95 px-4 py-3 text-center text-sm text-red-600 shadow-lg ring-1 ring-black/10">
          Map error: {error}
        </div>
      )}
    </div>
  );
}

function centerOnLive(
  map: MapLibreMap,
  live: LatLng,
  places: LocatedPlace[],
  didCenterRef: MutableRefObject<boolean>,
) {
  if (didCenterRef.current) return;
  didCenterRef.current = true;

  if (places.length > 0) {
    const bounds = new LngLatBounds();
    bounds.extend([live.lng, live.lat]);
    for (const place of places) {
      bounds.extend([place.location.lng, place.location.lat]);
    }
    map.fitBounds(bounds, {
      padding: 80,
      maxZoom: CITY_ZOOM + 1,
      duration: 800,
    });
    return;
  }

  map.easeTo({
    center: [live.lng, live.lat],
    zoom: CITY_ZOOM,
    duration: 800,
  });
}

function ensureLiveMarker(
  map: MapLibreMap,
  location: LatLng,
  markerRef: MutableRefObject<Marker | null>,
) {
  if (!markerRef.current) {
    const el = document.createElement("div");
    el.className = "live-location-dot";
    el.innerHTML = `<span class="live-location-pulse"></span><span class="live-location-core"></span>`;
    markerRef.current = new Marker({ element: el, anchor: "center" })
      .setLngLat([location.lng, location.lat])
      .addTo(map);
  } else {
    markerRef.current.setLngLat([location.lng, location.lat]);
  }
}

function toFeatureCollection(
  places: LocatedPlace[],
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: places.map((place) => ({
      type: "Feature",
      properties: { id: place.id, name: place.name },
      geometry: {
        type: "Point",
        coordinates: [place.location.lng, place.location.lat],
      },
    })),
  };
}

function fitToPlaces(map: MapLibreMap, places: LocatedPlace[]) {
  if (places.length === 0) return;
  if (places.length === 1) {
    map.easeTo({
      center: [places[0].location.lng, places[0].location.lat],
      zoom: CITY_ZOOM,
      duration: 500,
    });
    return;
  }
  const bounds = new LngLatBounds();
  for (const place of places) {
    bounds.extend([place.location.lng, place.location.lat]);
  }
  map.fitBounds(bounds, {
    padding: 64,
    maxZoom: CITY_ZOOM + 1,
    duration: 500,
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
