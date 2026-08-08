"use client";

import { useState } from "react";
import PlaceExperience from "@/components/PlaceExperience";
import type { Place } from "@/lib/types";
import type { Timestamp } from "firebase/firestore";

// Local harness: exercises jumps and hotspot authoring without depending on
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
    hotspots: [{ x: 0.6, y: -0.4, z: 0, linksToPlaceId: "penguin" }],
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
    hotspots: [{ x: 0.4, y: -0.3, z: 0, linksToPlaceId: "butterfly" }],
  },
};

export default function DevPage() {
  const [placeId, setPlaceId] = useState("butterfly");
  const [places, setPlaces] = useState(PLACES);

  return (
    <div className="h-screen w-screen">
      <PlaceExperience
        place={places[placeId]}
        linkTargets={Object.values(places)
          .filter((p) => p.id !== placeId)
          .map((p) => ({ id: p.id, name: p.name }))}
        onJump={setPlaceId}
        onAddHotspot={async (point, linksToPlaceId) => {
          setPlaces((prev) => ({
            ...prev,
            [placeId]: {
              ...prev[placeId],
              hotspots: [
                ...(prev[placeId].hotspots ?? []),
                { ...point, linksToPlaceId },
              ],
            },
          }));
        }}
      />
    </div>
  );
}
