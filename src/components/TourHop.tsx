"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { planHop, type HopPoint } from "@/lib/tourHop";
import type { LocatedPlace } from "@/lib/geocode";
import type { Place } from "@/lib/types";

const PlacesMap = dynamic(() => import("@/components/PlacesMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-black" />,
});

/**
 * The map between two captures: pull back over the ground between them, travel,
 * drop into the next one. It replaces the viewer for its duration rather than
 * sitting over it — two WebGL contexts is exactly what this repo turns
 * StrictMode off to avoid, and the splat being left behind has nothing to show.
 */
const CLOSE_ZOOM = 18;

/**
 * PlacesMap pans for 550ms and then steps the zoom four times at 220ms. A stage
 * is over when both have landed; anything shorter cuts its own flight off.
 */
const STAGE_MS = 1500;
const SETTLE_MS = 320;

export default function TourHop({
  places,
  from,
  to,
  toName,
  onDone,
}: {
  /** Drawn underneath so the flight reads as crossing the library, not a void. */
  places: Place[];

  from: HopPoint | null;
  to: HopPoint | null;
  toName: string;
  onDone: () => void;
}) {
  const plan = useMemo(
    () =>
      planHop(from, to, {
        closeZoom: CLOSE_ZOOM,
        viewport:
          typeof window === "undefined"
            ? { width: 1200, height: 800 }
            : { width: window.innerWidth, height: window.innerHeight },
      }),
    [from, to],
  );

  // The album's own points, so the flight crosses something recognisable. Only
  // the ones the map can draw, which is not every capture in a walkthrough.
  const drawn = useMemo(
    () =>
      places.filter((place): place is LocatedPlace =>
        Boolean(
          place.location &&
          Number.isFinite(place.location.lat) &&
          Number.isFinite(place.location.lng),
        ),
      ),
    [places],
  );

  const [stage, setStage] = useState(0);

  // Held in a ref so a parent that re-renders mid-flight cannot restart it.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    const total = plan.stages.length;
    if (total === 0) {
      // Nothing to fly: hand straight back rather than holding a black frame.
      const cut = window.setTimeout(() => onDoneRef.current(), 0);
      return () => window.clearTimeout(cut);
    }

    const timers = plan.stages
      .slice(1)
      .map((_, index) =>
        window.setTimeout(() => setStage(index + 1), (index + 1) * STAGE_MS),
      );
    timers.push(
      window.setTimeout(
        () => onDoneRef.current(),
        total * STAGE_MS + SETTLE_MS,
      ),
    );

    return () => timers.forEach(window.clearTimeout);
  }, [plan]);

  const focus = plan.stages[Math.min(stage, plan.stages.length - 1)] ?? null;

  return (
    <div className="absolute inset-0 z-40 bg-black">
      <PlacesMap places={drawn} focus={focus} className="absolute inset-0" />

      {/* Says where it is going while it is going there, so a two-second
          flight is an answer rather than a wait. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center px-6">
        <p className="rounded-full bg-white/95 px-4 py-2 text-[13px] text-[#1d1d1f] shadow-lg ring-1 ring-black/10">
          Travelling to <span className="font-medium">{toName}</span>
          {plan.distanceKm >= 0.35 && (
            <span className="text-neutral-500">
              {" · "}
              {formatDistance(plan.distanceKm)}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

function formatDistance(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}
