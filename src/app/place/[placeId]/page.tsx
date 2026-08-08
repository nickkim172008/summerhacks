"use client";

import { Suspense, use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import PlaceExperience from "@/components/PlaceExperience";
import { addHotspot, getPlace, subscribeToPlaces } from "@/lib/places";
import type { Place } from "@/lib/types";

export default function PlacePage({
  params,
}: {
  params: Promise<{ placeId: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <PlaceView params={params} />
    </Suspense>
  );
}

function PlaceView({ params }: { params: Promise<{ placeId: string }> }) {
  const { placeId } = use(params);
  const router = useRouter();
  // Set when the visitor arrived from an album, so leaving returns them there.
  const albumId = useSearchParams().get("album");
  const exitHref = albumId ? `/album/${albumId}` : "/";
  // undefined while loading, null once we know it isn't there.
  const [place, setPlace] = useState<Place | null | undefined>();
  const [allPlaces, setAllPlaces] = useState<Place[]>([]);
  const [missingFile, setMissingFile] = useState(false);

  useEffect(() => {
    let active = true;
    getPlace(placeId).then((found) => {
      if (active) setPlace(found);
    });
    return () => {
      active = false;
    };
  }, [placeId]);

  useEffect(() => subscribeToPlaces(setAllPlaces), []);

  // Firestore is shared but an app-served splat is not: the doc lists fine on
  // every machine while the file exists on exactly one. Check before handing
  // the URL to Spark, which would otherwise fail silently into an empty scene.
  useEffect(() => {
    const url = place?.splatUrl;
    if (!url?.startsWith("/")) return;
    let active = true;
    fetch(url, { method: "HEAD" })
      .then((res) => active && setMissingFile(!res.ok))
      .catch(() => active && setMissingFile(true));
    return () => {
      active = false;
    };
  }, [place?.splatUrl]);

  if (place === null) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-3 bg-black text-white">
        <p>That environment doesn&apos;t exist.</p>
        <Link href={exitHref} className="text-sky-400 underline">
          Back
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

  if (missingFile) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-3 bg-black px-6 text-center text-white">
        <p className="text-lg font-medium">
          {place.name} isn&apos;t on this computer.
        </p>
        <p className="max-w-md text-sm text-neutral-400">
          Its splat was saved by the app that captured it, and this one serves
          files from its own <code>public/splats</code>. Open it on the machine
          that captured it, or commit{" "}
          <code className="text-neutral-300">{place.splatUrl}</code> to the repo
          so every clone has it.
        </p>
        <Link href={exitHref} className="text-sky-400 underline">
          Back
        </Link>
      </main>
    );
  }

  return (
    <main className="h-screen w-screen">
      <PlaceExperience
        place={place}
        linkTargets={allPlaces
          .filter((p) => p.id !== placeId)
          .map((p) => ({ id: p.id, name: p.name }))}
        onJump={(id) =>
          router.push(
            albumId ? `/place/${id}?album=${albumId}` : `/place/${id}`,
          )
        }
        onExit={() => router.push(exitHref)}
        onAddHotspot={async (point, linksToPlaceId) => {
          await addHotspot(placeId, point, linksToPlaceId);
          setPlace(await getPlace(placeId));
        }}
      />
    </main>
  );
}
