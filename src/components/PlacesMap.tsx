"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import Link from "next/link";
import { createCanvasHeatmap } from "@/lib/canvasHeatmap";
import {
  CITY_ZOOM,
  DEFAULT_MAP_CENTER,
  isGoogleMapsConfigured,
  loadGoogleMaps,
  placesToHeatPoints,
  type GoogleMapsLibs,
} from "@/lib/maps";
import type { LatLng } from "@/lib/geolocation";
import type { Place } from "@/lib/types";

type LocatedPlace = Place & { location: { lat: number; lng: number } };

type HeatHandle = {
  setMap: (map: google.maps.Map | null) => void;
  setData: (points: ReturnType<typeof placesToHeatPoints>) => void;
};

/** One point to fly the camera to, and how far in to end up. */
export type MapFocus = { lat: number; lng: number; zoom: number };

/** Long enough for panTo's own glide to land before the zoom starts on top. */
const FOCUS_PAN_MS = 550;
/**
 * Zoom is stepped rather than set: Maps redraws a single large setZoom as a
 * cut, and the walkthrough's opening is meant to read as arriving somewhere.
 */
const FOCUS_ZOOM_STEPS = 4;
const FOCUS_ZOOM_STEP_MS = 220;

export default function PlacesMap({
  places,
  liveLocation = null,
  focus = null,
  className = "",
  weightOf,
}: {
  places: LocatedPlace[];
  liveLocation?: LatLng | null;
  /**
   * Set to hand the camera to one place — the walkthrough's opening flight.
   * The heatmap is untouched; this moves the viewport and nothing else.
   */
  focus?: MapFocus | null;
  className?: string;
  /**
   * How hard to draw each point, 0..1. Absent means full strength, which is
   * every caller but the timeline: it fades a capture in as the playhead
   * reaches it, and needs an identity that only changes when the picture does,
   * since each new one repaints the whole canvas.
   */
  weightOf?: (place: LocatedPlace) => number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const libsRef = useRef<GoogleMapsLibs | null>(null);
  const heatRef = useRef<HeatHandle | null>(null);
  const liveMarkerRef = useRef<google.maps.Marker | null>(null);
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

        const heat = createCanvasHeatmap(libs.OverlayView);
        // Full strength for the first paint; the effect below re-weights as
        // soon as ready flips, which is the frame after this one.
        heat.setData(placesToHeatPoints(placesRef.current));
        heat.setMap(map);
        heatRef.current = heat;

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
      liveMarkerRef.current?.setMap(null);
      liveMarkerRef.current = null;
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

    heatRef.current?.setData(placesToHeatPoints(places, weightOf));
    if (!didCenterRef.current) {
      fitMap(libs, map, places, liveRef.current, didCenterRef);
    }
  }, [places, ready, weightOf]);

  useEffect(() => {
    const map = mapRef.current;
    const libs = libsRef.current;
    if (!map || !libs || !ready || !liveLocation) return;
    ensureLiveMarker(libs, map, liveLocation, liveMarkerRef);
    if (!didCenterRef.current) {
      fitMap(libs, map, placesRef.current, liveLocation, didCenterRef);
    }
  }, [liveLocation, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focus) return;
    // The flight owns the camera from here. Without this the one-time fit to
    // the scope can still fire — the places arrive after the map does — and
    // pull the viewport back out over the top of it.
    didCenterRef.current = true;

    map.panTo({ lat: focus.lat, lng: focus.lng });
    const from = map.getZoom() ?? CITY_ZOOM;
    const timers = Array.from({ length: FOCUS_ZOOM_STEPS }, (_, step) => {
      const at = (step + 1) / FOCUS_ZOOM_STEPS;
      return window.setTimeout(
        () => map.setZoom(Math.round(from + (focus.zoom - from) * at)),
        FOCUS_PAN_MS + step * FOCUS_ZOOM_STEP_MS,
      );
    });
    return () => timers.forEach(window.clearTimeout);
  }, [focus, ready]);

  if (error === "missing-key") {
    return (
      <div
        className={`flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-neutral-500 ${className}`}
      >
        <p>Add your Google Maps key to show the map + heatmap.</p>
        <p>
          Set{" "}
          <code className="text-[#1d1d1f]">
            NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
          </code>{" "}
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
        Heatmap on · {places.length} spots
      </div>
      {error && error !== "missing-key" && (
        <div className="absolute inset-x-4 bottom-24 z-10 rounded-xl bg-white/95 px-4 py-3 text-center text-sm text-red-600 shadow-lg ring-1 ring-black/10">
          Map error: {error}
        </div>
      )}
    </div>
  );
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
        scale: 9,
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
