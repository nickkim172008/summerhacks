"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  subscribeToPlacesByIds,
  subscribeToPlacesByUploader,
} from "@/lib/places";
import {
  createAlbum,
  resolveAlbumPlaces,
  subscribeToAlbumsByOwner,
  subscribeToAlbumsSharedWith,
} from "@/lib/albums";
import { isFirebaseConfigured } from "@/lib/firebase";
import { useAuthProfile } from "@/lib/auth";
import AlbumCover from "@/components/AlbumCover";
import AlbumCollaborators from "@/components/AlbumCollaborators";
import type { Album, Place } from "@/lib/types";

export default function AlbumsPage() {
  const router = useRouter();
  const { user, loading: authLoading, needsUsername } = useAuthProfile();
  const [ownedAlbums, setOwnedAlbums] = useState<Album[] | null>(null);
  const [sharedAlbums, setSharedAlbums] = useState<Album[] | null>(null);
  const [ownPlaces, setOwnPlaces] = useState<Place[] | null>(null);
  const [sharedPlaces, setSharedPlaces] = useState<Place[]>([]);
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
    return subscribeToPlacesByUploader(user.uid, setOwnPlaces, () =>
      setError(true),
    );
  }, [authLoading, user]);

  useEffect(() => {
    if (!isFirebaseConfigured || !user) return;
    return subscribeToAlbumsByOwner(user.uid, setOwnedAlbums, () =>
      setError(true),
    );
  }, [user]);

  useEffect(() => {
    if (!isFirebaseConfigured || !user) return;
    return subscribeToAlbumsSharedWith(user.uid, setSharedAlbums, () =>
      setSharedAlbums([]),
    );
  }, [user]);

  // Shared album covers need places that belong to someone else, so they are
  // fetched by id rather than by this account's uploader query.
  const sharedPlaceIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const album of sharedAlbums ?? []) {
      for (const id of album.placeIds ?? []) ids.add(id);
    }
    return [...ids].sort().join(",");
  }, [sharedAlbums]);

  useEffect(() => {
    if (!user) {
      setSharedPlaces([]);
      return;
    }
    const ids = sharedPlaceIdsKey ? sharedPlaceIdsKey.split(",") : [];
    return subscribeToPlacesByIds(ids, setSharedPlaces, () =>
      setSharedPlaces([]),
    );
  }, [user, sharedPlaceIdsKey]);

  const placeById = useMemo(() => {
    const map = new Map<string, Place>();
    for (const place of ownPlaces ?? []) map.set(place.id, place);
    for (const place of sharedPlaces) map.set(place.id, place);
    return map;
  }, [ownPlaces, sharedPlaces]);

  const loading =
    !error &&
    (authLoading ||
      !user ||
      ownPlaces === null ||
      ownedAlbums === null ||
      sharedAlbums === null);

  return (
    <main className="min-h-screen bg-white pb-20 text-[#1d1d1f]">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mt-8 flex items-center justify-between gap-3">
          <h2 className="text-[22px] font-bold tracking-tight">My Journeys</h2>
          <div className="flex items-center gap-4">
            <Link
              href="/trash"
              aria-label="Recently Deleted"
              title="Recently Deleted"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-[#0071e3] transition hover:bg-neutral-200"
            >
              <TrashGlyph />
            </Link>
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
              aria-label="New Journey"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-xl leading-none text-[#0071e3] transition hover:bg-neutral-200"
            >
              +
            </button>
          </div>
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
            <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
              <RecentsCard places={ownPlaces ?? []} />
              {(ownedAlbums ?? []).map((album) => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  places={resolveAlbumPlaces(album.placeIds, placeById)}
                />
              ))}
            </ul>

            {(ownedAlbums?.length ?? 0) === 0 && (
              <p className="mt-6 text-sm text-neutral-500">
                Create a journey with the{" "}
                <span className="font-medium text-[#0071e3]">+</span> button and
                start capturing places — for example, a “Summer Hacks” journey
                for the whole trip.
              </p>
            )}

            <h2 className="mt-12 text-[22px] font-bold tracking-tight">
              Shared Journeys
            </h2>
            {(sharedAlbums?.length ?? 0) === 0 ? (
              <p className="mt-3 text-sm text-neutral-500">
                Journeys others invite you to show up here after you accept from
                Notifications.
              </p>
            ) : (
              <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
                {(sharedAlbums ?? []).map((album) => (
                  <AlbumCard
                    key={album.id}
                    album={album}
                    places={resolveAlbumPlaces(album.placeIds, placeById)}
                  />
                ))}
              </ul>
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

function TrashGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
    >
      <path d="M4 7h16M10 4h4M9 7v12M15 7v12M6 7l1 13h10l1-13" />
    </svg>
  );
}

function AlbumCard({ album, places }: { album: Album; places: Place[] }) {
  return (
    <li>
      <Link href={`/album/${album.id}`} className="group block">
        <div className="relative aspect-square overflow-hidden rounded-2xl bg-neutral-100 transition group-hover:opacity-90">
          <AlbumCover
            coverUrl={album.coverUrl}
            places={places}
            alt={album.name}
          />
          <AlbumCollaborators album={album} />
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
  return (
    <li>
      <Link href="/album/recents" className="group block">
        <div className="aspect-square overflow-hidden rounded-2xl bg-neutral-100 transition group-hover:opacity-90">
          <AlbumCover places={places} alt="Recents" />
        </div>
        <p className="mt-2 truncate text-[15px] font-medium">Recents</p>
        <p className="text-sm text-neutral-500">{places.length}</p>
      </Link>
    </li>
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
          <h3 className="text-[17px] font-semibold">New Journey</h3>
          <p className="mt-1 text-[13px] text-neutral-500">
            Enter a name for this journey.
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
