"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { subscribeToPlacesByUploader } from "@/lib/places";
import { createAlbum, subscribeToAlbumsByOwner } from "@/lib/albums";
import { isFirebaseConfigured } from "@/lib/firebase";
import { useAuthProfile } from "@/lib/auth";
import PlaceThumb from "@/components/PlaceThumb";
import type { Album, Place } from "@/lib/types";

export default function AlbumsPage() {
  const router = useRouter();
  const { user, loading: authLoading, needsUsername } = useAuthProfile();
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [error, setError] = useState(!isFirebaseConfigured);
  const [showNewAlbum, setShowNewAlbum] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/signin");
      return;
    }
    if (needsUsername) router.replace("/setup");
  }, [authLoading, needsUsername, router, user]);

  useEffect(() => {
    if (!isFirebaseConfigured || authLoading || !user) return;
    return subscribeToPlacesByUploader(user.uid, setPlaces, () =>
      setError(true),
    );
  }, [authLoading, user]);

  useEffect(() => {
    if (!isFirebaseConfigured || !user) return;
    return subscribeToAlbumsByOwner(user.uid, setAlbums, () => setError(true));
  }, [user]);

  const placeById = useMemo(
    () => new Map((places ?? []).map((p) => [p.id, p])),
    [places],
  );

  const loading =
    !error &&
    (authLoading ||
      !user ||
      places === null ||
      albums === null);

  return (
    <main className="min-h-screen bg-white pb-20 text-[#1d1d1f]">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mt-8 flex items-center justify-between gap-3">
          <h1 className="text-[34px] font-bold tracking-tight">Albums</h1>
          <button
            onClick={() => {
              if (!user) {
                router.push("/signin");
                return;
              }
              if (needsUsername) {
                router.push("/setup");
                return;
              }
              setShowNewAlbum(true);
            }}
            aria-label="New Album"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-xl leading-none text-[#0071e3] transition hover:bg-neutral-200"
          >
            +
          </button>
        </div>

        {error && (
          <p className="mt-6 text-sm text-amber-600">
            Not connected. Copy <code>.env.local.example</code> to{" "}
            <code>.env.local</code>, fill in the Firebase keys, and restart the
            dev server.
          </p>
        )}

        {loading && <p className="mt-6 text-neutral-500">Loading…</p>}

        {!error && !loading && (
          <>
            <h2 className="mt-6 text-[22px] font-bold tracking-tight">
              {user ? "My Albums" : "Library"}
            </h2>
            <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
              <RecentsCard places={places ?? []} />
              {(albums ?? []).map((album) => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  cover={coverFor(album, placeById)}
                />
              ))}
            </ul>

            {user && (albums?.length ?? 0) === 0 && (
              <p className="mt-10 text-sm text-neutral-500">
                Create an album with the{" "}
                <span className="font-medium text-[#0071e3]">+</span> button
                and start collecting environments — for example, a “Summer
                Hacks” album for the whole journey.
              </p>
            )}

            {!user && (
              <p className="mt-10 text-sm text-neutral-500">
                <Link href="/signup" className="text-[#0071e3]">
                  Sign up
                </Link>{" "}
                or{" "}
                <Link href="/signin" className="text-[#0071e3]">
                  sign in
                </Link>{" "}
                to create albums and claim a public profile.
              </p>
            )}
          </>
        )}
      </div>

      {showNewAlbum && user && (
        <NewAlbumDialog
          onCancel={() => setShowNewAlbum(false)}
          onCreate={async (name) => {
            const id = await createAlbum(name, user.uid);
            setShowNewAlbum(false);
            router.push(`/album/${id}`);
          }}
        />
      )}

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

function AlbumCard({ album, cover }: { album: Album; cover: Place | null }) {
  return (
    <li>
      <Link href={`/album/${album.id}`} className="group block">
        <div className="aspect-square overflow-hidden rounded-2xl bg-neutral-100 transition group-hover:opacity-90">
          {cover ? <PlaceThumb place={cover} /> : <EmptyCover />}
        </div>
        <p className="mt-2 truncate text-[15px] font-medium">{album.name}</p>
        <p className="text-sm text-neutral-500">
          {album.placeIds?.length ?? 0}
        </p>
      </Link>
    </li>
  );
}

function RecentsCard({ places }: { places: Place[] }) {
  const cover = places[0] ?? null;
  return (
    <li>
      <Link href="/album/recents" className="group block">
        <div className="aspect-square overflow-hidden rounded-2xl bg-neutral-100 transition group-hover:opacity-90">
          {cover ? <PlaceThumb place={cover} /> : <EmptyCover />}
        </div>
        <p className="mt-2 truncate text-[15px] font-medium">Recents</p>
        <p className="text-sm text-neutral-500">{places.length}</p>
      </Link>
    </li>
  );
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

function NewAlbumDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    await onCreate(name.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
      <div className="w-full max-w-xs overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="px-5 pt-5 pb-4 text-center">
          <h3 className="text-[17px] font-semibold">New Album</h3>
          <p className="mt-1 text-[13px] text-neutral-500">
            Enter a name for this album.
          </p>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="Title"
            className="mt-3 w-full rounded-lg border border-black/10 bg-neutral-50 px-3 py-1.5 text-[15px] outline-none focus:border-[#0071e3]"
          />
        </div>
        <div className="grid grid-cols-2 divide-x divide-black/10 border-t border-black/10 text-[17px]">
          <button
            onClick={onCancel}
            className="py-2.5 text-[#0071e3] transition hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!name.trim() || saving}
            className="py-2.5 font-semibold text-[#0071e3] transition hover:bg-neutral-50 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
