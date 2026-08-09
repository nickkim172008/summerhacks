"use client";

import { Suspense, use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import PlaceExperience from "@/components/PlaceExperience";
import PlaceDetailsEditor from "@/components/PlaceDetailsEditor";
import { getPlace } from "@/lib/places";
import {
  canEditAlbum,
  ensurePlacesLinkedToAlbum,
  subscribeToAlbum,
} from "@/lib/albums";
import { useAuth } from "@/lib/auth";
import { getProfile } from "@/lib/profiles";
import type { Album, Place, Profile } from "@/lib/types";

export default function PlacePage({
  params,
}: {
  params: Promise<{ placeId: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <PlaceView params={params} />
    </Suspense>
  );
}

function PlaceView({ params }: { params: Promise<{ placeId: string }> }) {
  const { placeId } = use(params);
  const router = useRouter();
  const search = useSearchParams();
  // An album scopes the whole visit — jumps stay inside it — while ?from only
  // names the page that sent the visitor here so leaving returns them to it.
  const albumId = search.get("album");
  const from = sitePath(search.get("from"));
  const exitHref = albumId ? `/album/${albumId}` : (from ?? "/");
  // Named from the link that opened this, not from a read: the journey's own
  // title would cost a fetch the viewer would be waiting on.
  const exitLabel = albumId
    ? albumId === "recents"
      ? "Recents"
      : "Journey"
    : "Library";
  const { user } = useAuth();
  // undefined while loading, null once we know it isn't there.
  const [place, setPlace] = useState<Place | null | undefined>();
  const [album, setAlbum] = useState<Album | null>(null);
  const [fetchedUploader, setFetchedUploader] = useState<{
    uploaderId: string;
    profile: Profile | null;
  } | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let active = true;
    getPlace(placeId)
      .then((found) => {
        if (active) setPlace(found);
      })
      .catch(() => {
        if (active) setPlace(null);
      });
    return () => {
      active = false;
    };
  }, [placeId]);

  useEffect(() => {
    if (!albumId) {
      setAlbum(null);
      return;
    }
    return subscribeToAlbum(albumId, setAlbum, () => setAlbum(null));
  }, [albumId]);

  useEffect(() => {
    if (!album || !user || !canEditAlbum(album, user.uid)) return;
    void ensurePlacesLinkedToAlbum(album.id, album.placeIds ?? []);
  }, [album, user]);

  // Attribution is a nicety, so a missing or unreadable profile just leaves it
  // off rather than blocking the place from opening.
  useEffect(() => {
    const uploaderId = place?.uploaderId;
    if (!uploaderId) return;
    let active = true;
    getProfile(uploaderId)
      .then((profile) => {
        if (active) setFetchedUploader({ uploaderId, profile });
      })
      .catch(() => {
        if (active) setFetchedUploader({ uploaderId, profile: null });
      });
    return () => {
      active = false;
    };
  }, [place?.uploaderId]);

  // Tagged with whose profile it is, so a jump to another capture cannot show
  // the previous uploader while the new one loads.
  const uploader =
    fetchedUploader && fetchedUploader.uploaderId === place?.uploaderId
      ? fetchedUploader.profile
      : null;

  if (place === null) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-4 bg-[#FAF9F7] px-8 text-center">
        <p className="text-[15px] text-[#6B7178]">
          That place doesn&apos;t exist.
        </p>
        <Link
          href={exitHref}
          className="flex items-center gap-1.5 text-[13px] font-medium text-[#4A4F57] transition-colors duration-150 ease-[ease] hover:text-[#14161A]"
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Back
        </Link>
      </main>
    );
  }

  if (!place) {
    return (
      <main className="flex h-screen items-center justify-center bg-[#FAF9F7] px-8 text-[15px] text-[#6B7178]">
        Loading…
      </main>
    );
  }

  const isUploader = user?.uid === place.uploaderId;
  const isAlbumEditor = Boolean(album && canEditAlbum(album, user?.uid));
  const canEditPlace = isUploader || isAlbumEditor;
  const editingAsCollaborator = !isUploader && isAlbumEditor;

  return (
    <main className="h-screen w-screen">
      <PlaceExperience
        place={place}
        uploader={uploader}
        onExit={() => router.push(exitHref)}
        backLabel={exitLabel}
        onEdit={canEditPlace ? () => setEditing(true) : undefined}
      />
      {editing && (
        <PlaceDetailsEditor
          place={place}
          collaborator={editingAsCollaborator}
          onClose={() => setEditing(false)}
          onSaved={async () => setPlace(await getPlace(placeId))}
        />
      )}
    </main>
  );
}

// Only a path on this site may aim the exit; anything else in ?from would let a
// shared link send the visitor to another origin.
function sitePath(value: string | null) {
  return value && /^\/(?![/\\])/.test(value) ? value : null;
}
