"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  subscribeToPlacesByIds,
  subscribeToPlacesByUploader,
} from "@/lib/places";
import {
  albumMemberIds,
  albumVisibility,
  createAlbum,
  deleteAlbum,
  leaveAlbum,
  renameAlbum,
  resolveAlbumPlaces,
  subscribeToAlbumsByOwner,
  subscribeToAlbumsSharedWith,
  subscribeToPublicAlbums,
} from "@/lib/albums";
import { isFirebaseConfigured } from "@/lib/firebase";
import { useAuthProfile } from "@/lib/auth";
import { signInHref, signUpHref } from "@/lib/returnTo";
import { subscribeToRecentProfiles } from "@/lib/profiles";
import {
  DEMO_OWNED_JOURNEYS,
  DEMO_SHARED_JOURNEYS,
  canSeeDemoJourneys,
  isPinnedBeforeDemoShared,
  type DemoJourney,
} from "@/lib/demoJourneys";
import AlbumCover from "@/components/AlbumCover";
import AlbumCollaborators from "@/components/AlbumCollaborators";
import Avatar from "@/components/Avatar";
import TileMenu, { type TileMenuItem } from "@/components/TileMenu";
import { AlbumCardSkeleton, SkeletonList } from "@/components/Skeleton";
import { riseDelay } from "@/lib/motion";
import type { Album, AlbumVisibility, Place, Profile } from "@/lib/types";

/** The library counts things constantly; "1 places" is not worth shipping. */
function countLabel(n: number, singular: string, plural: string) {
  return `${n} ${n === 1 ? singular : plural}`;
}

