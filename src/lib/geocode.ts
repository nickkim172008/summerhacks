"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { importLibrary } from "@googlemaps/js-api-loader";
import { loadGoogleMaps } from "./maps";
import type { Place } from "./types";

export type Coords = { lat: number; lng: number };
export type LocatedPlace = Place & { location: Coords };

/**
 * A capture carries GPS only when the camera recorded it. The rest name where
 * they were — "Toronto", "high park", "my parents' kitchen" — and those still
 * belong on the map, so a name is resolved to a point through Google's
 * geocoder.
 *
 * Every lookup is billed, and the same handful of names repeats across a whole
 * library, so answers are remembered in localStorage. A name that resolves to
 * nothing is remembered too: re-asking would cost the same and fail the same.
 */
const CACHE_KEY = "atlas:geocode:v1";

type CacheEntry = Coords | null;

let memo: Map<string, CacheEntry> | null = null;
const inFlight = new Map<string, Promise<CacheEntry>>();

function normalize(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function cache(): Map<string, CacheEntry> {
  if (memo) return memo;
  memo = new Map();
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      for (const [key, value] of Object.entries(
        JSON.parse(raw) as Record<string, CacheEntry>,
      )) {
        memo.set(key, value);
      }
    }
  } catch {
    // A corrupt cache is worth no more than a cold one.
  }
  return memo;
}

function remember(key: string, value: CacheEntry) {
  const store = cache();
  store.set(key, value);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(store)));
  } catch {
    // Out of quota: the in-memory map still spares this session the lookups.
  }
}

export async function geocodeName(name: string): Promise<CacheEntry> {
  const key = normalize(name);
  if (!key) return null;

  const store = cache();
  if (store.has(key)) return store.get(key) ?? null;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const lookup = (async () => {
    try {
      // loadGoogleMaps sets the API key on the loader; geocoding is a separate
      // library from the map itself.
      await loadGoogleMaps();
      const { Geocoder } = await importLibrary("geocoding");
      const { results } = await new Geocoder().geocode({ address: name });
      const best = results[0]?.geometry?.location;
      const coords = best ? { lat: best.lat(), lng: best.lng() } : null;
      remember(key, coords);
      return coords;
    } catch {
      // ZERO_RESULTS arrives as a rejection, as does a key without the
      // Geocoding API enabled. Neither is worth retrying on this render.
      remember(key, null);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, lookup);
  return lookup;
}

const REVERSE_CACHE_KEY = "atlas:reverse-geocode:v1";

/** Six decimals is roughly a tenth of a metre — far past what a name needs. */
function coordKey({ lat, lng }: Coords) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/**
 * The other direction: a capture whose video carried GPS knows exactly where it
 * is and nothing about what that place is called. "Toronto, Canada" is what a
 * person recognises in a list, so the coordinates are turned back into a name.
 */
export async function reverseGeocode(coords: Coords): Promise<string | null> {
  const key = coordKey(coords);
  const cached = readCache(REVERSE_CACHE_KEY)[key];
  if (cached !== undefined) return cached;

  try {
    await loadGoogleMaps();
    const { Geocoder } = await importLibrary("geocoding");
    const { results } = await new Geocoder().geocode({ location: coords });
    const name = describeResults(results);
    writeCache(REVERSE_CACHE_KEY, key, name);
    return name;
  } catch {
    writeCache(REVERSE_CACHE_KEY, key, null);
    return null;
  }
}

/**
 * City and country out of the address components, rather than the first
 * formatted_address — that one is a street address, which is both too precise
 * to be a useful label and more than someone may want attached to a capture.
 */
function describeResults(results: google.maps.GeocoderResult[]) {
  const parts = results.flatMap((result) => result.address_components ?? []);
  const pick = (type: string) =>
    parts.find((part) => part.types.includes(type))?.long_name;

  const town =
    pick("locality") ??
    pick("postal_town") ??
    pick("sublocality") ??
    pick("administrative_area_level_2");
  const region = pick("country");

  return [town, region].filter(Boolean).join(", ") || null;
}

function readCache(storageKey: string): Record<string, string | null> {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? "{}");
  } catch {
    return {};
  }
}

function writeCache(storageKey: string, key: string, value: string | null) {
  try {
    const all = readCache(storageKey);
    all[key] = value;
    localStorage.setItem(storageKey, JSON.stringify(all));
  } catch {
    // Lookups are cheap enough to repeat; a full disk is not worth failing over.
  }
}

export interface ResolvedPlaces {
  located: LocatedPlace[];
  /** Named but not yet resolved — the map is still filling in. */
  pending: number;
  /** Placed by name rather than by GPS, which is city-coarse at best. */
  byName: number;
  /** Neither coordinates nor a name: nothing can put these on a map. */
  unplaceable: number;
}

/**
 * Turns a scope's places into points. Ones the camera geotagged are ready
 * immediately; the named ones arrive as their lookups land, so the heatmap
 * fills in rather than waiting for the slowest name.
 */
export function useResolvedPlaces(places: Place[]): ResolvedPlaces {
  const [resolved, setResolved] = useState<Map<string, Coords>>(new Map());
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const named = useMemo(
    () =>
      places
        .filter((place) => !hasCoords(place) && place.locationName?.trim())
        .map((place) => place.locationName!.trim()),
    [places],
  );

  // Keyed by the set of names so switching scope re-runs only for new ones.
  const namesKey = useMemo(
    () => [...new Set(named.map(normalize))].sort().join("|"),
    [named],
  );

  useEffect(() => {
    if (!namesKey) return;
    let cancelled = false;

    for (const name of namesKey.split("|")) {
      geocodeName(name).then((coords) => {
        if (cancelled || !activeRef.current || !coords) return;
        setResolved((prev) => {
          if (prev.get(name)) return prev;
          const next = new Map(prev);
          next.set(name, coords);
          return next;
        });
      });
    }

    return () => {
      cancelled = true;
    };
  }, [namesKey]);

  return useMemo(() => {
    const located: LocatedPlace[] = [];
    let pending = 0;
    let byName = 0;
    let unplaceable = 0;

    for (const place of places) {
      if (hasCoords(place)) {
        located.push(place as LocatedPlace);
        continue;
      }
      const name = place.locationName?.trim();
      if (!name) {
        unplaceable += 1;
        continue;
      }
      const coords = resolved.get(normalize(name));
      if (coords) {
        located.push({ ...place, location: coords });
        byName += 1;
      } else {
        pending += 1;
      }
    }

    return { located, pending, byName, unplaceable };
  }, [places, resolved]);
}

function hasCoords(place: Place) {
  return Boolean(
    place.location &&
    Number.isFinite(place.location.lat) &&
    Number.isFinite(place.location.lng),
  );
}
