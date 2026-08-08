"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { AudioPin } from "@/lib/types";
import type { Timestamp } from "firebase/firestore";

const SplatViewer = dynamic(() => import("@/components/SplatViewer"), {
  ssr: false,
});

const SAMPLE_SPLAT = "https://sparkjs.dev/assets/splats/butterfly.spz";

export default function DevPage() {
  const [pins, setPins] = useState<AudioPin[]>([]);
  const [placementMode, setPlacementMode] = useState(false);

  return (
    <div className="flex h-screen flex-col bg-black text-white">
      <div className="flex items-center gap-4 p-3">
        <button
          onClick={() => setPlacementMode((v) => !v)}
          className="rounded bg-sky-500 px-3 py-1 text-sm font-medium"
        >
          {placementMode ? "Cancel placement" : "Place a pin"}
        </button>
        <span className="text-sm text-neutral-400">{pins.length} pins</span>
      </div>
      <div className="flex-1">
        <SplatViewer
          splatUrl={SAMPLE_SPLAT}
          pins={pins}
          placementMode={placementMode}
          onPlacePoint={(p) => {
            setPins((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                ...p,
                audioUrl: "",
                duration: 0,
                createdAt: null as unknown as Timestamp,
              },
            ]);
            setPlacementMode(false);
          }}
          onPinClick={(id) => console.log("clicked pin", id)}
        />
      </div>
    </div>
  );
}