export default function AlbumsPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading, needsUsername } = useAuthProfile();
  const showDemoJourneys = canSeeDemoJourneys(user?.email, profile?.username);
  const [ownedAlbums, setOwnedAlbums] = useState<Album[] | null>(null);
  const [sharedAlbums, setSharedAlbums] = useState<Album[] | null>(null);
  const [ownPlaces, setOwnPlaces] = useState<Place[] | null>(null);
  const [sharedPlaces, setSharedPlaces] = useState<Place[]>([]);
  const [error, setError] = useState(!isFirebaseConfigured);
  const [showNewAlbum, setShowNewAlbum] = useState(false);
  const [renaming, setRenaming] = useState<Album | null>(null);
  const [deleting, setDeleting] = useState<Album | null>(null);
  const [leaving, setLeaving] = useState<Album | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Real faces for the demo shared journey — pulled from Firestore so the
  // cover stack looks like the rest of the library.
  const [demoFaces, setDemoFaces] = useState<Profile[]>([]);

  // No redirect for a signed-out visitor: this page becomes the public gallery
  // below instead. Sending them to /signin was what made trying the deployment
  // start with a login form and nothing to look at.
  useEffect(() => {
    if (authLoading || !user) return;
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

  useEffect(() => {
    if (!isFirebaseConfigured || !user || !showDemoJourneys) {
      setDemoFaces([]);
      return;
    }
    const want = Math.max(
      ...DEMO_SHARED_JOURNEYS.map((j) => j.shared?.faceCount ?? 0),
      3,
    );
    return subscribeToRecentProfiles(
      (profiles) => {
        const withPhotos = profiles.filter(
          (p) => p.id !== user.uid && Boolean(p.photoURL),
        );
        const pool = withPhotos.length >= want ? withPhotos : profiles;
        setDemoFaces(pool.slice(0, want));
      },
      () => setDemoFaces([]),
    );
  }, [user, showDemoJourneys]);

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

  // Where the owned albums start in the first grid: Recents, then however many
  // demo journeys are being shown. Only the arrival stagger reads this.
  const ownedOffset =
    1 + (showDemoJourneys ? DEMO_OWNED_JOURNEYS.length : 0);

  function startNewAlbum() {
    if (!user) {
      router.push(signInHref("/"));
      return;
    }
    if (needsUsername) {
      router.push("/setup");
      return;
    }
    setShowNewAlbum(true);
  }

  // Every hook above has already run, so this is safe to sit here rather than
  // at the top: a visitor without an account gets the public shelf, and none of
  // the private listeners above ever open for them.
  if (!authLoading && !user) return <PublicLibrary />;

  return (
    <main className="min-h-screen bg-[#FAF9F7] text-[#14161A]">
      <div className="mx-auto max-w-[1152px] px-8 py-10">
        <div className="flex items-end justify-between gap-8">
          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B7178] tabular-nums">
              {countLabel(ownPlaces?.length ?? 0, "place", "places")} ·{" "}
              {countLabel(ownedAlbums?.length ?? 0, "journey", "journeys")}
            </p>
            <h1 className="font-display text-[44px] font-normal leading-[44px] tracking-[-0.02em]">
              Your library
            </h1>
          </div>
          <div className="flex flex-none items-center gap-2">
            <Link
              href="/trash"
              aria-label="Recently Deleted"
              title="Recently Deleted"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(20,22,26,0.14)] bg-white text-[#4A4F57] transition-colors duration-150 hover:text-[#14161A]"
            >
              <TrashGlyph />
            </Link>
          </div>
        </div>

        {error && (
          <p className="mt-8 max-w-[62ch] text-[15px] leading-6 text-[#C0362C]">
            Not connected. Copy{" "}
            <code className="rounded bg-[rgba(20,22,26,0.05)] px-1 py-0.5 text-[13px] text-[#14161A]">
              .env.local.example
            </code>{" "}
            to{" "}
            <code className="rounded bg-[rgba(20,22,26,0.05)] px-1 py-0.5 text-[13px] text-[#14161A]">
              .env.local
            </code>
            , fill in the Firebase keys, and restart the dev server.
          </p>
        )}

        {loading && (
          <>
            {/* The grid the library is about to be, at the size it will be —
                so the covers land in the holes already cut for them. */}
            <p className="sr-only" role="status">
              Loading your library…
            </p>
            <SkeletonList
              count={8}
              className="mt-8 grid grid-cols-4 gap-x-6 gap-y-7"
              item={() => <AlbumCardSkeleton />}
            />
            <div className="mt-12 border-t border-[rgba(20,22,26,0.09)] pt-6">
              <h2 className="text-[20px] font-semibold leading-[26px] tracking-[-0.01em]">
                Shared with you
              </h2>
              <SkeletonList
                count={4}
                className="mt-5 grid grid-cols-4 gap-x-6 gap-y-7"
                item={() => <AlbumCardSkeleton />}
              />
            </div>
          </>
        )}

        {!error && !loading && (
          <>
            <ul
              className="mt-8 scroll-mt-20 grid grid-cols-4 gap-x-6 gap-y-7"
            >
              <RecentsCard places={ownPlaces ?? []} />
              {showDemoJourneys &&
                DEMO_OWNED_JOURNEYS.map((journey, index) => (
                  <DemoJourneyCard
                    key={journey.id}
                    journey={journey}
                    index={index + 1}
                  />
                ))}
              {(ownedAlbums ?? []).map((album, index) => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  places={resolveAlbumPlaces(album.placeIds, placeById)}
                  // Counted from the top of the grid, not from the top of this
                  // list: Recents is always first, and the demo journeys sit
                  // between it and the real ones. Restarting the stagger here
                  // would send the wave backwards mid-row.
                  index={index + ownedOffset}
                  onEdit={() => setRenaming(album)}
                  onDelete={() => setDeleting(album)}
                />
              ))}
              <NewJourneyCard onClick={startNewAlbum} />
            </ul>

            <div
              className="mt-12 scroll-mt-20 border-t border-[rgba(20,22,26,0.09)] pt-6"
            >
              <h2 className="text-[20px] font-semibold leading-[26px] tracking-[-0.01em]">
                Shared with you
              </h2>
              {(sharedAlbums?.length ?? 0) === 0 && !showDemoJourneys ? (
                <p className="mt-3 max-w-[62ch] text-[15px] leading-6 text-[#4A4F57]">
                  Journeys others invite you to show up here after you accept
                  from Notifications.
                </p>
              ) : (
                <SharedJourneysGrid
                  sharedAlbums={sharedAlbums ?? []}
                  placeById={placeById}
                  showDemoJourneys={showDemoJourneys}
                  demoFaces={demoFaces}
                  onLeave={setLeaving}
                />
              )}
            </div>
          </>
        )}

        {actionError && (
          <p className="mt-6 text-[14px] text-[#C0362C]">{actionError}</p>
        )}
      </div>

      {showNewAlbum && user && (
        <NewAlbumDialog
          onCancel={() => setShowNewAlbum(false)}
          onCreate={async (name, visibility) => {
            const id = await createAlbum(name, user.uid, visibility);
            setShowNewAlbum(false);
            router.push(`/album/${id}`);
          }}
        />
      )}

      {renaming && (
        <RenameAlbumDialog
          album={renaming}
          onCancel={() => setRenaming(null)}
          onSave={async (name) => {
            setActionError(null);
            try {
              await renameAlbum(renaming.id, name);
              setRenaming(null);
            } catch {
              setActionError("Couldn’t rename that journey.");
              setRenaming(null);
            }
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body="The journey goes away. Places stay in your library and in any other journey that holds them."
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            const album = deleting;
            setDeleting(null);
            setActionError(null);
            try {
              await deleteAlbum(album.id);
            } catch {
              setActionError("Couldn’t delete that journey.");
            }
          }}
        />
      )}

      {leaving && user && (
        <ConfirmDialog
          title={`Leave ${leaving.name}?`}
          body="You’ll lose access until you’re invited again. Places you added stay on the journey."
          confirmLabel="Remove"
          danger
          onCancel={() => setLeaving(null)}
          onConfirm={async () => {
            const album = leaving;
            setLeaving(null);
            setActionError(null);
            try {
              await leaveAlbum(album, user.uid);
            } catch {
              setActionError("Couldn’t leave that journey.");
            }
          }}
        />
      )}
    </main>
  );
}

