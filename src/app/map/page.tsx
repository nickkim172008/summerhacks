"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuthProfile } from "@/lib/auth";

const PlacesMap = dynamic(() => import("@/components/PlacesMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-neutral-500">
      Loading map…
    </div>
  ),
});
import TimelineBar from "@/components/TimelineBar";
import AlbumTourButton from "@/components/AlbumTourButton";
import { TourIntroVeil, useTourIntro } from "@/components/TourIntro";
import { subscribeToAlbumsByOwner } from "@/lib/albums";
import { isFirebaseConfigured } from "@/lib/firebase";
import { useLiveLocation } from "@/lib/geolocation";
import { useResolvedPlaces, type LocatedPlace } from "@/lib/geocode";
import { subscribeToPlaces, subscribeToPlacesByUploader } from "@/lib/places";
import { useCaptureTimeline } from "@/lib/timelinePlayback";
import type { Album, Place } from "@/lib/types";

type Scope =
  | { kind: "public" }
  | { kind: "personal" }
  | { kind: "album"; albumId: string };

const NO_ALBUMS: Album[] = [];
const PUBLIC_SCOPE: Scope = { kind: "public" };

// useSearchParams needs a boundary to suspend at, and a walkthrough's opening
// is named entirely in the query string.
export default function MapPage() {
  return (
    <Suspense fallback={null}>
      <MapView />
    </Suspense>
  );
}

