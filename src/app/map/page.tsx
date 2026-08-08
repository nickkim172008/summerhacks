"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import AppTabs from "@/components/AppTabs";
import { useAuthProfile } from "@/lib/auth";

const PlacesMap = dynamic(() => import("@/components/PlacesMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-neutral-500">
      Loading map…
    </div>
  ),
});
import { subscribeToAlbums, subscribeToAlbumsByOwner } from "@/lib/albums";
import { isFirebaseConfigured } from "@/lib/firebase";
import { useLiveLocation } from "@/lib/geolocation";
import {
  DEMO_MAP_PLACES,
  DEMO_PERSONAL_PLACE_IDS,
} from "@/lib/demoMapData";
import { placesWithLocation } from "@/lib/maps";
import { subscribeToPlaces } from "@/lib/places";
import type { Album, Place } from "@/lib/types";

type LocatedPlace = Place & { location: { lat: number; lng: number } };

type Scope =
  | { kind: "public" }
  | { kind: "personal" }
  | { kind: "album"; albumId: string };

export default function MapPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading, needsUsername } =
    useAuthProfile();
  const [allPlaces, setAllPlaces] = useState<Place[] | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [scope, setScope] = useState<Scope>({ kind: "public" });
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
    return subscribeToPlaces(setAllPlaces);
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    if (user) {
      return subscribeToAlbumsByOwner(user.uid, setAlbums);
    }
    return subscribeToAlbums(setAlbums);
  }, [user]);

  // Personal requires sign-in; fall back if they sign out mid-session.
  useEffect(() => {
    if (!user && (scope.kind === "personal" || scope.kind === "album")) {
      setScope({ kind: "public" });
    }
  }, [user, scope.kind]);

  const filtered = useMemo((): LocatedPlace[] => {
    const real = placesWithLocation(allPlaces ?? []);
    // Seed Toronto demo points so the heatmap isn't empty before real users.
    const publicPool = mergePlaces(real, placesWithLocation(DEMO_MAP_PLACES));

    if (scope.kind === "public") return publicPool;
    if (!user) return [];
    if (scope.kind === "personal") {
      const mine = real.filter((p) => p.uploaderId === user.uid);
      const demoPersonal = placesWithLocation(DEMO_MAP_PLACES).filter((p) =>
        DEMO_PERSONAL_PLACE_IDS.has(p.id),
      );
      return mergePlaces(mine, demoPersonal);
    }
    const album = albums.find((a) => a.id === scope.albumId);
    if (!album) return [];
    const ids = new Set(album.placeIds ?? []);
    const inAlbum = real.filter((p) => ids.has(p.id));
    // Albums with no geotagged places still show a small demo cluster.
    return inAlbum.length > 0
      ? inAlbum
      : placesWithLocation(DEMO_MAP_PLACES).filter((p) =>
          DEMO_PERSONAL_PLACE_IDS.has(p.id),
        );
  }, [allPlaces, albums, scope, user]);

  const scopeLabel =
    scope.kind === "public"
      ? "Public"
      : scope.kind === "personal"
        ? "Personal"
        : (albums.find((a) => a.id === scope.albumId)?.name ?? "Album");

  return (
    <main className="flex h-screen flex-col bg-white text-[#1d1d1f]">
      <nav className="z-20 flex shrink-0 items-center justify-between border-b border-black/10 bg-white/90 px-4 py-3 backdrop-blur-xl sm:px-6">
        <div>
          <p className="text-sm font-semibold tracking-tight">Map</p>
          <p className="text-xs text-neutral-500">
            {scopeLabel}
            {` · ${filtered.length} spots`}
            {liveLoading && " · locating…"}
            {liveLocation && !liveLoading && " · live location on"}
            {liveError && " · location off"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {profile && (
            <Link
              href={`/u/${profile.username}`}
              className="hidden text-[13px] text-[#0071e3] sm:inline"
            >
              @{profile.username}
            </Link>
          )}
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="rounded-full bg-neutral-100 px-3 py-1.5 text-[13px] font-medium text-[#0071e3] transition hover:bg-neutral-200"
          >
            {sidebarOpen ? "Hide filters" : "Filters"}
          </button>
        </div>
      </nav>

      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen && (
          <aside className="absolute inset-y-0 left-0 z-10 flex w-[min(100%,18rem)] flex-col border-r border-black/10 bg-white/95 shadow-xl backdrop-blur-xl sm:static sm:shadow-none">
            <div className="border-b border-black/5 px-4 py-3">
              <p className="text-[13px] font-semibold">Heatmap scope</p>
              <p className="mt-0.5 text-[12px] text-neutral-500">
                Live GPS + demo Toronto heat until real captures land.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              <FilterButton
                active={scope.kind === "public"}
                onClick={() => setScope({ kind: "public" })}
                title="Public"
                subtitle="Every geotagged environment"
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
                subtitle={user ? "Only yours" : "Sign in required"}
              />

              <p className="mb-1 mt-4 px-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                Albums
              </p>
              {!user && (
                <p className="px-2 py-2 text-[12px] text-neutral-500">
                  <Link href="/signin" className="text-[#0071e3]">
                    Sign in
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
                  active={
                    scope.kind === "album" && scope.albumId === album.id
                  }
                  onClick={() =>
                    setScope({ kind: "album", albumId: album.id })
                  }
                  title={album.name}
                  subtitle={`${album.placeIds?.length ?? 0} environments`}
                />
              ))}
            </div>
          </aside>
        )}

        <section className="relative min-h-0 min-w-0 flex-1 pb-16">
          <PlacesMap
            places={filtered}
            liveLocation={liveLocation}
            className="absolute inset-0"
          />
          {(liveLoading || liveError) && (
            <div className="pointer-events-none absolute bottom-20 left-1/2 z-[1] max-w-sm -translate-x-1/2 rounded-full bg-white/95 px-4 py-2 text-center text-[12px] text-neutral-600 shadow-md ring-1 ring-black/10">
              {liveError
                ? "Location off — allow GPS to show where you are"
                : "Finding your live location…"}
            </div>
          )}
        </section>
      </div>

      <AppTabs active="map" />
    </main>
  );
}

function mergePlaces(real: LocatedPlace[], demo: LocatedPlace[]) {
  const seen = new Set(real.map((p) => p.id));
  return [...real, ...demo.filter((p) => !seen.has(p.id))];
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
      <p className={`text-[12px] ${active ? "text-white/80" : "text-neutral-500"}`}>
        {subtitle}
      </p>
    </button>
  );
}