/**
 * What Atlas looks like before you have an account: every journey someone has
 * made public, on the same shelf a library uses, opening into the same
 * walkable captures. Signing in is offered here rather than demanded — the
 * only things behind it are capturing and keeping, and neither is what a
 * first visit is for.
 */
function PublicLibrary() {
  // An unconfigured Firebase has no shelf to load rather than one still
  // loading, so it starts empty instead of resolving to empty from an effect.
  const [albums, setAlbums] = useState<Album[] | null>(
    isFirebaseConfigured ? null : [],
  );
  const [places, setPlaces] = useState<Place[]>([]);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    return subscribeToPublicAlbums(setAlbums, () => setAlbums([]));
  }, []);

  // Covers are drawn from the captures each journey holds, so the ids are
  // gathered across all of them and fetched once — joined into a string so a
  // fresh snapshot with the same contents doesn't rebuild every listener.
  const placeIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const album of albums ?? []) {
      for (const id of album.placeIds ?? []) ids.add(id);
    }
    return [...ids].sort().join(",");
  }, [albums]);

  useEffect(() => {
    const ids = placeIdsKey ? placeIdsKey.split(",") : [];
    return subscribeToPlacesByIds(ids, setPlaces, () => setPlaces([]));
  }, [placeIdsKey]);

  const placeById = useMemo(
    () => new Map(places.map((place) => [place.id, place])),
    [places],
  );

  const loading = albums === null;
  const count = albums?.length ?? 0;

  return (
    <main className="min-h-screen bg-[#FAF9F7] text-[#14161A]">
      <div className="mx-auto max-w-[1152px] px-8 py-10">
        <div className="flex items-end justify-between gap-8">
          <div className="min-w-0">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6B7178] tabular-nums">
              {loading
                ? "Public journeys"
                : countLabel(count, "public journey", "public journeys")}
            </p>
            <h1 className="font-display text-[44px] font-normal leading-[44px] tracking-[-0.02em]">
              Walk somewhere
            </h1>
            <p className="mt-3 max-w-[52ch] text-[15px] leading-6 text-[#4A4F57]">
              Open any journey below and walk through the places in it. Sign in
              with Google when you want to capture your own or keep a library.
            </p>
          </div>
          <div className="flex flex-none items-center gap-3">
            <Link
              href={signInHref("/")}
              className="flex h-10 items-center rounded-full border border-[rgba(20,22,26,0.14)] bg-white px-[18px] text-[15px] font-medium text-[#14161A] transition-colors duration-150 hover:bg-[rgba(20,22,26,0.04)]"
            >
              Sign In
            </Link>
            <Link
              href={signUpHref("/")}
              className="flex h-10 items-center rounded-full bg-[#14161A] px-[22px] text-[15px] font-medium text-white transition-colors duration-150 hover:bg-[#2A2E35]"
            >
              Sign Up
            </Link>
          </div>
        </div>

        {loading ? (
          <>
            <p className="sr-only" role="status">
              Loading public journeys…
            </p>
            <SkeletonList
              count={8}
              className="mt-8 grid grid-cols-4 gap-x-6 gap-y-7"
              item={() => <AlbumCardSkeleton />}
            />
          </>
        ) : count === 0 ? (
          <p className="mt-10 max-w-[52ch] text-[15px] leading-6 text-[#4A4F57]">
            Nothing is public yet. When someone marks a journey public, it shows
            up here for anyone to walk through.
          </p>
        ) : (
          <ul className="mt-8 grid grid-cols-4 gap-x-6 gap-y-7">
            {(albums ?? []).map((album, index) => (
              <AlbumCard
                key={album.id}
                album={album}
                places={resolveAlbumPlaces(album.placeIds, placeById)}
                index={index}
                // Every journey on this shelf is public, so saying so under
                // each one says nothing.
                showVisibility={false}
              />
            ))}
          </ul>
        )}
      </div>
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
      className="h-4 w-4"
    >
      <path d="M4 7h16M10 4h4M9 7v12M15 7v12M6 7l1 13h10l1-13" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className="h-5 w-5"
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/**
 * 4:3, 16px radius, raised — the one piece of media on this screen.
 *
 * The hover is a 2px lift on a deeper shadow rather than a fade: these are the
 * only cards in the app you pick up and open, and lifting says that where
 * dimming only says the pointer is somewhere.
 */
