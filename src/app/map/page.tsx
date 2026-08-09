"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { subscribeToAlbumsByOwner } from "@/lib/albums";
import { isFirebaseConfigured } from "@/lib/firebase";
import { useLiveLocation } from "@/lib/geolocation";
import { useResolvedPlaces } from "@/lib/geocode";
import { subscribeToPlaces, subscribeToPlacesByUploader } from "@/lib/places";
import type { Album, Place } from "@/lib/types";

type Scope =
  | { kind: "public" }
  | { kind: "personal" }
  | { kind: "album"; albumId: string };

const NO_ALBUMS: Album[] = [];
const PUBLIC_SCOPE: Scope = { kind: "public" };

export default function MapPage() {
  const router = useRouter();
  const { user, loading: authLoading, needsUsername } = useAuthProfile();
  const [allPlaces, setAllPlaces] = useState<Place[] | null>(
    isFirebaseConfigured ? null : [],
  );
  const [ownedAlbums, setOwnedAlbums] = useState<Album[]>([]);
  const [requestedScope, setScope] = useState<Scope>(PUBLIC_SCOPE);
  const [sidebarOpen, setSidebarOpen] = useState(true);
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

  // Personal and album scopes need a signed-in user, so signing out mid-session
  // falls back rather than leaving the map showing a scope it cannot resolve.
  const scope = user ? requestedScope : PUBLIC_SCOPE;

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
      <div className="relative flex min-h-[calc(100dvh-8.5rem)] flex-1">
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
                  subtitle={
                    user ? "Every album combined" : "Sign in to view"
                  }
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
                    <FilterButton
                      key={album.id}
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
                  ))}
                </div>
              </div>
            </div>
          </aside>
        )}

        <section className="relative min-h-0 min-w-0 flex-1 pb-16">
          <PlacesMap
            places={located}
            liveLocation={liveLocation}
            className="absolute inset-0"
          />
          {notice && (
            <div
              className="pointer-events-none absolute bottom-20 left-1/2 z-[1] max-w-sm -translate-x-1/2 rounded-full bg-white/95 px-4 py-2 text-center text-[12px] text-neutral-600 shadow-md ring-1 ring-black/10 transition-opacity duration-700"
              style={{ opacity: noticeVisible ? 1 : 0 }}
            >
              {notice}
            </div>
          )}
        </section>
      </div>
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

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M5.22 5.22a.75.75 0 0 1 1.06 0L10 8.94l3.72-3.72a.75.75 0 1 1 1.06 1.06L11.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06L10 11.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06L8.94 10 5.22 6.28a.75.75 0 0 1 0-1.06Z" />
    </svg>
  );
}
