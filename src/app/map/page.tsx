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
import { DEMO_MAP_PLACES } from "@/lib/demoMapData";
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
    if (scope.kind === "public") {
      const real = new Set(places.map((place) => place.id));
      return [
        ...places,
        ...DEMO_MAP_PLACES.filter((demo) => !real.has(demo.id)),
      ];
    }
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

  const scopeLabel =
    scope.kind === "public"
      ? "Public"
      : scope.kind === "personal"
        ? "Personal"
        : (albums.find((a) => a.id === scope.albumId)?.name ?? "Album");

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-white text-[#1d1d1f]">
      <div className="relative flex min-h-[calc(100dvh-8.5rem)] flex-1">
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="absolute right-4 top-3 z-20 rounded-full bg-white/95 px-3 py-1.5 text-[13px] font-medium text-[#0071e3] shadow ring-1 ring-black/10 transition hover:bg-white"
        >
          {sidebarOpen ? "Hide filters" : "Filters"}
        </button>

        {sidebarOpen && (
          <aside className="absolute inset-y-0 left-0 z-10 flex w-[min(100%,18rem)] flex-col border-r border-black/10 bg-white/95 shadow-xl backdrop-blur-xl sm:static sm:shadow-none">
            <div className="border-b border-black/5 px-4 py-3">
              <p className="text-[13px] font-semibold">Heatmap scope</p>
              <p className="mt-0.5 text-[12px] text-neutral-500">
                {scopeLabel}
                {` · ${located.length} on the map`}
                {byName > 0 && ` · ${byName} placed by name`}
                {pending > 0 && ` · ${pending} resolving…`}
                {unplaceable > 0 && ` · ${unplaceable} without a location`}
                {liveLoading && " · locating…"}
                {liveError && " · location off"}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              <FilterButton
                active={scope.kind === "public"}
                onClick={() => setScope({ kind: "public" })}
                title="Public"
                subtitle="Everyone\u2019s captures, plus sample spots"
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
                title="Personal"
                subtitle={user ? "Every album combined" : "Sign in required"}
              />

              <p className="mb-1 mt-4 px-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                Albums
              </p>
              {!user && (
                <p className="px-2 py-2 text-[12px] text-neutral-500">
                  <Link href="/signin" className="text-[#0071e3]">
                    Sign in
                  </Link>{" "}
                  or{" "}
                  <Link href="/signup" className="text-[#0071e3]">
                    sign up
                  </Link>{" "}
                  to filter by your albums.
                </p>
              )}
              {user && albums.length === 0 && (
                <p className="px-2 py-2 text-[12px] text-neutral-500">
                  No albums yet. Create one in Library.
                </p>
              )}
              {albums.map((album) => (
                <FilterButton
                  key={album.id}
                  active={scope.kind === "album" && scope.albumId === album.id}
                  onClick={() => setScope({ kind: "album", albumId: album.id })}
                  title={album.name}
                  subtitle={`${album.placeIds?.length ?? 0} environments`}
                />
              ))}
            </div>
          </aside>
        )}

        <section className="relative min-h-0 min-w-0 flex-1 pb-16">
          <PlacesMap
            places={located}
            liveLocation={liveLocation}
            className="absolute inset-0"
          />
          {located.length === 0 && pending === 0 && (
            <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center px-6">
              <p className="max-w-xs rounded-2xl bg-white/95 px-4 py-3 text-center text-[13px] text-neutral-600 shadow-md ring-1 ring-black/10">
                {inScope.length === 0
                  ? "No environments in this scope yet."
                  : `None of these ${inScope.length} environments say where they were filmed. Add a location when you capture one.`}
              </p>
            </div>
          )}
          {(liveLoading || liveError) && (
            <div className="pointer-events-none absolute bottom-20 left-1/2 z-[1] max-w-sm -translate-x-1/2 rounded-full bg-white/95 px-4 py-2 text-center text-[12px] text-neutral-600 shadow-md ring-1 ring-black/10">
              {liveError
                ? "Location off — allow GPS to show where you are"
                : "Finding your live location…"}
            </div>
          )}
        </section>
      </div>
    </main>
  );
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
      className={`mb-1 w-full rounded-xl px-3 py-2.5 text-left transition ${
        active
          ? "bg-[#0071e3] text-white"
          : "text-[#1d1d1f] hover:bg-neutral-100"
      }`}
    >
      <p className="text-[14px] font-medium">{title}</p>
      <p
        className={`text-[12px] ${active ? "text-white/80" : "text-neutral-500"}`}
      >
        {subtitle}
      </p>
    </button>
  );
}