const COVER_CLASS =
  "absolute inset-0 overflow-hidden rounded-2xl bg-[rgba(20,22,26,0.05)] shadow-[0_1px_2px_rgba(20,22,26,0.06),0_12px_28px_-18px_rgba(20,22,26,0.4)] transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-0.5 group-hover:shadow-[0_2px_4px_rgba(20,22,26,0.07),0_20px_38px_-20px_rgba(20,22,26,0.45)]";

function AlbumCard({
  album,
  places,
  index = 0,
  showVisibility = true,
  onEdit,
  onRemove,
  onDelete,
}: {
  album: Album;
  places: Place[];
  /** Position in its grid, which is all the stagger needs. */
  index?: number;
  /** Off where the whole grid is public and the word would be redundant. */
  showVisibility?: boolean;
  onEdit?: () => void;
  /** Leave a shared journey — labeled Remove to match place tiles. */
  onRemove?: () => void;
  onDelete?: () => void;
}) {
  const items: TileMenuItem[] = [];
  if (onEdit) items.push({ label: "Edit", onClick: onEdit });
  if (onRemove) {
    items.push({
      label: "Remove",
      onClick: onRemove,
      title: "Leave this journey",
    });
  }
  if (onDelete) {
    items.push({
      label: "Delete",
      onClick: onDelete,
      danger: true,
      title: "Delete this journey",
    });
  }

  const placeCount = album.placeIds?.length ?? 0;
  const peopleCount = albumMemberIds(album).length;

  return (
    <li className="rise" style={riseDelay(index)}>
      <div className="group relative">
        {/* Menu sits outside the clipped cover so the dropdown isn’t cut off. */}
        <div className="relative aspect-[4/3]">
          <Link
            href={`/album/${album.id}`}
            className={COVER_CLASS}
            aria-label={album.name}
          >
            <AlbumCover
              coverUrl={album.coverUrl}
              places={places}
              alt={album.name}
            />
            <AlbumCollaborators album={album} />
          </Link>
          <TileMenu items={items} />
        </div>
        <Link href={`/album/${album.id}`} className="mt-3 block">
          <p className="truncate font-display text-[19px] font-normal leading-6 tracking-[-0.01em]">
            {album.name}
          </p>
          <p className="mt-0.5 truncate text-[13px] leading-[18px] text-[#6B7178] tabular-nums">
            {countLabel(placeCount, "place", "places")}
            {peopleCount > 1
              ? ` · ${countLabel(peopleCount, "person", "people")}`
              : ""}
            {showVisibility && albumVisibility(album) === "public"
              ? " · Public"
              : ""}
          </p>
        </Link>
      </div>
    </li>
  );
}

