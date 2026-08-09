"use client";

import { Suspense, use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import PlaceExperience from "@/components/PlaceExperience";
import PlaceDetailsEditor from "@/components/PlaceDetailsEditor";
import { getPlace } from "@/lib/places";
import { useAuth } from "@/lib/auth";
import { getProfile } from "@/lib/profiles";
import type { Place, Profile } from "@/lib/types";

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
  const { user } = useAuth();
  // undefined while loading, null once we know it isn't there.
  const [place, setPlace] = useState<Place | null | undefined>();
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
      <main className="flex h-screen flex-col items-center justify-center gap-3 bg-black text-white">
        <p>That environment doesn&apos;t exist.</p>
        <Link href={exitHref} className="text-sky-400 underline">
          Back
        </Link>
      </main>
    );
  }

  if (!place) {
    return (
      <main className="flex h-screen items-center justify-center bg-black text-neutral-400">
        Loading…
      </main>
    );
  }

  return (
    <main className="h-screen w-screen">
      <PlaceExperience
        place={place}
        uploader={uploader}
        onExit={() => router.push(exitHref)}
        onEdit={
          user?.uid === place.uploaderId ? () => setEditing(true) : undefined
        }
      />
      {editing && (
        <PlaceDetailsEditor
          place={place}
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
