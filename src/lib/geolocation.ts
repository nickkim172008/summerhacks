"use client";

import { useEffect, useState } from "react";

export type LatLng = { lat: number; lng: number };

export function getLiveLocation(
  options?: PositionOptions,
): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }),
      (err) => reject(new Error(err.message || "Could not read location")),
      {
        enableHighAccuracy: true,
        timeout: 12_000,
        maximumAge: 30_000,
        ...options,
      },
    );
  });
}

/** Watches the device GPS; updates as you move. */
export function useLiveLocation() {
  const [location, setLocation] = useState<LatLng | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError("Location not supported");
      setLoading(false);
      return;
    }

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err.message || "Location permission denied");
        setLoading(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5_000,
        timeout: 15_000,
      },
    );

    return () => navigator.geolocation.clearWatch(id);
  }, []);

  return { location, error, loading };
}
