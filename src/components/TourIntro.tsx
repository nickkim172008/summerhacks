"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toTimelineEntries } from "@/lib/captureTimeline";
import { warmSplat } from "@/lib/splatPrefetch";
import type { MapFocus } from "./PlacesMap";
import type { Place } from "@/lib/types";

/** Close enough to read the street the capture was filmed on. */
const TOUR_ZOOM = 18;
/** Covers PlacesMap's pan and its stepped zoom-in with a little to spare. */
const FLY_MS = 1600;
const VEIL_MS = 600;
/**
 * How long the flight will wait for the album's places to arrive. A tour link
 * opened cold has to wait for Firestore, but a scope that never resolves must
 * still hand over rather than leave someone on a map that is about to go black.
 */
const RESOLVE_GRACE_MS = 2000;

export interface TourIntro {
  /** True once the opening is under way, whether or not it can fly anywhere. */
  active: boolean;
  focus: MapFocus | null;
  /** How long the veil waits before it starts closing. */
  fadeDelayMs: number;
}

/**
 * The opening of an album walkthrough, played on the map: fly to the earliest
 * capture on the shared time axis, fade to black as the zoom lands, hand over
 * to /tour. An album whose earliest capture has no coordinates skips straight
 * to the fade — one of the eight environments has no location at all, and a
 * walkthrough that stalls staring at a city is worse than one that just starts.
 */
export function useTourIntro({
  albumId,
  places,
  from,
}: {
  albumId: string | null;
  places: Place[];
  /** Where Exit should return to, carried through to the tour route. */
  from: string | null;
}): TourIntro {
  const router = useRouter();
  const [waited, setWaited] = useState(false);

  const earliest = useMemo(() => {
    if (!albumId || places.length === 0) return null;
    const [first] = toTimelineEntries(places);
    if (!first) return null;
    return places.find((place) => place.id === first.id) ?? null;
  }, [albumId, places]);

  // Depending on the coordinates rather than the place keeps a re-delivered
  // Firestore snapshot from handing PlacesMap a new object and flying again.
  const lat = earliest?.location?.lat ?? null;
  const lng = earliest?.location?.lng ?? null;
  const focus = useMemo(
    () => (lat === null || lng === null ? null : { lat, lng, zoom: TOUR_ZOOM }),
    [lat, lng],
  );

  const splatUrl = earliest?.splatUrl;
  // The flight is two seconds of doing nothing else, which is most of what the
  // first capture needs to be on disk before the tour asks for it.
  useEffect(() => {
    void warmSplat(splatUrl);
  }, [splatUrl]);

  useEffect(() => {
    if (!albumId) return;
    const timer = window.setTimeout(() => setWaited(true), RESOLVE_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [albumId]);

  const active = Boolean(albumId) && (places.length > 0 || waited);
  const fadeDelayMs = focus ? FLY_MS : 0;

  // Nothing here but strings out of the URL, so a Firestore snapshot landing
  // mid-flight cannot restart the clock that is about to end the flight.
  useEffect(() => {
    if (!active || !albumId) return;
    const timer = window.setTimeout(() => {
      // replace, not push: the intro URL still says tour=1, so backing out of
      // the walkthrough onto it would start the whole thing over.
      router.replace(tourHref(albumId, from));
    }, fadeDelayMs + VEIL_MS);
    return () => window.clearTimeout(timer);
  }, [active, albumId, from, fadeDelayMs, router]);

  return { active, focus, fadeDelayMs };
}

function tourHref(albumId: string, from: string | null) {
  const query = new URLSearchParams({ i: "0" });
  if (from) query.set("from", from);
  return `/tour/${albumId}?${query.toString()}`;
}

/** The fade that covers the handover from the map to the walkthrough. */
export function TourIntroVeil({ intro }: { intro: TourIntro }) {
  const [closed, setClosed] = useState(false);

  // Two frames, not one: a single rAF can be batched into the same commit that
  // mounted the veil, and a transition between two values painted together does
  // not run — the screen would snap to black instead of falling to it.
  useEffect(() => {
    if (!intro.active) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setClosed(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [intro.active]);

  if (!intro.active) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 bg-black"
      style={{
        opacity: closed ? 1 : 0,
        transition: `opacity ${VEIL_MS}ms ease-in ${intro.fadeDelayMs}ms`,
      }}
    />
  );
}
