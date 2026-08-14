"use client";

import { useEffect, useState } from "react";
import PlaceExperience from "@/components/PlaceExperience";
import type { Place } from "@/lib/types";
import type { WorldLabsCapture } from "@/lib/captureStatus";
import type { Timestamp } from "firebase/firestore";

// Local harness: renders a capture without depending on
// Firebase credentials. No sample audio ships with the app, so both places are
// silent here — set audioUrl to a file under public/ to try the player.
const SPLAT_BASE = "https://sparkjs.dev/assets/splats";

const PLACES: Record<string, Place> = {
  butterfly: {
    id: "butterfly",
    name: "The Butterfly Room",
    uploaderId: "dev",
    createdAt: null as unknown as Timestamp,
    splatUrl: `${SPLAT_BASE}/butterfly.spz`,
    thumbnailUrl: "",
    capturedAt: "2026-05-02T18:24:00.000Z",
    locationName: "Kyoto, Japan",
  },
  penguin: {
    id: "penguin",
    name: "The Penguin Ledge",
    uploaderId: "dev",
    createdAt: null as unknown as Timestamp,
    splatUrl: `${SPLAT_BASE}/penguin.spz`,
    thumbnailUrl: "",
  },
};

/**
 * A capture pulled down by scripts/worldlabs.mjs, so a Marble world can be put
 * next to the fixtures in the same renderer. Set NEXT_PUBLIC_DEV_SPLAT_URL to
 * `/dev-splats/<world id>.spz` — the script prints exactly that line.
 *
 * A variable rather than another entry above because the file is megabytes of
 * binary that public/dev-splats/ keeps out of git: hard-coding one world's id
 * would leave everyone else with a button that 404s.
 */
const LOCAL_SPLAT_URL = process.env.NEXT_PUBLIC_DEV_SPLAT_URL;

interface ManifestRun {
  world_id: string;
  display_name: string | null;
  model: string | null;
  caption: string | null;
  semantics_metadata: {
    metric_scale_factor?: number;
    ground_plane_offset?: number;
  } | null;
}

const LOCAL_PLACE: Record<string, Place> = LOCAL_SPLAT_URL
  ? {
      local: {
        id: "local",
        name: "Local splat",
        uploaderId: "dev",
        createdAt: null as unknown as Timestamp,
        splatUrl: LOCAL_SPLAT_URL,
        thumbnailUrl: "",
      },
    }
  : {};

export default function DevPage() {
  const [placeId, setPlaceId] = useState(
    LOCAL_SPLAT_URL ? "local" : "butterfly",
  );
  const [places, setPlaces] = useState({ ...PLACES, ...LOCAL_PLACE });

  // A downloaded splat is named for the world it came from, so the manifest can
  // be searched for its scale and ground plane without any of it being
  // configured twice. Without them the harness frames off the bounding box,
  // which is the thing being compared against.
  useEffect(() => {
    const worldId = LOCAL_SPLAT_URL?.match(/([0-9a-f-]{36})\.spz$/i)?.[1];
    if (!worldId) return;
    let cancelled = false;
    fetch("/api/dev/worlds")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { runs?: ManifestRun[] } | null) => {
        const run = body?.runs?.find((entry) => entry.world_id === worldId);
        const scale = run?.semantics_metadata;
        if (cancelled || !run) return;
        const world: WorldLabsCapture = {
          worldId,
          model: run.model ?? undefined,
          caption: run.caption ?? undefined,
          metricScaleFactor: scale?.metric_scale_factor,
          groundPlaneOffset: scale?.ground_plane_offset,
        };
        setPlaces((current) => ({
          ...current,
          local: { ...current.local, name: run.display_name ?? "Local splat", world },
        }));
      })
      .catch(() => {
        // The manifest is a development convenience; without it the harness
        // still renders, just framed off the bounds.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="h-screen w-screen">
      <PlaceExperience place={places[placeId]} />

      {/* Moving between captures used to be a hotspot inside the scene. With
          those gone the harness still needs a way to swap fixtures, so it says
          so plainly instead. */}
      <div className="absolute bottom-6 right-6 z-50 flex gap-2.5">
        {Object.values(places).map((place) => (
          <button
            key={place.id}
            onClick={() => setPlaceId(place.id)}
            className={`flex h-[38px] items-center rounded-full px-[18px] text-[14px] font-medium backdrop-blur-[14px] transition-colors duration-150 ease-[ease] ${
              place.id === placeId
                ? "border border-transparent bg-white text-[#14161A]"
                : "border border-[rgba(255,255,255,0.16)] bg-[rgba(14,16,19,0.5)] text-white hover:bg-[rgba(14,16,19,0.68)]"
            }`}
          >
            {place.name}
          </button>
        ))}
      </div>
    </div>
  );
}
