"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PlaceExperience from "@/components/PlaceExperience";
import {
  addAudioPin,
  addHotspot,
  getPlace,
  subscribeToPins,
  subscribeToPlaces,
} from "@/lib/places";
import type { AudioPin, Place } from "@/lib/types";

export default function PlacePage({
  params,
}: {
  params: Promise<{ placeId: string }>;
}) {
  const { placeId } = use(params);
  const router = useRouter();
  // undefined while loading, null once we know it isn't there.
  const [place, setPlace] = useState<Place | null | undefined>();
  const [pins, setPins] = useState<AudioPin[]>([]);
  const [allPlaces, setAllPlaces] = useState<Place[]>([]);

  useEffect(() => {
    let active = true;
    getPlace(placeId).then((found) => {
      if (active) setPlace(found);
    });
    return () => {
      active = false;
    };
  }, [placeId]);

  useEffect(() => subscribeToPins(placeId, setPins), [placeId]);
  useEffect(() => subscribeToPlaces(setAllPlaces), []);

  if (place === null) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-3 bg-black text-white">
        <p>That environment doesn&apos;t exist.</p>
        <Link href="/" className="text-sky-400 underline">
          Back to Albums
        </Link>
      </main>
    );
  }

  if (!place) {
    return (
      <main className="flex h-screen items-center justify-center bg-black text-neutral-400">
        Loading…
      </main>
    );
  }

  return (
    <main className="h-screen w-screen">
      <PlaceExperience
        place={place}
        pins={pins}
        linkTargets={allPlaces
          .filter((p) => p.id !== placeId)
          .map((p) => ({ id: p.id, name: p.name }))}
        onJump={(id) => router.push(`/place/${id}`)}
        onSubmitPin={(point, recording, caption) =>
          addAudioPin(placeId, point, recording, caption)
        }
        onAddHotspot={async (point, linksToPlaceId) => {
          await addHotspot(placeId, point, linksToPlaceId);
          setPlace(await getPlace(placeId));
        }}
      />
    </main>
  );
}