/**
 * Shared section order: real SummerHacks2026 first, then the demo bishop
 * allen card, then everything else.
 */
function SharedJourneysGrid({
  sharedAlbums,
  placeById,
  showDemoJourneys,
  demoFaces,
  onLeave,
}: {
  sharedAlbums: Album[];
  placeById: Map<string, Place>;
  showDemoJourneys: boolean;
  demoFaces: Profile[];
  onLeave: (album: Album) => void;
}) {
  const pinned = sharedAlbums.filter((album) =>
    isPinnedBeforeDemoShared(album.name),
  );
  const rest = sharedAlbums.filter(
    (album) => !isPinnedBeforeDemoShared(album.name),
  );

  // Three lists painted into one grid, so the stagger has to be counted across
  // all of them — each section picking up where the last left off.
  const demoCount = showDemoJourneys ? DEMO_SHARED_JOURNEYS.length : 0;

  return (
    <ul className="mt-5 grid grid-cols-4 gap-x-6 gap-y-7">
      {pinned.map((album, index) => (
        <AlbumCard
          key={album.id}
          album={album}
          places={resolveAlbumPlaces(album.placeIds, placeById)}
          index={index}
          onRemove={() => onLeave(album)}
        />
      ))}
      {showDemoJourneys &&
        DEMO_SHARED_JOURNEYS.map((journey, index) => (
          <DemoJourneyCard
            key={journey.id}
            journey={journey}
            faces={demoFaces}
            index={pinned.length + index}
          />
        ))}
      {rest.map((album, index) => (
        <AlbumCard
          key={album.id}
          album={album}
          places={resolveAlbumPlaces(album.placeIds, placeById)}
          index={pinned.length + demoCount + index}
          onRemove={() => onLeave(album)}
        />
      ))}
    </ul>
  );
}

/**
 * Pitch journeys with a still cover and a fixed place count — not linked into
 * a real album. The shared one also wears real collaborator faces from
 * Firestore so the stack looks like the rest of the library.
 */
