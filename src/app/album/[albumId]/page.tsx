"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { subscribeToPlacesByUploader } from "@/lib/places";
import { addPlacesToAlbum, subscribeToAlbum } from "@/lib/albums";
import { isFirebaseConfigured } from "@/lib/firebase";
import { useAuthProfile } from "@/lib/auth";
import PlaceThumb from "@/components/PlaceThumb";
import CaptureRunner from "@/components/CaptureRunner";
import type { Album, Place } from "@/lib/types";

/** "recents" is a virtual album containing every environment you own. */
export default function AlbumPage({
  params,
}: {
  params: Promise<{ albumId: string }>;
}) {
  const { albumId } = use(params);
  const isRecents = albumId === "recents";
  const router = useRouter();
  const { user, loading: authLoading, needsUsername } = useAuthProfile();

  const [album, setAlbum] = useState<Album | null | undefined>(
    isRecents ? null : undefined,
  );
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/signin");
      return;
    }
    if (needsUsername) router.replace("/setup");
  }, [authLoading, needsUsername, router, user]);

  useEffect(() => {
    if (isRecents || !user) return;
    return subscribeToAlbum(
      albumId,
      setAlbum,
      () => setError("Couldn’t load this album."),
    );
  }, [albumId, isRecents, user]);

  useEffect(() => {
    if (!isFirebaseConfigured || !user) return;
    return subscribeToPlacesByUploader(
      user.uid,
      setPlaces,
      () => setError("Couldn’t load environments."),
    );
  }, [user]);

  const albumPlaces = useMemo(() => {
    if (places === null) return null;
    if (isRecents) return places;
    if (!album) return [];
    const byId = new Map(places.map((p) => [p.id, p]));
    return (album.placeIds ?? [])
      .map((id) => byId.get(id))
      .filter((p): p is Place => Boolean(p));
  }, [places, album, isRecents]);

  const candidates = useMemo(() => {
    if (isRecents || !places) return [];
    const inAlbum = new Set(album?.placeIds ?? []);
    return places.filter((p) => !inAlbum.has(p.id));
  }, [places, album, isRecents]);

  if (!isRecents && album === null) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-3 bg-white text-[#1d1d1f]">
        <p>That album doesn&apos;t exist.</p>
        <Link href="/" className="text-[#0071e3]">
          Back to Albums
        </Link>
      </main>
    );
  }

  const title = isRecents ? "Recents" : (album?.name ?? "");
  const loading =
    !error &&
    (authLoading ||
      !user ||
      albumPlaces === null ||
      (!isRecents && album === undefined));
  const readyPlaces = albumPlaces ?? [];
  // ?new=1 so the entry point is always a blank form, never the saved capture.
  const captureHref = isRecents
    ? "/capture?new=1"
    : `/capture?album=${albumId}&new=1`;

  return (
    <main className="min-h-screen bg-white pb-20 text-[#1d1d1f]">
      <nav className="sticky top-0 z-20 border-b border-black/10 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-13 max-w-5xl items-center justify-between px-6 py-3">
          <Link
            href="/"
            className="flex items-center gap-1 text-[17px] text-[#0071e3]"
          >
            <span aria-hidden className="text-xl leading-none">
              ‹
            </span>
            Albums
          </Link>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Add"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-xl leading-none text-[#0071e3] transition hover:bg-neutral-200"
            >
              +
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-10 z-30 w-64 overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/10">
                <Link
                  href={captureHref}
                  className="block px-4 py-3 text-[15px] transition hover:bg-neutral-50"
                >
                  Capture New Environment
                </Link>
                {!isRecents && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setShowPicker(true);
                    }}
                    className="block w-full border-t border-black/5 px-4 py-3 text-left text-[15px] transition hover:bg-neutral-50"
                  >
                    Add Existing Environment
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-6">
        <h1 className="mt-8 text-[34px] font-bold tracking-tight">{title}</h1>
        <p className="text-neutral-500">
          {error
            ? error
            : loading
              ? "Loading…"
              : `${readyPlaces.length} ${readyPlaces.length === 1 ? "environment" : "environments"}`}
        </p>

        {error && (
          <div className="mt-10">
            <Link href="/" className="text-[#0071e3]">
              Back to Albums
            </Link>
          </div>
        )}

        {!error && !loading && readyPlaces.length === 0 && (
          <div className="mt-24 flex flex-col items-center gap-2 text-center">
            <p className="text-[22px] font-semibold">No Environments</p>
            <p className="max-w-xs text-sm text-neutral-500">
              Capture a place or add existing environments to tell the story of
              this album.
            </p>
            {isRecents ? (
              <Link
                href="/capture?new=1"
                className="mt-3 rounded-full bg-[#0071e3] px-5 py-2 text-sm font-medium text-white transition hover:bg-[#0077ed]"
              >
                Capture an Environment
              </Link>
            ) : (
              <button
                onClick={() => setShowPicker(true)}
                className="mt-3 rounded-full bg-[#0071e3] px-5 py-2 text-sm font-medium text-white transition hover:bg-[#0077ed]"
              >
                Add Environments
              </button>
            )}
          </div>
        )}

        {/* Anything this album has in flight, reconstructing in place. The
            capture form starts work; this is where it is watched. */}
        <CaptureRunner albumId={isRecents ? null : albumId} mode="album" />

        {!error && !loading && readyPlaces.length > 0 && (
          <ul className="mt-6 grid grid-cols-3 gap-0.5 sm:grid-cols-4 md:grid-cols-5">
            {readyPlaces.map((place) => (
              <li key={place.id}>
                <Link
                  href={`/place/${place.id}?album=${albumId}`}
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
      </div>

      {showPicker && !isRecents && (
        <AddEnvironmentsSheet
          candidates={candidates}
          captureHref={captureHref}
          onClose={() => setShowPicker(false)}
          onAdd={async (ids) => {
            await addPlacesToAlbum(albumId, ids);
            setShowPicker(false);
          }}
        />
      )}
    </main>
  );
}

function AddEnvironmentsSheet({
  candidates,
  captureHref,
  onClose,
  onAdd,
}: {
  candidates: Place[];
  captureHref: string;
  onClose: () => void;
  onAdd: (ids: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-6">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-black/10 px-5 py-3">
          <button onClick={onClose} className="text-[17px] text-[#0071e3]">
            Cancel
          </button>
          <h3 className="text-[17px] font-semibold">Add to Album</h3>
          <button
            disabled={selected.size === 0 || saving}
            onClick={async () => {
              setSaving(true);
              await onAdd([...selected]);
            }}
            className="text-[17px] font-semibold text-[#0071e3] disabled:opacity-40"
          >
            {saving ? "Adding…" : "Add"}
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          {candidates.length === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-500">
              Every environment is already in this album.{" "}
              <Link href={captureHref} className="text-[#0071e3]">
                Capture a new one
              </Link>
              .
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-1 sm:grid-cols-4">
              {candidates.map((place) => {
                const isSelected = selected.has(place.id);
                return (
                  <li key={place.id}>
                    <button
                      onClick={() => toggle(place.id)}
                      className="relative block aspect-square w-full overflow-hidden rounded-md"
                    >
                      <PlaceThumb place={place} />
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1 pt-6 text-left text-xs font-medium text-white">
                        {place.name}
                      </span>
                      <span
                        className={`absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${
                          isSelected
                            ? "border-white bg-[#0071e3] text-white"
                            : "border-white/80 bg-black/20 text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
