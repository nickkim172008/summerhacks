"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { subscribeToPlaces } from "@/lib/places";
import { isFirebaseConfigured } from "@/lib/firebase";
import type { Place } from "@/lib/types";

export default function AtlasPage() {
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [error, setError] = useState(!isFirebaseConfigured);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    return subscribeToPlaces(setPlaces, () => setError(true));
  }, []);

  return (
    <main className="min-h-screen bg-black px-6 py-12 text-white">
      <header className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-semibold">A spatial memory atlas</h1>
        <p className="mt-2 max-w-xl text-neutral-400">
          Places you can walk through, with voices left where they happened.
          Every visitor can add one.
        </p>
        <Link
          href="/capture"
          className="mt-4 inline-block rounded-full bg-sky-500 px-5 py-2 text-sm font-medium"
        >
          Capture a place
        </Link>
      </header>

      <section className="mx-auto mt-10 max-w-5xl">
        {error && (
          <p className="text-sm text-amber-400">
            The atlas isn&apos;t connected. Copy{" "}
            <code className="text-neutral-300">.env.local.example</code> to{" "}
            <code className="text-neutral-300">.env.local</code> and fill in the
            Firebase keys, then restart the dev server.
          </p>
        )}

        {!error && places === null && (
          <p className="text-neutral-500">Loading the atlas…</p>
        )}

        {!error && places?.length === 0 && (
          <p className="text-neutral-500">
            No places yet. Capture one to start the atlas.
          </p>
        )}

        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {places?.map((place) => (
            <li key={place.id}>
              <Link
                href={`/place/${place.id}`}
                className="block overflow-hidden rounded-xl bg-neutral-900 transition hover:bg-neutral-800"
              >
                <div className="aspect-video bg-neutral-800">
                  {place.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={place.thumbnailUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="p-4">
                  <h2 className="font-medium">{place.name}</h2>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
