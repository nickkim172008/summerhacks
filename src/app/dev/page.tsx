"use client";

import { useState } from "react";
import PlaceExperience from "@/components/PlaceExperience";
import type { Place } from "@/lib/types";
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

export default function DevPage() {
  const [placeId, setPlaceId] = useState("butterfly");
  const [places] = useState(PLACES);

  return (
    <div className="h-screen w-screen">
      <PlaceExperience place={places[placeId]} />

      {/* Moving between captures used to be a hotspot inside the scene. With
          those gone the harness still needs a way to swap fixtures, so it says
          so plainly instead. */}
      <div className="absolute bottom-4 right-4 z-50 flex gap-2">
        {Object.values(places).map((place) => (
          <button
            key={place.id}
            onClick={() => setPlaceId(place.id)}
            className={`rounded-full px-4 py-2 text-sm font-medium backdrop-blur transition ${
              place.id === placeId
                ? "bg-white text-black"
                : "bg-white/20 text-white hover:bg-white/30"
            }`}
          >
            {place.name}
          </button>
        ))}
      </div>
    </div>
  );
}
