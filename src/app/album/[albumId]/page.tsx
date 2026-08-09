"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  subscribeToPlacesByIds,
  subscribeToPlacesByUploader,
} from "@/lib/places";
import {
  addPlacesToAlbum,
  canEditAlbum,
  resolveAlbumPlaces,
  subscribeToAlbum,
  updateAlbumCover,
} from "@/lib/albums";
import { isFirebaseConfigured } from "@/lib/firebase";
import { useAuthProfile } from "@/lib/auth";
import { COVER_EDGE, prepareImage } from "@/lib/imageFile";
import { uploadAlbumCover } from "@/lib/splatStore";
import PlaceThumb from "@/components/PlaceThumb";
import PlaceTile from "@/components/PlaceTile";
import PlaceDetailsEditor from "@/components/PlaceDetailsEditor";
import AlbumCover from "@/components/AlbumCover";
import CaptureRunner from "@/components/CaptureRunner";
import AlbumMembers from "@/components/AlbumMembers";
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
  // Fetched by id rather than filtered out of `places`, which holds only the
  // viewer's own uploads and so would hide whatever a collaborator added.
  const [sharedPlaces, setSharedPlaces] = useState<Place[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState<Place | null>(null);

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
    return subscribeToAlbum(albumId, setAlbum, () =>
      setError("Couldn’t load this album."),
    );
  }, [albumId, isRecents, user]);

  useEffect(() => {
    if (!isFirebaseConfigured || !user) return;
    return subscribeToPlacesByUploader(user.uid, setPlaces, () =>
      setError("Couldn’t load environments."),
    );
  }, [user]);

  // Joined so the listener is rebuilt when the contents change, not on every
  // snapshot that leaves the same array with a new identity.
  const placeIdKey = (album?.placeIds ?? []).join(",");
  useEffect(() => {
    if (isRecents || !user) return;
    const ids = placeIdKey ? placeIdKey.split(",") : [];
    return subscribeToPlacesByIds(ids, setSharedPlaces, () =>
      setError("Couldn’t load environments."),
    );
  }, [placeIdKey, isRecents, user]);

  // Album order is the order places were added, which the id query does not
  // preserve, so the fetched docs are re-sorted back onto placeIds.
  const albumPlaces = useMemo(() => {
    if (isRecents) return places;
    if (album === undefined) return null;
    if (!album) return [];
    // Resolved from the by-id fetch, not from `places`: that holds only the
    // viewer's own uploads, so a collaborator's environments would vanish.
    if (sharedPlaces === null) return null;
    return resolveAlbumPlaces(
      album.placeIds,
      new Map(sharedPlaces.map((p) => [p.id, p])),
    );
  }, [places, album, sharedPlaces, isRecents]);

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
  // Recents is a view of your own uploads, so it is always yours to add to.
  const canEdit = isRecents || (album ? canEditAlbum(album, user?.uid) : false);
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
            {canEdit && (
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Add"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-xl leading-none text-[#0071e3] transition hover:bg-neutral-200"
            >
              +
            </button>
            )}
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
        <div className="mt-8 flex items-end gap-5">
          <div className="h-28 w-28 shrink-0 overflow-hidden rounded-2xl bg-neutral-100 shadow-sm ring-1 ring-black/5 sm:h-36 sm:w-36">
            <AlbumCover
              coverUrl={album?.coverUrl}
              places={readyPlaces}
              alt={title}
            />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[34px] font-bold tracking-tight">
              {title}
            </h1>
            <p className="text-neutral-500">
              {error
                ? error
                : loading
                  ? "Loading…"
                  : `${readyPlaces.length} ${readyPlaces.length === 1 ? "environment" : "environments"}`}
            </p>
            {album && user?.uid === album.ownerId && (
              <CoverControls
                albumId={album.id}
                hasCover={Boolean(album.coverUrl)}
              />
            )}
          </div>
        </div>

        {!isRecents && album && user && (
          <AlbumMembers album={album} viewerId={user.uid} />
        )}

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
                <PlaceTile
                  place={place}
                  href={`/place/${place.id}?album=${albumId}`}
                  onEdit={
                    place.uploaderId === user?.uid
                      ? () => setEditing(place)
                      : undefined
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <PlaceDetailsEditor
          place={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {}}
        />
      )}

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

/**
 * Choosing a cover, or giving one back. Nothing is staged: the album is on a
 * live snapshot, so the tile beside these buttons redraws itself as soon as the
 * write lands, and clearing puts the mosaic of its contents back.
 */
function CoverControls({
  albumId,
  hasCover,
}: {
  albumId: string;
  hasCover: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<void>, whenItFails: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : whenItFails);
    } finally {
      setBusy(false);
      // The input keeps its selection, so picking the same file twice in a row
      // would fire no change event at all.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="mt-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          void run(async () => {
            const cover = await prepareImage(file, {
              maxEdge: COVER_EDGE,
              square: true,
            });
            await updateAlbumCover(albumId, await uploadAlbumCover(albumId, cover));
          }, "Couldn’t set that cover.");
        }}
      />
      <div className="flex items-center gap-4 text-[13px] font-medium">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="text-[#0071e3] transition hover:opacity-70 disabled:opacity-40"
        >
          {busy ? "Working…" : hasCover ? "Change cover" : "Choose cover"}
        </button>
        {hasCover && (
          <button
            type="button"
            onClick={() =>
              void run(
                () => updateAlbumCover(albumId, null),
                "Couldn’t remove that cover.",
              )
            }
            disabled={busy}
            className="text-neutral-500 transition hover:text-neutral-800 disabled:opacity-40"
          >
            Remove
          </button>
        )}
      </div>
      {error && <p className="mt-1.5 text-[12px] text-red-600">{error}</p>}
    </div>
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
