"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuthProfile } from "@/lib/auth";
import { subscribeToPublicAlbums } from "@/lib/albums";
import { subscribeToPlacesByIds } from "@/lib/places";
import PublicFeed, { type FeedEntry } from "@/components/PublicFeed";
import type { Album, Place } from "@/lib/types";

/**
 * The Feed tab: every place from every public journey, newest first, one
 * walkable environment per card. Each card names who captured it and the
 * journey it belongs to — the way in for exploring, or adding your own.
 */
export default function FeedPage() {
  const { user } = useAuthProfile();
  const [publicAlbums, setPublicAlbums] = useState<Album[] | null>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);
  // Past the first card the heading has said everything it has to say, so it
  // folds away and gives the feed the whole height. Scrolling back up at the
  // top brings it back.
  const [immersed, setImmersed] = useState(false);

  useEffect(() => {
    if (!user) return;
    return subscribeToPublicAlbums(setPublicAlbums, () => setPublicAlbums([]));
  }, [user]);

  // Every place any public journey holds, each pinned to the journey it was
  // found through so the feed card can wear that journey's chip.
  const { placeIdsKey, albumByPlaceId } = useMemo(() => {
    const map = new Map<string, Album>();
    for (const album of publicAlbums ?? []) {
      for (const id of album.placeIds ?? []) {
        if (!map.has(id)) map.set(id, album);
      }
    }
    return {
      placeIdsKey: [...map.keys()].sort().join(","),
      albumByPlaceId: map,
    };
  }, [publicAlbums]);

  useEffect(() => {
    if (!user || publicAlbums === null) return;
    const ids = placeIdsKey ? placeIdsKey.split(",") : [];
    return subscribeToPlacesByIds(ids, setPlaces, () => setPlaces([]));
  }, [user, publicAlbums, placeIdsKey]);

  // Already sorted newest first by the places subscription.
  const entries: FeedEntry[] = useMemo(
    () =>
      (places ?? []).map((place) => ({
        place,
        album: albumByPlaceId.get(place.id) ?? null,
      })),
    [places, albumByPlaceId],
  );

  return (
    <main className="flex h-[calc(100dvh-64px)] flex-col bg-[#FAF9F7] text-[#14161A]">
      <div
        className={`mx-auto w-full max-w-[880px] shrink-0 overflow-hidden px-8 transition-all duration-300 ease-out ${
          immersed ? "max-h-0 opacity-0" : "max-h-40 pb-5 pt-8 opacity-100"
        }`}
        aria-hidden={immersed}
      >
        <h1 className="font-display text-[44px] leading-[44px] font-normal tracking-[-0.02em]">
          Feed
        </h1>
        <p className="mt-2.5 text-[15px] text-[#4A4F57]">
          Live places from public journeys — walk in, or add your own.
        </p>
      </div>

      <div
        className={`mx-auto min-h-0 w-full max-w-[880px] flex-1 px-8 pb-6 ${
          immersed ? "pt-4" : ""
        }`}
      >
        {!user ? (
          <FeedNotice
            title="Sign in to explore"
            body="The feed shows walkable places from journeys people have made public."
            action={
              <Link
                href="/signin"
                className="mt-1 inline-flex h-10 items-center rounded-full bg-[#14161A] px-[22px] text-[15px] font-medium text-white transition hover:bg-[#2A2E35]"
              >
                Sign In
              </Link>
            }
          />
        ) : places === null ? (
          <FeedNotice title="Loading the feed…" body="" />
        ) : entries.length === 0 ? (
          <FeedNotice
            title="Nothing public yet"
            body="When someone makes a journey public, its places show up here as walkable environments."
          />
        ) : (
          <PublicFeed
            entries={entries}
            onActiveIndexChange={(index) => setImmersed(index > 0)}
          />
        )}
      </div>
    </main>
  );
}

function FeedNotice({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-2xl border border-[rgba(20,22,26,0.09)] bg-white px-8 text-center shadow-[0_1px_2px_rgba(20,22,26,0.04)]">
      <p className="font-display text-[22px] leading-[28px]">{title}</p>
      {body && (
        <p className="max-w-[42ch] text-[15px] leading-6 text-[#4A4F57]">
          {body}
        </p>
      )}
      {action}
    </div>
  );
}
