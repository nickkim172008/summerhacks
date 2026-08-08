"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import Link from "next/link";
import {
  CITY_ZOOM,
  DEFAULT_MAP_CENTER,
  isGoogleMapsConfigured,
  loadGoogleMaps,
  placesToHeatData,
  type GoogleMapsLibs,
} from "@/lib/maps";
import type { LatLng } from "@/lib/geolocation";
import type { Place } from "@/lib/types";

type LocatedPlace = Place & { location: { lat: number; lng: number } };

type HeatmapLayerLike = {
  setData: (data: unknown) => void;
  setMap: (map: google.maps.Map | null) => void;
};

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
  const mapRef = useRef<google.maps.Map | null>(null);
  const libsRef = useRef<GoogleMapsLibs | null>(null);
  const heatRef = useRef<HeatmapLayerLike | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const liveMarkerRef = useRef<google.maps.Marker | null>(null);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const placesRef = useRef(places);
  const liveRef = useRef(liveLocation);
  const didCenterRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  placesRef.current = places;
  liveRef.current = liveLocation;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!isGoogleMapsConfigured()) {
      setError("missing-key");
      return;
    }

    let cancelled = false;

    async function init() {
      try {
        const libs = await loadGoogleMaps();
        if (cancelled || !containerRef.current) return;
        libsRef.current = libs;

        const start = liveRef.current ?? DEFAULT_MAP_CENTER;
        const map = new libs.Map(containerRef.current, {
          center: start,
          zoom: CITY_ZOOM,
          mapTypeControl: false,
          streetViewControl: true,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: "greedy",
        });
        mapRef.current = map;
        infoRef.current = new libs.InfoWindow();

        // Heatmap sits on top of the Google basemap.
        const heat = new libs.HeatmapLayer({
          data: placesToHeatData(placesRef.current),
          map,
          radius: 56,
          opacity: 0.9,
          maxIntensity: 4,
          dissipating: true,
        }) as HeatmapLayerLike;
        heatRef.current = heat;

        syncMarkers(libs, map, placesRef.current, markersRef, infoRef);
        fitMap(libs, map, placesRef.current, liveRef.current, didCenterRef);

        if (liveRef.current) {
          ensureLiveMarker(libs, map, liveRef.current, liveMarkerRef);
        }

        setReady(true);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not load Google Maps",
        );
      }
    }

    void init();

    return () => {
      cancelled = true;
      heatRef.current?.setMap(null);
      heatRef.current = null;
      for (const marker of markersRef.current) marker.setMap(null);
      markersRef.current = [];
      liveMarkerRef.current?.setMap(null);
      liveMarkerRef.current = null;
      infoRef.current?.close();
      mapRef.current = null;
      libsRef.current = null;
      didCenterRef.current = false;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const libs = libsRef.current;
    if (!map || !libs || !ready) return;

    const data = placesToHeatData(places);
    heatRef.current?.setData(data);
    // Keep heat on top if the map reorders overlays.
    heatRef.current?.setMap(map);

    syncMarkers(libs, map, places, markersRef, infoRef);
    if (!didCenterRef.current) {
      fitMap(libs, map, places, liveRef.current, didCenterRef);
    }
  }, [places, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const libs = libsRef.current;
    if (!map || !libs || !ready || !liveLocation) return;
    ensureLiveMarker(libs, map, liveLocation, liveMarkerRef);
    if (!didCenterRef.current) {
      fitMap(libs, map, placesRef.current, liveLocation, didCenterRef);
    }
  }, [liveLocation, ready]);

  if (error === "missing-key") {
    return (
      <div
        className={`flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-neutral-500 ${className}`}
      >
        <p>Add your Google Maps key to show the map + heatmap.</p>
        <p>
          Set{" "}
          <code className="text-[#1d1d1f]">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>{" "}
          in <code className="text-[#1d1d1f]">.env.local</code>, enable{" "}
          <strong className="font-medium text-[#1d1d1f]">
            Maps JavaScript API
          </strong>
          , and restart the server.
        </p>
        <Link
          href="https://console.cloud.google.com/google/maps-apis"
          className="text-[#0071e3]"
        >
          Google Cloud Maps APIs →
        </Link>
      </div>
    );
  }

  return (
    <div className={`relative h-full w-full ${className}`}>
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />
      <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-full bg-white/95 px-3 py-1 text-[11px] font-medium text-[#1d1d1f] shadow ring-1 ring-black/10">
        Heatmap on · {places.length || "demo"} spots
      </div>
      {error && error !== "missing-key" && (
        <div className="absolute inset-x-4 bottom-24 z-10 rounded-xl bg-white/95 px-4 py-3 text-center text-sm text-red-600 shadow-lg ring-1 ring-black/10">
          Map error: {error}
        </div>
      )}
    </div>
  );
}

function syncMarkers(
  libs: GoogleMapsLibs,
  map: google.maps.Map,
  places: LocatedPlace[],
  markersRef: MutableRefObject<google.maps.Marker[]>,
  infoRef: MutableRefObject<google.maps.InfoWindow | null>,
) {
  for (const marker of markersRef.current) marker.setMap(null);

  markersRef.current = places.map((place) => {
    const marker = new libs.Marker({
      map,
      position: place.location,
      title: place.name,
      opacity: 0.95,
      icon: {
        path: libs.SymbolPath.CIRCLE,
        scale: 6,
        fillColor: "#0071e3",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
      },
    });
    marker.addListener("click", () => {
      const info = infoRef.current;
      if (!info) return;
      const isDemo = place.id.startsWith("demo-map-");
      info.setContent(
        `<div style="font:14px/1.3 -apple-system,BlinkMacSystemFont,sans-serif;padding:2px 4px">
          <strong>${escapeHtml(place.name)}</strong><br/>
          ${
            isDemo
              ? `<span style="color:#86868b">Demo pin</span>`
              : `<a href="/place/${escapeHtml(place.id)}" style="color:#0071e3;text-decoration:none">Open environment →</a>`
          }
        </div>`,
      );
      info.open({ map, anchor: marker });
    });
    return marker;
  });
}

function ensureLiveMarker(
  libs: GoogleMapsLibs,
  map: google.maps.Map,
  location: LatLng,
  markerRef: MutableRefObject<google.maps.Marker | null>,
) {
  if (!markerRef.current) {
    markerRef.current = new libs.Marker({
      map,
      position: location,
      title: "You are here",
      zIndex: 999,
      icon: {
        path: libs.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: "#0071e3",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 3,
      },
    });
  } else {
    markerRef.current.setPosition(location);
  }
}

function fitMap(
  libs: GoogleMapsLibs,
  map: google.maps.Map,
  places: LocatedPlace[],
  live: LatLng | null | undefined,
  didCenterRef: MutableRefObject<boolean>,
) {
  if (didCenterRef.current) return;

  if (places.length === 0) {
    map.setCenter(live ?? DEFAULT_MAP_CENTER);
    map.setZoom(CITY_ZOOM);
    didCenterRef.current = true;
    return;
  }

  const bounds = new libs.LatLngBounds();
  for (const place of places) bounds.extend(place.location);
  if (live) bounds.extend(live);
  map.fitBounds(bounds, 72);
  didCenterRef.current = true;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