function MapView() {
  const router = useRouter();
  const search = useSearchParams();
  const { user, loading: authLoading, needsUsername } = useAuthProfile();
  const [allPlaces, setAllPlaces] = useState<Place[] | null>(
    isFirebaseConfigured ? null : [],
  );
  const [ownedAlbums, setOwnedAlbums] = useState<Album[]>([]);
  // Null until something is picked, so a scope named in the URL can stand in
  // without a chosen one ever being overwritten by it.
  const [chosenScope, setScope] = useState<Scope | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [libraryDenied, setLibraryDenied] = useState(false);
  const {
    location: liveLocation,
    error: liveError,
    loading: liveLoading,
  } = useLiveLocation();

  useEffect(() => {
    if (!authLoading && needsUsername) router.replace("/setup");
  }, [authLoading, needsUsername, router]);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    // Public is every environment. Rules may refuse a library-wide read, which
    // the next effect answers by narrowing to this account's own captures.
    return subscribeToPlaces(setAllPlaces, () => setLibraryDenied(true));
  }, []);

  useEffect(() => {
    if (!libraryDenied || !user) return;
    return subscribeToPlacesByUploader(user.uid, setAllPlaces);
  }, [libraryDenied, user]);

  useEffect(() => {
    if (!isFirebaseConfigured || !user) return;
    return subscribeToAlbumsByOwner(user.uid, setOwnedAlbums);
  }, [user]);

  // Gated on the signed-in user rather than cleared on sign-out, so the last
  // account's albums can never linger.
  const albums = user ? ownedAlbums : NO_ALBUMS;

  // A walkthrough link names its album in the query, and the album is the scope
  // it opens on. Memoised because inScope is derived from this: a fresh object
  // every render would rebuild the place list every render.
  const urlAlbumId = search.get("album");
  // Personal and album scopes need a signed-in user, so signing out mid-session
  // falls back rather than leaving the map showing a scope it cannot resolve.
  const scope = useMemo((): Scope => {
    if (!user) return PUBLIC_SCOPE;
    if (chosenScope) return chosenScope;
    return urlAlbumId ? { kind: "album", albumId: urlAlbumId } : PUBLIC_SCOPE;
  }, [user, chosenScope, urlAlbumId]);

  // Which places the chosen scope covers. Personal is every album's contents
  // taken together, so it is the union of the album views rather than a
  // separate idea of ownership.
  const inScope = useMemo((): Place[] => {
    const places = allPlaces ?? [];
    // Public is every real capture and nothing else. It was once padded with
    // invented city pins so a young map read as busy; a map that lies about
    // where people have been is worth less than a sparse one that does not.
    if (scope.kind === "public") return places;
    if (!user) return [];

    const byId = new Map(places.map((place) => [place.id, place]));
    const collect = (ids: string[]) =>
      ids.map((id) => byId.get(id)).filter((p): p is Place => Boolean(p));

    if (scope.kind === "personal") {
      const everyAlbumsPlaces = collect(
        albums.flatMap((album) => album.placeIds ?? []),
      );
      // Dedupe: one place can sit in several albums.
      return [...new Map(everyAlbumsPlaces.map((p) => [p.id, p])).values()];
    }

    const album = albums.find((a) => a.id === scope.albumId);
    return album ? collect(album.placeIds ?? []) : [];
  }, [allPlaces, albums, scope, user]);

  const { located, pending, byName, unplaceable } = useResolvedPlaces(inScope);

  // Derived from the live array every render, never snapshotted: a capture
  // saved while the bar is open has to widen the axis and grow a tick on its
  // own.
  const timeline = useCaptureTimeline(inScope, timelineOpen);

  const tourIntro = useTourIntro({
    albumId: search.get("tour") === "1" ? urlAlbumId : null,
    places: inScope,
    from: search.get("from"),
  });

  // The bar is data, the tour is an experience, and while a tour flies in they
  // would be fighting over the same map. Derived rather than dismissed from an
  // effect, so the frame the intro starts on already shows every point.
  const showTimeline = timelineOpen && !tourIntro.active;

  // The animation is a filter over what the map already had. PlacesMap keeps
  // its own idea of framing, so the map stays fitted to the whole scope while
  // the points inside it arrive one at a time.
  const mapPlaces = useMemo(
    () =>
      showTimeline
        ? located.filter((place) => !timeline.hiddenIds.has(place.id))
        : located,
    [located, timeline.hiddenIds, showTimeline],
  );

  const heatWeightOf = useCallback(
    (place: LocatedPlace) => timeline.weights[place.id] ?? 1,
    [timeline.weights],
  );

  // Also the hook for dismissing the bar from elsewhere on this page, since it
  // parks the playhead as well as hiding the track.
  function closeTimeline() {
    timeline.reset();
    setTimelineOpen(false);
  }

  // At most one thing to say, and only for a moment: an empty scope is worth a
  // word, but not a banner sitting over the map for as long as it stays empty.
  const notice =
    located.length === 0 && pending === 0
      ? inScope.length === 0
        ? "No environments in this scope yet."
        : `None of these ${inScope.length} environments say where they were filmed.`
      : liveError
        ? "Location off — allow GPS to show where you are"
        : liveLoading
          ? "Finding your live location…"
          : null;
  const noticeVisible = useTransientNotice(notice);

  const scopeLabel =
    scope.kind === "public"
      ? "Everyone"
      : scope.kind === "personal"
        ? "Yours"
        : (albums.find((a) => a.id === scope.albumId)?.name ?? "Album");

  const locationHint = liveLoading
    ? "Finding you…"
    : liveError
      ? "Location off"
      : liveLocation
        ? "Location on"
        : null;

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-white text-[#1d1d1f]">
      <div className="relative flex h-[calc(100dvh-3.25rem)] flex-1">
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute left-4 top-3 z-20 rounded-full bg-white/95 px-3.5 py-2 text-[13px] font-medium text-[#1d1d1f] shadow-md ring-1 ring-black/8 transition hover:bg-white"
          >
            Places
          </button>
        )}

        {sidebarOpen && (
          <aside className="absolute inset-y-0 left-0 z-10 flex w-[min(100%,17.5rem)] flex-col bg-white/92 shadow-[8px_0_32px_rgba(0,0,0,0.06)] backdrop-blur-2xl sm:static sm:shadow-none sm:ring-1 sm:ring-black/6">
            <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
              <div className="min-w-0">
                <p className="text-[17px] font-semibold tracking-tight">
                  Places
                </p>
                <p className="mt-1 text-[12px] leading-snug text-neutral-500">
                  {scopeLabel}
                  <span className="text-neutral-300"> · </span>
                  {located.length} on the map
                  {byName > 0 && ` · ${byName} by name`}
                  {pending > 0 && ` · ${pending} resolving…`}
                  {unplaceable > 0 && ` · ${unplaceable} no location`}
                  {locationHint && (
                    <>
                      <span className="text-neutral-300"> · </span>
                      {locationHint}
                    </>
                  )}
                </p>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                aria-label="Close places panel"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-100 hover:text-[#1d1d1f]"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-6">
              <div className="space-y-1">
                <FilterButton
                  active={scope.kind === "public"}
                  onClick={() => setScope({ kind: "public" })}
                  title="Everyone"
                  subtitle="All geotagged places"
                />
                <FilterButton
                  active={scope.kind === "personal"}
                  onClick={() => {
                    if (!user) {
                      router.push("/signin");
                      return;
                    }
                    setScope({ kind: "personal" });
                  }}
                  title="Yours"
                  subtitle={user ? "Every album combined" : "Sign in to view"}
                />
              </div>

              <div className="mt-6">
                <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-400">
                  Albums
                </p>
                {!user && (
                  <p className="px-2 py-1.5 text-[12px] leading-relaxed text-neutral-500">
                    <Link href="/signin" className="font-medium text-[#0071e3]">
                      Sign in
                    </Link>{" "}
                    to browse by album.
                  </p>
                )}
                {user && albums.length === 0 && (
                  <p className="px-2 py-1.5 text-[12px] leading-relaxed text-neutral-500">
                    No albums yet — make one in Library.
                  </p>
                )}
                <div className="space-y-1">
                  {albums.map((album) => (
                    <div key={album.id} className="flex items-center gap-1">
                      <div className="min-w-0 flex-1">
                        <FilterButton
                          active={
                            scope.kind === "album" && scope.albumId === album.id
                          }
                          onClick={() =>
                            setScope({ kind: "album", albumId: album.id })
                          }
                          title={album.name}
                          subtitle={`${album.placeIds?.length ?? 0} ${
                            (album.placeIds?.length ?? 0) === 1
                              ? "place"
                              : "places"
                          }`}
                        />
                      </div>
                      {(album.placeIds?.length ?? 0) > 0 && (
                        <AlbumTourButton albumId={album.id} name={album.name} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        )}

        <section className="relative min-h-0 min-w-0 flex-1">
          <PlacesMap
            places={mapPlaces}
            liveLocation={liveLocation}
            weightOf={showTimeline ? heatWeightOf : undefined}
            focus={tourIntro.focus}
            className="absolute inset-x-0 top-0 bottom-[calc(3rem+env(safe-area-inset-bottom))]"
          />

          {/* Spelled out rather than left as an icon: a tour button elsewhere
              on this page also plays, and means something else entirely. */}
          <button
            onClick={() =>
              timelineOpen ? closeTimeline() : setTimelineOpen(true)
            }
            aria-pressed={timelineOpen}
            className={`absolute left-3 top-12 z-[2] flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-medium shadow-md ring-1 transition ${
              timelineOpen
                ? "bg-[#0071e3] text-white ring-[#0071e3]/30"
                : "bg-white/95 text-[#1d1d1f] ring-black/8 hover:bg-white"
            }`}
          >
            <ClockIcon />
            Timeline
          </button>

          {notice && !showTimeline && (
            <div
              className="pointer-events-none absolute bottom-20 left-1/2 z-[1] max-w-sm -translate-x-1/2 rounded-full bg-white/95 px-4 py-2 text-center text-[12px] text-neutral-600 shadow-md ring-1 ring-black/10 transition-opacity duration-700"
              style={{ opacity: noticeVisible ? 1 : 0 }}
            >
              {notice}
            </div>
          )}

          {showTimeline && (
            <TimelineBar
              timeline={timeline}
              scopeCount={inScope.length}
              onClose={closeTimeline}
            />
          )}
        </section>
      </div>

      <TourIntroVeil intro={tourIntro} />
    </main>
  );
}

const NOTICE_MS = 4000;

/**
 * True while a notice is worth showing. Each new message restarts the clock;
 * the fade itself is the caller's transition, so the element stays mounted and
 * simply goes transparent.
 */
function useTransientNotice(message: string | null) {
  const [settled, setSettled] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setSettled(message), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  return Boolean(message) && settled !== message;
}

function FilterButton({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-2xl px-3.5 py-3 text-left transition ${
        active
          ? "bg-[#0071e3] text-white shadow-sm shadow-[#0071e3]/25"
          : "text-[#1d1d1f] hover:bg-neutral-100/90"
      }`}
    >
      <p className="text-[14px] font-medium tracking-tight">{title}</p>
      <p
        className={`mt-0.5 text-[12px] leading-snug ${
          active ? "text-white/75" : "text-neutral-500"
        }`}
      >
        {subtitle}
      </p>
    </button>
  );
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="currentColor"
      aria-hidden
    >
      <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm-.75 2.75a.75.75 0 0 1 1.5 0v3.44l2.28 1.32a.75.75 0 1 1-.75 1.3l-2.65-1.53a.75.75 0 0 1-.38-.65V6.25Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="currentColor"
      aria-hidden
    >
      <path d="M5.22 5.22a.75.75 0 0 1 1.06 0L10 8.94l3.72-3.72a.75.75 0 1 1 1.06 1.06L11.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06L10 11.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06L8.94 10 5.22 6.28a.75.75 0 0 1 0-1.06Z" />
    </svg>
  );
}
