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
import {
  CITY_ZOOM,
  DEFAULT_MAP_CENTER,
  MAP_STYLE,
  placesToGeoJSON,
} from "@/lib/maps";
import type { LatLng } from "@/lib/geolocation";
import type { Place } from "@/lib/types";

type LocatedPlace = Place & { location: { lat: number; lng: number } };

const SOURCE_ID = "places";
const HEAT_LAYER = "places-heat";
const GLOW_LAYER = "places-glow";
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
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [spotCount, setSpotCount] = useState(places.length);
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
      const message = e.error?.message ?? "Map failed to load";
      if (!/abort|cancel/i.test(message)) setError(message);
    });

    map.on("load", () => {
      try {
        ensureHeatLayers(map, placesRef.current);
        setSpotCount(placesRef.current.length);
        setReady(true);
        setError(null);
        resize();
        fitToPlaces(map, placesRef.current);

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
          // The popup navigates in place, so hand the place page this map as
          // the way back.
          const from = encodeURIComponent(
            window.location.pathname + window.location.search,
          );
          new Popup({ offset: 12 })
            .setLngLat([lng, lat])
            .setHTML(
              `<div style="font:14px/1.3 -apple-system,BlinkMacSystemFont,sans-serif;padding:2px 4px">
                <strong>${escapeHtml(name)}</strong><br/>
                ${
                  isDemo
                    ? `<span style="color:#86868b">Demo pin</span>`
                    : `<a href="/place/${escapeHtml(id)}?from=${from}" style="color:#0071e3;text-decoration:none">Open environment →</a>`
                }
              </div>`,
            )
            .addTo(map);
        });

        if (liveRef.current) {
          ensureLiveMarker(map, liveRef.current, liveMarkerRef);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not add heatmap layers",
        );
      }
    });

    return () => {
      ro.disconnect();
      liveMarkerRef.current?.remove();
      liveMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    ensureHeatLayers(map, places);
    setSpotCount(places.length);
  }, [places, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !liveLocation) return;
    ensureLiveMarker(map, liveLocation, liveMarkerRef);
  }, [liveLocation, ready]);

  return (
    <div className={`relative h-full w-full ${className}`}>
      <div
        ref={containerRef}
        className="places-map absolute inset-0 h-full w-full"
      />
      <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-white/95 px-3 py-1 text-[11px] font-medium text-[#1d1d1f] shadow ring-1 ring-black/10">
        Heatmap · {spotCount} spots
      </div>
      {error && (
        <div className="absolute inset-x-4 bottom-24 z-10 rounded-xl bg-white/95 px-4 py-3 text-center text-sm text-red-600 shadow-lg ring-1 ring-black/10">
          Map error: {error}
        </div>
      )}
    </div>
  );
}

/** Source + heat/glow/point layers. Safe to call repeatedly. */
function ensureHeatLayers(map: MapLibreMap, places: LocatedPlace[]) {
  const data = placesToGeoJSON(places);

  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, { type: "geojson", data });
  } else {
    (map.getSource(SOURCE_ID) as GeoJSONSource).setData(data);
  }

  // Soft glow — always visible even if native heatmap fails on a GPU.
  if (!map.getLayer(GLOW_LAYER)) {
    map.addLayer({
      id: GLOW_LAYER,
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          28,
          14,
          55,
        ],
        "circle-color": "#ff3b30",
        "circle-opacity": 0.28,
        "circle-blur": 0.95,
      },
    });
  }

  // Native heatmap on top of the glow.
  if (!map.getLayer(HEAT_LAYER)) {
    map.addLayer({
      id: HEAT_LAYER,
      type: "heatmap",
      source: SOURCE_ID,
      maxzoom: 20,
      paint: {
        "heatmap-weight": 1,
        "heatmap-intensity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          1.5,
          15,
          3,
        ],
        "heatmap-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          20,
          15,
          40,
        ],
        "heatmap-opacity": 0.85,
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(33,102,172,0)",
          0.2,
          "rgb(103,169,207)",
          0.4,
          "rgb(209,229,240)",
          0.6,
          "rgb(253,219,199)",
          0.8,
          "rgb(239,138,98)",
          1,
          "rgb(178,24,43)",
        ],
      },
    });
  }

  if (!map.getLayer(POINT_LAYER)) {
    map.addLayer({
      id: POINT_LAYER,
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-radius": 5,
        "circle-color": "#0071e3",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
        "circle-opacity": 0.95,
      },
    });
  }
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

function fitToPlaces(map: MapLibreMap, places: LocatedPlace[]) {
  if (places.length === 0) {
    map.jumpTo({
      center: [DEFAULT_MAP_CENTER.lng, DEFAULT_MAP_CENTER.lat],
      zoom: CITY_ZOOM,
    });
    return;
  }
  const bounds = new LngLatBounds();
  for (const place of places) {
    bounds.extend([place.location.lng, place.location.lat]);
  }
  map.fitBounds(bounds, {
    padding: 80,
    maxZoom: CITY_ZOOM,
    duration: 600,
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
