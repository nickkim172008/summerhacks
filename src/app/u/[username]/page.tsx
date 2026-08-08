"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuthProfile } from "@/lib/auth";
import { subscribeToAlbumsByOwner } from "@/lib/albums";
import { subscribeToPlacesByUploader } from "@/lib/places";
import { subscribeToProfileByUsername } from "@/lib/profiles";
import PlaceThumb from "@/components/PlaceThumb";
import type { Album, Place, Profile } from "@/lib/types";

export default function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = use(params);
  const { user, profile: myProfile } = useAuthProfile();
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);

  useEffect(() => {
    return subscribeToProfileByUsername(username, setProfile);
  }, [username]);

  useEffect(() => {
    if (!profile) {
      setAlbums(null);
      setPlaces(null);
      return;
    }
    const unsubAlbums = subscribeToAlbumsByOwner(profile.id, setAlbums);
    const unsubPlaces = subscribeToPlacesByUploader(profile.id, setPlaces);
    return () => {
      unsubAlbums();
      unsubPlaces();
    };
  }, [profile]);

  const placeById = useMemo(
    () => new Map((places ?? []).map((p) => [p.id, p])),
    [places],
  );

  const isOwn = Boolean(user && profile && user.uid === profile.id);
  const loading = profile === undefined;

  if (!loading && profile === null) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-3 bg-white text-[#1d1d1f]">
        <p>@{username} doesn&apos;t exist.</p>
        <Link href="/" className="text-[#0071e3]">
          Back to Albums
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white pb-20 text-[#1d1d1f]">
      <nav className="sticky top-0 z-20 border-b border-black/10 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link
            href="/"
            className="flex items-center gap-1 text-[17px] text-[#0071e3]"
          >
            <span aria-hidden className="text-xl leading-none">
              ‹
            </span>
            Albums
          </Link>
          {isOwn && myProfile && (
            <span className="text-[13px] text-neutral-500">Your profile</span>
          )}
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-6">
        {loading || !profile ? (
          <p className="mt-10 text-neutral-500">Loading…</p>
        ) : (
          <>
            <header className="mt-8 flex items-center gap-4">
              {profile.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.photoURL}
                  alt=""
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100 text-xl font-semibold text-neutral-500">
                  {profile.username.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div>
                <h1 className="text-[28px] font-bold tracking-tight">
                  {profile.displayName}
                </h1>
                <p className="text-[15px] text-neutral-500">
                  @{profile.username}
                </p>
              </div>
            </header>

            <section className="mt-10">
              <h2 className="text-[22px] font-bold tracking-tight">Albums</h2>
              {albums === null ? (
                <p className="mt-3 text-sm text-neutral-500">Loading…</p>
              ) : albums.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-500">No albums yet.</p>
              ) : (
                <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
                  {albums.map((album) => {
                    const cover = coverFor(album, placeById);
                    return (
                    <li key={album.id}>
                      <Link
                        href={`/album/${album.id}`}
                        className="group block"
                      >
                        <div className="aspect-square overflow-hidden rounded-2xl bg-neutral-100 transition group-hover:opacity-90">
                          {cover ? (
                            <PlaceThumb place={cover} />
                          ) : (
                            <EmptyCover />
                          )}
                        </div>
                        <p className="mt-2 truncate text-[15px] font-medium">
                          {album.name}
                        </p>
                        <p className="text-sm text-neutral-500">
                          {album.placeIds?.length ?? 0}
                        </p>
                      </Link>
                    </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="mt-12">
              <h2 className="text-[22px] font-bold tracking-tight">
                Environments
              </h2>
              {places === null ? (
                <p className="mt-3 text-sm text-neutral-500">Loading…</p>
              ) : places.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-500">
                  No environments yet.
                </p>
              ) : (
                <ul className="mt-4 grid grid-cols-3 gap-0.5 sm:grid-cols-4 md:grid-cols-5">
                  {places.map((place) => (
                    <li key={place.id}>
                      <Link
                        href={`/place/${place.id}`}
                        className="group relative block aspect-square overflow-hidden bg-neutral-100"
                      >
                        <PlaceThumb place={place} />
                        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-6 text-xs font-medium text-white opacity-0 transition group-hover:opacity-100">
                          {place.name}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function coverFor(album: Album, placeById: Map<string, Place>) {
  for (const id of album.placeIds ?? []) {
    const place = placeById.get(id);
    if (place) return place;
  }
  return null;
}

function EmptyCover() {
  return (
    <div className="flex h-full w-full items-center justify-center text-neutral-300">
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-10 w-10"
        aria-hidden
      >
        <path d="M19 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm-9.5 3A1.5 1.5 0 1 1 8 9.5 1.5 1.5 0 0 1 9.5 8Zm9.5 9H5l4-5 2.5 3 3.5-4.5Z" />
      </svg>
    </div>
  );
}
