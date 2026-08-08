"use client";

import { useState } from "react";
import PlaceExperience from "@/components/PlaceExperience";
import type { AudioPin, Place } from "@/lib/types";
import type { Timestamp } from "firebase/firestore";

// Local harness: exercises jumps, pin placement and spatial playback without
// depending on Firebase credentials.
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
  const [pinsByPlace, setPinsByPlace] = useState<Record<string, AudioPin[]>>({});

  const place = places[placeId];
  const pins = pinsByPlace[placeId] ?? [];

  return (
    <div className="h-screen w-screen">
      <PlaceExperience
        place={place}
        pins={pins}
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
        onSubmitPin={async (point, recording, caption) => {
          const pin: AudioPin = {
            id: crypto.randomUUID(),
            ...point,
            audioUrl: URL.createObjectURL(recording.blob),
            duration: recording.duration,
            createdAt: null as unknown as Timestamp,
            ...(caption ? { caption } : {}),
          };
          setPinsByPlace((prev) => ({
            ...prev,
            [placeId]: [...(prev[placeId] ?? []), pin],
          }));
        }}
      />
    </div>
  );
}
