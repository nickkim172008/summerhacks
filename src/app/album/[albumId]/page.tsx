"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  movePlaceToTrash,
  sortPlacesNewestFirst,
  subscribeToPlacesByIds,
  subscribeToPlacesByUploader,
} from "@/lib/places";
import {
  addPlacesToAlbum,
  albumVisibility,
  canContributeToAlbum,
  canEditAlbum,
  ensurePlacesLinkedToAlbum,
  removePlacesFromAlbum,
  resolveAlbumPlaces,
  subscribeToAlbum,
  subscribeToAlbumsByOwner,
  updateAlbumCover,
  updateAlbumVisibility,
} from "@/lib/albums";
import { isFirebaseConfigured } from "@/lib/firebase";
import { useAuthProfile } from "@/lib/auth";
import { COVER_EDGE, prepareImage } from "@/lib/imageFile";
import { uploadAlbumCover } from "@/lib/splatStore";
import PlaceThumb from "@/components/PlaceThumb";
import PlaceTile from "@/components/PlaceTile";
import PlaceDetailsEditor from "@/components/PlaceDetailsEditor";
import AlbumCover from "@/components/AlbumCover";
import AlbumPicker from "@/components/AlbumPicker";
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
  const [editingAsCollaborator, setEditingAsCollaborator] = useState(false);
  const [trashing, setTrashing] = useState<Place | null>(null);
  // Recents belongs to no album, so filing a capture from there needs the
  // whole list to choose from.
  const [ownAlbums, setOwnAlbums] = useState<Album[]>([]);
  const [filing, setFiling] = useState<Place | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function addToAlbum(place: Place, targetAlbumId: string) {
    await addPlacesToAlbum(targetAlbumId, [place.id]);
  }

  async function removeFromAlbum(placeId: string) {
    setActionError(null);
    try {
      await removePlacesFromAlbum(albumId, [placeId]);
    } catch {
      setActionError("Could not remove that from the journey.");
    }
  }

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
    return subscribeToAlbum(albumId, setAlbum, () => {
      setAlbum(null);
      setError("This journey is private, or it doesn’t exist.");
    });
  }, [albumId, isRecents, user]);

  // Whose captures to load: Recents is always the signed-in account, and a
  // named album is whoever owns it — otherwise opening someone else's album
  // would query this account's places and resolve every placeId to nothing.
  const placesOwnerId = isRecents ? user?.uid : album?.ownerId;

  useEffect(() => {
    if (!isFirebaseConfigured || !user || !placesOwnerId) return;
    return subscribeToPlacesByUploader(placesOwnerId, setPlaces, () =>
      setError("Couldn’t load places."),
    );
  }, [user, placesOwnerId]);

  // Joined so the listener is rebuilt when the contents change, not on every
  // snapshot that leaves the same array with a new identity.
  const placeIdKey = (album?.placeIds ?? []).join(",");
  useEffect(() => {
    if (isRecents || !user) return;
    const ids = placeIdKey ? placeIdKey.split(",") : [];
    return subscribeToPlacesByIds(ids, setSharedPlaces, () =>
      setError("Couldn’t load places."),
    );
  }, [placeIdKey, isRecents, user]);

  // Only Recents offers filing into an album, so only Recents needs the list.
  useEffect(() => {
    if (!isFirebaseConfigured || !user || !isRecents) return;
    return subscribeToAlbumsByOwner(user.uid, setOwnAlbums);
  }, [user, isRecents]);

  // Older places predate albumIds; stamp this journey on so collaborators can
  // edit location under the new rules.
  useEffect(() => {
    if (isRecents || !album || !user) return;
    if (!canEditAlbum(album, user.uid)) return;
    const ids = album.placeIds ?? [];
    if (ids.length === 0) return;
    void ensurePlacesLinkedToAlbum(album.id, ids);
  }, [album, isRecents, user]);

  const albumPlaces = useMemo(() => {
    if (isRecents) return places;
    if (album === undefined) return null;
    if (!album) return [];
    // Resolved from the by-id fetch, not from `places`: that holds only the
    // viewer's own uploads, so a collaborator's environments would vanish.
    if (sharedPlaces === null) return null;
    return sortPlacesNewestFirst(
      resolveAlbumPlaces(
        album.placeIds,
        new Map(sharedPlaces.map((p) => [p.id, p])),
      ),
    );
  }, [places, album, sharedPlaces, isRecents]);

  // What "Add Existing Place" offers is always the viewer's own uploads —
  // `places` holds the album owner's, which on someone else's public journey
  // is not who is contributing.
  const [myPlaces, setMyPlaces] = useState<Place[] | null>(null);
  useEffect(() => {
    if (!isFirebaseConfigured || !user) return;
    if (placesOwnerId === user.uid) return;
    return subscribeToPlacesByUploader(user.uid, setMyPlaces, () =>
      setMyPlaces([]),
    );
  }, [user, placesOwnerId]);

  const candidates = useMemo(() => {
    const mine = placesOwnerId === user?.uid ? places : myPlaces;
    if (isRecents || !mine) return [];
    const inAlbum = new Set(album?.placeIds ?? []);
    return mine.filter((p) => !inAlbum.has(p.id));
  }, [places, myPlaces, placesOwnerId, user, album, isRecents]);

  if (!isRecents && album === null) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-3 bg-[#FAF9F7] text-[#14161A]">
        <p className="text-[15px] text-[#4A4F57]">
          That journey doesn&apos;t exist.
        </p>
        <Link
          href="/"
          className="text-[15px] font-medium text-[#14161A] transition hover:opacity-70"
        >
          Back to Library
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
  // Public journeys take places from anyone signed in; adding is the one
  // thing contribution opens — removing and editing stay membership-scoped.
  const canContribute =
    canEdit || (album ? canContributeToAlbum(album, user?.uid) : false);
  // ?new=1 so the entry point is always a blank form, never the saved capture.
  const captureHref = isRecents
    ? "/capture?new=1"
    : `/capture?album=${albumId}&new=1`;
  // Both read off the places already in hand — nothing here asks Firestore a
  // second question to fill the line under the title.
  const whereabouts = describeWhereabouts(readyPlaces);
  const span = describeSpan(readyPlaces);

  return (
    <main className="min-h-screen bg-[#FAF9F7] text-[#14161A]">
      <div className="mx-auto max-w-[1152px] px-8 pb-16">
        <div className="pt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#4A4F57] transition hover:text-[#14161A]"
          >
            <ChevronLeftGlyph />
            Library
          </Link>
        </div>

        <div className="mt-5 flex items-start gap-8 border-b border-[rgba(20,22,26,0.09)] pb-7">
          <div className="h-[212px] w-[212px] shrink-0 overflow-hidden rounded-2xl bg-white shadow-[0_2px_4px_rgba(20,22,26,0.06),0_20px_40px_-24px_rgba(20,22,26,0.5)]">
            <AlbumCover
              coverUrl={album?.coverUrl}
              places={readyPlaces}
              alt={title}
            />
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <p className="text-[11px] font-semibold uppercase leading-3 tracking-[0.12em] text-[#6B7178]">
              Journey
            </p>
            <h1 className="mt-2 truncate font-display text-[46px] leading-[47px] font-normal tracking-[-0.02em]">
              {title}
            </h1>
            {error ? (
              <p className="mt-2.5 text-[15px] text-[#C0362C]">{error}</p>
            ) : loading ? (
              <p className="mt-2.5 text-[15px] text-[#6B7178]">Loading…</p>
            ) : (
              <p className="mt-2.5 text-[15px] text-[#4A4F57]">
                <span className="tabular-nums">{readyPlaces.length}</span>{" "}
                {readyPlaces.length === 1 ? "place" : "places"}
                {whereabouts && ` · ${whereabouts}`}
                {span && ` · ${span}`}
                {album && ` · ${albumVisibility(album) === "public" ? "Public" : "Private"}`}
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {/* Recents is a view of everything rather than an album, so there
                  is no story through it to walk — and no album name to head one
                  with. The walkthrough starts on the map, which flies to the
                  earliest capture before handing over. */}
              {!isRecents && !loading && !error && readyPlaces.length > 0 && (
                <Link
                  href={`/map?album=${albumId}&tour=1&from=${encodeURIComponent(
                    `/album/${albumId}`,
                  )}`}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-[#0071E3] px-[22px] text-[15px] font-medium text-white shadow-[0_6px_18px_-8px_rgba(0,113,227,0.8)] transition hover:bg-[#0077ED]"
                >
                  <PlayGlyph />
                  Play walkthrough
                </Link>
              )}

              {canContribute &&
                (isRecents ? (
                  // Recents holds no album to file into, so the only way to add
                  // to it is to capture something new.
                  <Link
                    href="/capture?new=1"
                    className="inline-flex h-10 items-center gap-[7px] rounded-full border border-[rgba(20,22,26,0.14)] bg-white px-[18px] text-[15px] font-medium text-[#14161A] transition hover:bg-[rgba(20,22,26,0.04)]"
                  >
                    <PlusGlyph />
                    Add places
                  </Link>
                ) : (
                  <button
                    onClick={() => setShowPicker(true)}
                    className="inline-flex h-10 items-center gap-[7px] rounded-full border border-[rgba(20,22,26,0.14)] bg-white px-[18px] text-[15px] font-medium text-[#14161A] transition hover:bg-[rgba(20,22,26,0.04)]"
                  >
                    <PlusGlyph />
                    Add places
                  </button>
                ))}

              <div className="relative">
                {canContribute && (
                  <button
                    onClick={() => setMenuOpen((v) => !v)}
                    aria-label="More"
                    aria-expanded={menuOpen}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(20,22,26,0.14)] bg-white text-[15px] font-bold leading-none text-[#4A4F57] transition hover:bg-[rgba(20,22,26,0.04)]"
                  >
                    ⋯
                  </button>
                )}
                {menuOpen && (
                  <div className="absolute right-0 top-12 z-30 w-64 overflow-hidden rounded-2xl border border-[rgba(20,22,26,0.09)] bg-white py-1.5 shadow-[0_12px_28px_-18px_rgba(20,22,26,0.4)]">
                    <Link
                      href={captureHref}
                      className="block px-4 py-2.5 text-[14px] text-[#14161A] transition hover:bg-[rgba(20,22,26,0.05)]"
                    >
                      Capture New Place
                    </Link>
                    {!isRecents && (
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          setShowPicker(true);
                        }}
                        className="block w-full px-4 py-2.5 text-left text-[14px] text-[#14161A] transition hover:bg-[rgba(20,22,26,0.05)]"
                      >
                        Add Existing Place
                      </button>
                    )}
                    {album && user?.uid === album.ownerId && (
                      <>
                        <VisibilityToggle album={album} />
                        <CoverControls
                          albumId={album.id}
                          hasCover={Boolean(album.coverUrl)}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>

              {!isRecents && album && user && canEdit && (
                <div className="ml-2 min-w-0">
                  <AlbumMembers album={album} viewerId={user.uid} />
                </div>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-10">
            <Link
              href="/"
              className="text-[15px] font-medium text-[#14161A] transition hover:opacity-70"
            >
              Back to Library
            </Link>
          </div>
        )}

        {!error && !loading && readyPlaces.length === 0 && (
          <div className="mt-24 flex flex-col items-center gap-2 text-center">
            <p className="font-display text-[22px] leading-[28px] font-normal tracking-[-0.01em]">
              No places
            </p>
            <p className="max-w-[38ch] text-[15px] leading-6 text-[#4A4F57]">
              Capture a place or add existing ones to tell the story of
              this journey.
            </p>
            {isRecents ? (
              <Link
                href="/capture?new=1"
                className="mt-3 inline-flex h-10 items-center rounded-full bg-[#14161A] px-5 text-[15px] font-medium text-white transition hover:bg-[#2B2F36]"
              >
                Capture a Place
              </Link>
            ) : canContribute ? (
              <button
                onClick={() => setShowPicker(true)}
                className="mt-3 inline-flex h-10 items-center rounded-full bg-[#14161A] px-5 text-[15px] font-medium text-white transition hover:bg-[#2B2F36]"
              >
                Add Places
              </button>
            ) : null}
          </div>
        )}

        {actionError && (
          <p className="mt-4 text-[15px] text-[#C0362C]">{actionError}</p>
        )}

        {!error && !loading && readyPlaces.length > 0 && (
          <div className="mt-6 flex items-center justify-between">
            <h2 className="text-[20px] font-semibold leading-[26px] tracking-[-0.01em]">
              Places
            </h2>
            <span className="text-[13px] text-[#4A4F57]">Newest first</span>
          </div>
        )}

        {/* Anything this album has in flight, reconstructing in place. The
            capture form starts work; this is where it is watched. It sits at
            the head of the places section, above what has already landed —
            and is mounted unconditionally, because it is the poll loop for
            this album's jobs and cannot sit behind the grid's guard. */}
        <CaptureRunner albumId={isRecents ? null : albumId} mode="album" />

        {!error && !loading && readyPlaces.length > 0 && (
          <ul className="mt-4 grid grid-cols-4 gap-x-5 gap-y-6">
            {readyPlaces.map((place) => (
              <li key={place.id}>
                <PlaceTile
                  place={place}
                  href={`/place/${place.id}?album=${albumId}`}
                  onEdit={
                    place.uploaderId === user?.uid
                      ? () => {
                          setEditingAsCollaborator(false);
                          setEditing(place);
                        }
                      : canEdit
                        ? () => {
                            setEditingAsCollaborator(true);
                            setEditing(place);
                          }
                        : undefined
                  }
                  // Recents is a view of everything, not an album, so there is
                  // nothing there to be removed from.
                  onRemoveFromAlbum={
                    isRecents ? undefined : () => removeFromAlbum(place.id)
                  }
                  // Filing belongs where the whole library is in view; inside
                  // an album the capture is already somewhere.
                  onAddToAlbum={
                    isRecents && place.uploaderId === user?.uid
                      ? () => setFiling(place)
                      : undefined
                  }
                  onTrash={
                    place.uploaderId === user?.uid
                      ? () => setTrashing(place)
                      : undefined
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {trashing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(20,22,26,0.35)] p-6">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-[0_24px_60px_-30px_rgba(20,22,26,0.5)]">
            <h2 className="font-display text-[22px] leading-[28px] font-normal tracking-[-0.01em]">
              Delete {trashing.name}?
            </h2>
            <p className="mt-2 text-[14px] leading-[21px] text-[#4A4F57]">
              It goes to the trash, and every journey loses it. You can put it
              back until you empty the trash.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setTrashing(null)}
                className="text-[15px] font-medium text-[#4A4F57] transition hover:text-[#14161A]"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const place = trashing;
                  setTrashing(null);
                  setActionError(null);
                  try {
                    await movePlaceToTrash(place.id);
                  } catch {
                    setActionError("Could not delete that place.");
                  }
                }}
                className="inline-flex h-10 items-center rounded-full bg-[#C0362C] px-5 text-[15px] font-medium text-white transition hover:opacity-90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {filing && (
        <AlbumPicker
          place={filing}
          albums={ownAlbums}
          placesIn={(album) =>
            resolveAlbumPlaces(
              album.placeIds,
              new Map((places ?? []).map((p) => [p.id, p])),
            )
          }
          onPick={(targetAlbumId) => addToAlbum(filing, targetAlbumId)}
          onClose={() => setFiling(null)}
        />
      )}

      {editing && (
        <PlaceDetailsEditor
          place={editing}
          collaborator={editingAsCollaborator}
          onClose={() => {
            setEditing(null);
            setEditingAsCollaborator(false);
          }}
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

function VisibilityToggle({ album }: { album: Album }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = albumVisibility(album);

  async function setVisibility(next: "private" | "public") {
    if (busy || next === current) return;
    setBusy(true);
    setError(null);
    try {
      await updateAlbumVisibility(album.id, next);
    } catch {
      setError("Couldn’t update visibility.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1.5 border-t border-[rgba(20,22,26,0.09)] px-4 pb-1 pt-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B7178]">
        Who can see this
      </p>
      <div className="mt-2 flex items-center gap-0.5 rounded-full bg-[rgba(20,22,26,0.05)] p-[3px]">
        <button
          type="button"
          disabled={busy}
          aria-pressed={current === "private"}
          onClick={() => setVisibility("private")}
          className={`flex-1 rounded-full px-3 py-1 text-[13px] transition-colors duration-150 disabled:opacity-40 ${
            current === "private"
              ? "bg-white font-medium text-[#14161A] shadow-[0_1px_2px_rgba(20,22,26,0.06)]"
              : "text-[#4A4F57] hover:text-[#14161A]"
          }`}
        >
          Private
        </button>
        <button
          type="button"
          disabled={busy}
          aria-pressed={current === "public"}
          onClick={() => setVisibility("public")}
          className={`flex-1 rounded-full px-3 py-1 text-[13px] transition-colors duration-150 disabled:opacity-40 ${
            current === "public"
              ? "bg-white font-medium text-[#14161A] shadow-[0_1px_2px_rgba(20,22,26,0.06)]"
              : "text-[#4A4F57] hover:text-[#14161A]"
          }`}
        >
          Public
        </button>
      </div>
      {error && <p className="mt-1.5 text-[13px] text-[#C0362C]">{error}</p>}
    </div>
  );
}

/**
 * Where this journey went, in the words the captures already carry. Only the
 * places on screen are consulted — the line under a title is not worth a query.
 */
function describeWhereabouts(places: Place[]) {
  const named: string[] = [];
  for (const place of places) {
    const where = place.locationName?.trim();
    if (where && !named.includes(where)) named.push(where);
  }
  if (named.length === 0) return null;
  if (named.length === 1) return named[0];
  if (named.length === 2) return `${named[0]} and ${named[1]}`;
  return `${named[0]}, ${named[1]} and ${named.length - 2} more`;
}

/** The span the journey covers, from the capture dates already loaded. */
function describeSpan(places: Place[]) {
  const stamps = places
    .map((place) => (place.capturedAt ? Date.parse(place.capturedAt) : NaN))
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
  if (stamps.length === 0) return null;
  const first = new Date(stamps[0]);
  const last = new Date(stamps[stamps.length - 1]);
  const month = (date: Date) =>
    date.toLocaleDateString(undefined, { month: "long" });
  if (first.getFullYear() !== last.getFullYear()) {
    return `${month(first)} ${first.getFullYear()} – ${month(last)} ${last.getFullYear()}`;
  }
  if (month(first) === month(last)) return `${month(first)} ${last.getFullYear()}`;
  return `${month(first)} – ${month(last)} ${last.getFullYear()}`;
}

function ChevronLeftGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
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

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
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
    <div className="mt-1.5 border-t border-[rgba(20,22,26,0.09)] pt-1.5">
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
            await updateAlbumCover(
              albumId,
              await uploadAlbumCover(albumId, cover),
            );
          }, "Couldn’t set that cover.");
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="block w-full px-4 py-2.5 text-left text-[14px] text-[#14161A] transition hover:bg-[rgba(20,22,26,0.05)] disabled:opacity-40"
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
          className="block w-full px-4 py-2.5 text-left text-[14px] text-[#4A4F57] transition hover:bg-[rgba(20,22,26,0.05)] disabled:opacity-40"
        >
          Remove
        </button>
      )}
      {error && (
        <p className="px-4 pb-1 pt-1.5 text-[12px] text-[#C0362C]">{error}</p>
      )}
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(20,22,26,0.35)] sm:items-center sm:p-6">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-[0_24px_60px_-30px_rgba(20,22,26,0.5)] sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-[rgba(20,22,26,0.09)] px-5 py-3.5">
          <button
            onClick={onClose}
            className="text-[15px] text-[#4A4F57] transition hover:text-[#14161A]"
          >
            Cancel
          </button>
          <h3 className="font-display text-[20px] leading-[26px] font-normal tracking-[-0.01em]">
            Add to Journey
          </h3>
          <button
            disabled={selected.size === 0 || saving}
            onClick={async () => {
              setSaving(true);
              await onAdd([...selected]);
            }}
            className="text-[15px] font-semibold text-[#14161A] transition hover:opacity-70 disabled:opacity-40"
          >
            {saving ? "Adding…" : "Add"}
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          {candidates.length === 0 ? (
            <p className="py-10 text-center text-[15px] text-[#6B7178]">
              Every place is already in this journey.{" "}
              <Link
                href={captureHref}
                className="font-medium text-[#14161A] transition hover:opacity-70"
              >
                Capture a new one
              </Link>
              .
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {candidates.map((place) => {
                const isSelected = selected.has(place.id);
                return (
                  <li key={place.id}>
                    <button
                      onClick={() => toggle(place.id)}
                      className="relative block aspect-square w-full overflow-hidden rounded-xl transition hover:opacity-90"
                    >
                      <PlaceThumb place={place} />
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[rgba(20,22,26,0.72)] to-transparent px-2.5 pb-2 pt-7 text-left text-[12px] font-medium text-white">
                        <span className="block truncate">{place.name}</span>
                      </span>
                      <span
                        className={`absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${
                          isSelected
                            ? "border-white bg-[#0071E3] text-white"
                            : "border-white/80 bg-[rgba(20,22,26,0.2)] text-transparent"
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