function DemoJourneyCard({
  journey,
  faces = [],
  index = 0,
}: {
  journey: DemoJourney;
  faces?: Profile[];
  /** Position in its grid, which is all the stagger needs. */
  index?: number;
}) {
  const peopleCount = journey.shared?.peopleCount ?? 0;

  return (
    <li className="rise" style={riseDelay(index)}>
      <div className="group relative">
        <div className="relative aspect-[4/3]">
          <div className={COVER_CLASS} aria-label={journey.name}>
            <AlbumCover coverUrl={journey.coverUrl} places={[]} alt={journey.name} />
            {journey.shared && faces.length > 0 && (
              <DemoCollaboratorFaces
                faces={faces}
                peopleCount={journey.shared.peopleCount}
              />
            )}
          </div>
        </div>
        <div className="mt-3 block">
          <p className="truncate font-display text-[19px] font-normal leading-6 tracking-[-0.01em]">
            {journey.name}
          </p>
          <p className="mt-0.5 truncate text-[13px] leading-[18px] text-[#6B7178] tabular-nums">
            {countLabel(journey.placeCount, "place", "places")}
            {peopleCount > 1
              ? ` · ${countLabel(peopleCount, "person", "people")}`
              : ""}
          </p>
        </div>
      </div>
    </li>
  );
}

function DemoCollaboratorFaces({
  faces,
  peopleCount,
}: {
  faces: Profile[];
  peopleCount: number;
}) {
  const shown = faces.slice(0, 3);
  const extra = Math.max(0, peopleCount - shown.length);
  if (shown.length === 0) return null;

  return (
    <div className="pointer-events-none absolute bottom-3.5 left-4 flex items-center">
      <div className="flex flex-row-reverse">
        {extra > 0 && (
          <span className="relative z-0 -ml-[7px] flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[rgba(20,22,26,0.72)] text-[10px] font-semibold tabular-nums text-white shadow-[0_0_0_2px_#FAF9F7]">
            +{extra}
          </span>
        )}
        {[...shown].reverse().map((profile, index) => (
          <span
            key={profile.id}
            title={`@${profile.username}`}
            className="relative -ml-[7px] first:ml-0 rounded-full shadow-[0_0_0_2px_#FAF9F7]"
            style={{ zIndex: shown.length - index }}
          >
            <Avatar
              profile={profile}
              className="h-[22px] w-[22px]"
              textClassName="text-[10px]"
            />
          </span>
        ))}
      </div>
    </div>
  );
}

