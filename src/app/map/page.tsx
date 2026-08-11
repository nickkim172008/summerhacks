"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuthProfile } from "@/lib/auth";

const PlacesMap = dynamic(() => import("@/components/PlacesMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-[#FAF9F7] text-[15px] text-[#6B7178]">
      Loading map…
    </div>
  ),
});
import TimelineBar from "@/components/TimelineBar";
import AlbumTourButton from "@/components/AlbumTourButton";
import { TourIntroVeil, useTourIntro } from "@/components/TourIntro";
import { subscribeToAlbum, subscribeToEditableAlbums } from "@/lib/albums";
import { isFirebaseConfigured } from "@/lib/firebase";
import { useLiveLocation } from "@/lib/geolocation";
import { useResolvedPlaces, type LocatedPlace } from "@/lib/geocode";
import { signInHref } from "@/lib/returnTo";
import { subscribeToPlaces, subscribeToPlacesByUploader } from "@/lib/places";
import { useCaptureTimeline } from "@/lib/timelinePlayback";
import type { Album, Place } from "@/lib/types";

type Scope =
  | { kind: "public" }
  | { kind: "personal" }
  /**
   * Several albums at once, layered on the same map. Empty means exactly that:
   * an album turned off stops contributing, and turning the last one off leaves
   * nothing rather than quietly falling back to everything.
   */
  | { kind: "albums"; ids: string[] };

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
  const [myAlbums, setMyAlbums] = useState<Album[]>([]);
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
    // Owned and shared together: an album someone put you on is one of yours
    // for every purpose the map has.
    return subscribeToEditableAlbums(user.uid, setMyAlbums);
  }, [user]);

  // Gated on the signed-in user rather than cleared on sign-out, so the last
  // account's albums can never linger.
  const albums = user ? myAlbums : NO_ALBUMS;

  // A walkthrough link names its album in the query, and the album is the scope
  // it opens on. Memoised because inScope is derived from this: a fresh object
  // every render would rebuild the place list every render.
  const urlAlbumId = search.get("album");

  /**
   * The journey a link names need not be one of yours: a public one opened from
   * the feed, or by someone who has not signed in at all. Fetched on its own and
   * laid beside the editable ones, so the flight that opens a walkthrough
   * departs from that journey's earliest capture rather than from everything on
   * the map. Rules refuse the private ones, which arrives as null.
   */
  const [fetchedAlbum, setFetchedAlbum] = useState<Album | null>(null);
  useEffect(() => {
    if (!isFirebaseConfigured || !urlAlbumId) return;
    return subscribeToAlbum(urlAlbumId, setFetchedAlbum, () =>
      setFetchedAlbum(null),
    );
  }, [urlAlbumId]);
  // Tagged by id rather than cleared on the way out, so a stale album can never
  // stand in for the one now named in the URL.
  const namedAlbum =
    fetchedAlbum && fetchedAlbum.id === urlAlbumId ? fetchedAlbum : null;

  // What a scope may resolve against: your own journeys, plus the one the URL
  // named if it is not already among them.
  const scopeAlbums = useMemo(() => {
    if (!namedAlbum) return albums;
    if (albums.some((album) => album.id === namedAlbum.id)) return albums;
    return [...albums, namedAlbum];
  }, [albums, namedAlbum]);

  const scope = useMemo((): Scope => {
    // Yours is the one scope that cannot survive signing out mid-session, so it
    // falls back rather than leaving the map showing a scope it cannot resolve.
    if (chosenScope) {
      return chosenScope.kind === "personal" && !user
        ? PUBLIC_SCOPE
        : chosenScope;
    }
    return urlAlbumId ? { kind: "albums", ids: [urlAlbumId] } : PUBLIC_SCOPE;
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

    const byId = new Map(places.map((place) => [place.id, place]));
    const collect = (ids: string[]) =>
      ids.map((id) => byId.get(id)).filter((p): p is Place => Boolean(p));

    if (scope.kind === "personal") {
      if (!user) return [];
      const everyAlbumsPlaces = collect(
        albums.flatMap((album) => album.placeIds ?? []),
      );
      // Dedupe: one place can sit in several albums.
      return [...new Map(everyAlbumsPlaces.map((p) => [p.id, p])).values()];
    }

    // Resolved against scopeAlbums rather than your own: a public journey
    // opened from a link is a scope anyone may hold, signed in or not.
    const chosen = scopeAlbums.filter((album) => scope.ids.includes(album.id));
    const across = collect(chosen.flatMap((album) => album.placeIds ?? []));
    // Dedupe: one place can sit in several of the albums turned on.
    return [...new Map(across.map((p) => [p.id, p])).values()];
  }, [allPlaces, albums, scopeAlbums, scope, user]);

  const { located, pending } = useResolvedPlaces(inScope);

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
  /**
   * Albums layer rather than replace one another, so this adds and removes
   * rather than setting. Coming from Everyone or Yours the click means "just
   * this one" — those are a different question, and keeping them lit beside a
   * chosen album would say the map was showing both.
   */
  function toggleAlbum(albumId: string) {
    setScope((current) => {
      if (!current || current.kind !== "albums") {
        return { kind: "albums", ids: [albumId] };
      }
      return current.ids.includes(albumId)
        ? { kind: "albums", ids: current.ids.filter((id) => id !== albumId) }
        : { kind: "albums", ids: [...current.ids, albumId] };
    });
  }

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
        ? "No places in this scope yet."
        : `None of these ${inScope.length} places say where they were filmed.`
      : liveError
        ? "Location off. Allow GPS to show where you are."
        : liveLoading
          ? "Finding your live location…"
          : null;
  const noticeVisible = useTransientNotice(notice);

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-[#FAF9F7] text-[#14161A]">
      {/* One 64px bar above, and nothing below it any more. */}
      <div className="relative flex h-[calc(100dvh-4rem)] flex-1">
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute left-4 top-3 z-20 h-9 rounded-full border border-[rgba(20,22,26,0.14)] bg-[rgba(255,255,255,0.92)] px-4 text-[14px] font-medium text-[#14161A] shadow-[0_1px_2px_rgba(20,22,26,0.06)] backdrop-blur transition hover:bg-white"
          >
            Places
          </button>
        )}

        {sidebarOpen && (
          <aside className="absolute inset-y-0 left-0 z-10 flex w-[min(100%,17.5rem)] flex-col bg-[rgba(255,255,255,0.92)] shadow-[8px_0_32px_rgba(20,22,26,0.06)] backdrop-blur-2xl sm:static sm:border-r sm:border-[rgba(20,22,26,0.09)] sm:shadow-none">
            <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
              <p className="min-w-0 text-[20px] font-semibold leading-[26px] tracking-[-0.01em]">
                Places
              </p>
              <button
                onClick={() => setSidebarOpen(false)}
                aria-label="Close places panel"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#6B7178] transition hover:bg-[rgba(20,22,26,0.05)] hover:text-[#14161A]"
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
                      router.push(signInHref("/map"));
                      return;
                    }
                    setScope({ kind: "personal" });
                  }}
                  title="Yours"
                  subtitle={
                    user ? "Your journeys and shared ones" : "Sign in to view"
                  }
                />
              </div>

              <div className="mt-6">
                <p className="mb-2 px-2 text-[11px] font-semibold uppercase leading-3 tracking-[0.12em] text-[#6B7178]">
                  Journeys
                </p>
                {!user && (
                  <p className="px-2 py-1.5 text-[13px] leading-[18px] text-[#6B7178]">
                    <Link
                      href={signInHref("/map")}
                      className="font-medium text-[#14161A] transition hover:text-[#4A4F57]"
                    >
                      Sign in
                    </Link>{" "}
                    to browse by journey.
                  </p>
                )}
                {user && albums.length === 0 && (
                  <p className="px-2 py-1.5 text-[13px] leading-[18px] text-[#6B7178]">
                    No journeys yet. Make one in Library.
                  </p>
                )}
                <div className="space-y-1">
                  {albums.map((album) => (
                    <div key={album.id} className="flex items-center gap-1">
                      <div className="min-w-0 flex-1">
                        <FilterButton
                          toggle
                          active={
                            scope.kind === "albums" &&
                            scope.ids.includes(album.id)
                          }
                          onClick={() => toggleAlbum(album.id)}
                          title={album.name}
                          subtitle={albumSubtitle(album, user?.uid)}
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
            className="absolute inset-0"
          />

          {/* Spelled out rather than left as an icon: a tour button elsewhere
              on this page also plays, and means something else entirely. */}
          <button
            onClick={() =>
              timelineOpen ? closeTimeline() : setTimelineOpen(true)
            }
            aria-pressed={timelineOpen}
            className={`absolute left-3 top-14 z-[2] flex h-9 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium shadow-[0_1px_2px_rgba(20,22,26,0.06)] ring-1 backdrop-blur transition ${
              timelineOpen
                ? "bg-[#14161A] text-white ring-[#14161A]"
                : "bg-[rgba(255,255,255,0.92)] text-[#14161A] ring-[rgba(20,22,26,0.14)] hover:bg-white"
            }`}
          >
            <ClockIcon />
            Timeline
          </button>

          {notice && !showTimeline && (
            <div
              className="pointer-events-none absolute bottom-10 left-1/2 z-[1] max-w-sm -translate-x-1/2 rounded-full bg-[rgba(255,255,255,0.92)] px-4 py-2 text-center text-[13px] leading-[18px] text-[#4A4F57] shadow-[0_1px_2px_rgba(20,22,26,0.06)] ring-1 ring-[rgba(20,22,26,0.09)] backdrop-blur transition-opacity duration-700"
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

/**
 * A row in the filter list. Unselected it used to be bare text on white, which
 * read as a label rather than something to press — so every row carries a
 * border and a control on it, lit or not.
 *
 * `toggle` says which control: albums layer, several at a time, and get a
 * checkbox and aria-pressed. Everyone and Yours answer a different question and
 * are one-of, so they get a radio dot.
 */
function FilterButton({
  active,
  onClick,
  title,
  subtitle,
  toggle = false,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  toggle?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition ${
        active
          ? "border-[#14161A] bg-[#14161A] text-white"
          : "border-[rgba(20,22,26,0.09)] bg-white text-[#14161A] hover:border-[rgba(20,22,26,0.14)] hover:bg-[rgba(20,22,26,0.03)]"
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border transition ${
          toggle ? "rounded-[5px]" : "rounded-full"
        } ${
          active
            ? "border-white bg-white text-[#14161A]"
            : "border-[rgba(20,22,26,0.25)] bg-white"
        }`}
      >
        {active &&
          (toggle ? (
            <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
              <path
                d="M2.5 6.2 4.8 8.5 9.5 3.8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <span className="h-2 w-2 rounded-full bg-[#14161A]" />
          ))}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium">{title}</span>
        <span
          className={`mt-0.5 block text-[13px] leading-[18px] ${
            active ? "text-white/75" : "text-[#6B7178]"
          }`}
        >
          {subtitle}
        </span>
      </span>
    </button>
  );
}

/** Whose album it is matters here: a shared one is yours to see, not to own. */
function albumSubtitle(album: Album, uid: string | undefined) {
  const count = album.placeIds?.length ?? 0;
  const places = `${count} ${count === 1 ? "place" : "places"}`;
  return album.ownerId === uid ? places : `${places} · Shared with you`;
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
