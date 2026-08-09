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
    <main className="min-h-screen bg-[#FAF9F7] text-[#14161A]">
      <div className="mx-auto max-w-[1152px] px-8 pb-16">
        {/* The back affordance is a row at the top of the column now, not a bar
            of its own: one line of chrome instead of two. */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 pt-6 text-[13px] font-medium text-[#4A4F57] transition hover:text-[#14161A]"
        >
          <ChevronLeftIcon />
          Library
        </Link>
        <h1 className="mt-5 font-display text-[40px] font-normal leading-[40px] tracking-[-0.02em]">
          Recently Deleted
        </h1>
        {error && (
          <p className="mt-6 text-[15px] text-[#C0362C]">{error}</p>
        )}

        {(loading || places === null) && (
          <p className="mt-10 text-[15px] text-[#6B7178]">Loading…</p>
        )}

        {places?.length === 0 && (
          <p className="mt-10 text-[15px] text-[#6B7178]">
            Nothing in the trash.
          </p>
        )}

        {places && places.length > 0 && (
          <ul className="mt-8 flex flex-col gap-3">
            {places.map((place) => (
              <li
                key={place.id}
                className="flex items-center gap-4 rounded-2xl border border-[rgba(20,22,26,0.09)] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(20,22,26,0.04)]"
              >
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-[rgba(20,22,26,0.05)]">
                  <PlaceThumb place={place} />
                </div>
                <p className="min-w-0 flex-1 truncate font-display text-[19px] font-normal leading-6 tracking-[-0.01em]">
                  {place.name}
                </p>

                {confirming === place.id ? (
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-[13px] text-[#6B7178]">
                      Delete for good?
                    </span>
                    <button
                      disabled={busy === place.id}
                      onClick={() =>
                        run(
                          place.id,
                          () => deletePlaceForever(place.id),
                          "Could not delete that place.",
                        )
                      }
                      className="h-9 rounded-full bg-[#C0362C] px-4 text-[14px] font-medium text-white transition hover:bg-[#A82F26] disabled:opacity-50"
                    >
                      {busy === place.id ? "Deleting…" : "Delete"}
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="text-[14px] font-medium text-[#4A4F57] transition hover:text-[#14161A]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      disabled={busy === place.id}
                      onClick={() =>
                        run(
                          place.id,
                          () => restorePlace(place.id),
                          "Could not restore that place.",
                        )
                      }
                      className="h-9 rounded-full border border-[rgba(20,22,26,0.14)] bg-white px-4 text-[14px] font-medium text-[#14161A] transition hover:bg-[rgba(20,22,26,0.05)] disabled:opacity-50"
                    >
                      Restore
                    </button>
                    <button
                      onClick={() => setConfirming(place.id)}
                      className="h-9 rounded-full px-3 text-[14px] font-medium text-[#C0362C] transition hover:bg-[rgba(192,54,44,0.08)]"
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

/** The back-row glyph, at the 14px the design draws it. */
function ChevronLeftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}