function RecentsCard({ places }: { places: Place[] }) {
  return (
    <li className="rise" style={riseDelay(0)}>
      <Link href="/album/recents" className="group block">
        <div className="relative aspect-[4/3]">
          <div className={COVER_CLASS}>
            <AlbumCover places={places} alt="Recents" />
          </div>
          <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-full bg-[rgba(250,249,247,0.92)] px-2.5 py-1 text-[10px] font-semibold uppercase leading-none tracking-[0.1em] text-[#14161A]">
            Recents
          </span>
        </div>
        <p className="mt-3 truncate font-display text-[19px] font-normal leading-6 tracking-[-0.01em]">
          Everything
        </p>
        <p className="mt-0.5 truncate text-[13px] leading-[18px] text-[#6B7178] tabular-nums">
          {countLabel(places.length, "place", "places")} · newest first
        </p>
      </Link>
    </li>
  );
}

function NewJourneyCard({ onClick }: { onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="press flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[rgba(20,22,26,0.18)] bg-[rgba(20,22,26,0.02)] text-[#6B7178] transition-colors duration-200 hover:border-[rgba(20,22,26,0.28)] hover:bg-[rgba(20,22,26,0.035)] hover:text-[#4A4F57]"
      >
        <PlusGlyph />
        <span className="text-[13px] font-medium text-[#4A4F57]">
          New journey
        </span>
      </button>
    </li>
  );
}

const DIALOG_SCRIM =
  "dialog-scrim fixed inset-0 z-50 flex items-center justify-center bg-[rgba(20,22,26,0.35)] p-6";
const DIALOG_PANEL =
  "dialog-panel w-full max-w-[380px] rounded-2xl bg-white p-6 shadow-[0_24px_60px_-30px_rgba(20,22,26,0.5)]";
const DIALOG_TITLE =
  "font-display text-[22px] font-normal leading-7 tracking-[-0.01em]";
const DIALOG_BODY = "mt-2 text-[14px] leading-5 text-[#4A4F57]";
const DIALOG_INPUT =
  "mt-4 w-full rounded-xl border border-[rgba(20,22,26,0.12)] bg-white px-3.5 py-2.5 text-[15px] text-[#14161A] outline-none transition-colors duration-150 placeholder:text-[#8A9098] focus:border-[#0071E3]";
const DIALOG_CANCEL =
  "rounded-full px-4 py-2 text-[14px] font-medium text-[#4A4F57] transition-colors duration-150 hover:bg-[rgba(20,22,26,0.05)] disabled:opacity-40";
const DIALOG_CONFIRM =
  "rounded-full px-4 py-2 text-[14px] font-medium text-white transition-opacity duration-150 disabled:opacity-40";

function NewAlbumDialog({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (name: string, visibility: AlbumVisibility) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<AlbumVisibility>("private");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    await onCreate(name.trim(), visibility);
  }

  return (
    <div className={DIALOG_SCRIM}>
      <div className={DIALOG_PANEL}>
        <h3 className={DIALOG_TITLE}>New Journey</h3>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="Title"
          className={DIALOG_INPUT}
        />
        <div className="mt-4 flex items-center gap-0.5 rounded-full bg-[rgba(20,22,26,0.05)] p-[3px]">
          <button
            type="button"
            aria-pressed={visibility === "private"}
            onClick={() => setVisibility("private")}
            className={`flex-1 rounded-full px-4 py-1.5 text-[13px] transition-colors duration-150 ${
              visibility === "private"
                ? "bg-white font-medium text-[#14161A] shadow-[0_1px_2px_rgba(20,22,26,0.06)]"
                : "text-[#4A4F57] hover:text-[#14161A]"
            }`}
          >
            Private
          </button>
          <button
            type="button"
            aria-pressed={visibility === "public"}
            onClick={() => setVisibility("public")}
            className={`flex-1 rounded-full px-4 py-1.5 text-[13px] transition-colors duration-150 ${
              visibility === "public"
                ? "bg-white font-medium text-[#14161A] shadow-[0_1px_2px_rgba(20,22,26,0.06)]"
                : "text-[#4A4F57] hover:text-[#14161A]"
            }`}
          >
            Public
          </button>
        </div>
        <p className="mt-2 text-[13px] leading-[18px] text-[#6B7178]">
          {visibility === "private"
            ? "Only you and people you invite can see and contribute."
            : "Anyone who opens your profile can view it. Only invitees can contribute."}
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onCancel} className={DIALOG_CANCEL}>
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!name.trim() || saving}
            className={`${DIALOG_CONFIRM} bg-[#14161A]`}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RenameAlbumDialog({
  album,
  onCancel,
  onSave,
}: {
  album: Album;
  onCancel: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(album.name);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true);
    await onSave(name.trim());
  }

  return (
    <div className={DIALOG_SCRIM}>
      <div className={DIALOG_PANEL}>
        <h3 className={DIALOG_TITLE}>Edit Journey</h3>
        <p className={DIALOG_BODY}>Change the name of this journey.</p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="Title"
          className={DIALOG_INPUT}
        />
        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onCancel} className={DIALOG_CANCEL}>
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!name.trim() || saving}
            className={`${DIALOG_CONFIRM} bg-[#14161A]`}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <div className={DIALOG_SCRIM}>
      <div className={`${DIALOG_PANEL} max-w-[420px]`}>
        <h2 className={DIALOG_TITLE}>{title}</h2>
        <p className={DIALOG_BODY}>{body}</p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className={DIALOG_CANCEL}>
            Cancel
          </button>
          <button
            onClick={async () => {
              setBusy(true);
              await onConfirm();
            }}
            disabled={busy}
            className={`${DIALOG_CONFIRM} ${
              danger ? "bg-[#C0362C]" : "bg-[#14161A]"
            }`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
