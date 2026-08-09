"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  deletePlaceForever,
  restorePlace,
  subscribeToTrashedPlaces,
} from "@/lib/places";
import { useAuthProfile } from "@/lib/auth";
import PlaceThumb from "@/components/PlaceThumb";
import type { Place } from "@/lib/types";

/**
 * Where deleted environments wait.
 *
 * A capture costs an hour of reconstruction, so removing one is reversible
 * until this page says otherwise. Emptying is the only irreversible act in the
 * app, and it is deliberately the one that asks.
 */
export default function TrashPage() {
  const { user, loading } = useAuthProfile();
  const [loaded, setLoaded] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return subscribeToTrashedPlaces(user.uid, setLoaded, () =>
      setError("Could not read the trash."),
    );
  }, [user]);

  // Derived rather than assigned in the effect: signed out there is nothing to
  // subscribe to and nothing to wait for, and writing that as state would be a
  // synchronous set during render's effect for a value already known here.
  const places = user ? loaded : [];

  async function run(id: string, work: () => Promise<void>, failure: string) {
    setBusy(id);
    setError(null);
    try {
      await work();
    } catch {
      setError(failure);
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  return (
    <main className="min-h-screen bg-white pb-24 text-[#1d1d1f]">
      <div className="mx-auto max-w-5xl px-6">
        <div className="flex items-baseline justify-between gap-4 pt-8">
          <h1 className="text-[34px] font-bold tracking-tight">Trash</h1>
          <Link href="/" className="text-[15px] text-[#0071e3]">
            Library
          </Link>
        </div>
        <p className="mt-2 text-sm text-neutral-500">
          Deleted environments stay here until you empty them. Removing one from
          an album never puts it here — that only takes it out of the album.
        </p>

        {error && <p className="mt-6 text-sm text-red-500">{error}</p>}

        {(loading || places === null) && (
          <p className="mt-10 text-sm text-neutral-500">Loading…</p>
        )}

        {places?.length === 0 && (
          <p className="mt-10 text-sm text-neutral-500">
            Nothing in the trash.
          </p>
        )}

        {places && places.length > 0 && (
          <ul className="mt-8 flex flex-col gap-3">
            {places.map((place) => (
              <li
                key={place.id}
                className="flex items-center gap-4 rounded-2xl border border-black/10 px-4 py-3"
              >
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-neutral-100">
                  <PlaceThumb place={place} />
                </div>
                <p className="min-w-0 flex-1 truncate text-[15px] font-medium">
                  {place.name}
                </p>

                {confirming === place.id ? (
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm text-neutral-500">
                      Delete for good?
                    </span>
                    <button
                      disabled={busy === place.id}
                      onClick={() =>
                        run(
                          place.id,
                          () => deletePlaceForever(place.id),
                          "Could not delete that environment.",
                        )
                      }
                      className="rounded-full bg-red-500 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {busy === place.id ? "Deleting…" : "Delete"}
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="text-sm text-[#0071e3]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      disabled={busy === place.id}
                      onClick={() =>
                        run(
                          place.id,
                          () => restorePlace(place.id),
                          "Could not restore that environment.",
                        )
                      }
                      className="text-sm text-[#0071e3] disabled:opacity-50"
                    >
                      Restore
                    </button>
                    <button
                      onClick={() => setConfirming(place.id)}
                      className="text-sm text-red-500"
                    >
                      Delete Forever
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
