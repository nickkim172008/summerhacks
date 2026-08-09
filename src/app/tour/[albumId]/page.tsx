"use client";

import {
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PlaceExperience, { FADE_MS } from "@/components/PlaceExperience";
import { resolveAlbumPlaces, subscribeToAlbum } from "@/lib/albums";
import { toTimelineEntries } from "@/lib/captureTimeline";
import { isFirebaseConfigured } from "@/lib/firebase";
import { subscribeToPlacesByUploader } from "@/lib/places";
import { warmSplat } from "@/lib/splatPrefetch";
import { useAuth } from "@/lib/auth";
import type { Album, Place } from "@/lib/types";

/**
 * Long enough to look around a room without being hurried, short enough that
 * eight of them is a demo rather than an afternoon.
 */
const HOLD_MS = 20000;
/** Ring resolution. Sixty of these a step, not twelve hundred frames of it. */
const TICK_MS = 100;

export default function TourPage({
  params,
}: {
  params: Promise<{ albumId: string }>;
}) {
  return (
    <Suspense fallback={<Curtain>Loading…</Curtain>}>
      <TourView params={params} />
    </Suspense>
  );
}

function TourView({ params }: { params: Promise<{ albumId: string }> }) {
  const { albumId } = use(params);
  const router = useRouter();
  const search = useSearchParams();
  const { user } = useAuth();

  const [album, setAlbum] = useState<Album | null | undefined>();
  const [places, setPlaces] = useState<Place[] | null>(
    isFirebaseConfigured ? null : [],
  );

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    return subscribeToAlbum(albumId, setAlbum, () => setAlbum(null));
  }, [albumId]);

  // The album's owner, not the viewer — a walkthrough of someone else's album
  // has to resolve their placeIds, and this account's captures will not.
  useEffect(() => {
    if (!isFirebaseConfigured || !user || !album?.ownerId) return;
    return subscribeToPlacesByUploader(album.ownerId, setPlaces);
  }, [user, album?.ownerId]);

  /**
   * The walkthrough's running order. Ascending on the shared axis, the same one
   * the timeline draws: a tour that visits captures in a different order from
   * the timeline that launched it is a bug, not a variation. Captures with no
   * coordinates stay in — a place the map cannot draw still has a splat worth
   * walking through.
   */
  const steps = useMemo(() => {
    if (!places || !album) return null;
    const byId = new Map(places.map((place) => [place.id, place]));
    const inAlbum = resolveAlbumPlaces(album.placeIds, byId);
    return toTimelineEntries(inAlbum)
      .map((entry) => byId.get(entry.id))
      .filter((place): place is Place => Boolean(place));
  }, [places, album]);

  const total = steps?.length ?? 0;
  const index = clampIndex(search.get("i"), total);
  const place = steps?.[index];

  // Only a path on this site may aim the exit; anything else in ?from would let
  // a shared walkthrough send its viewer to another origin.
  const from = search.get("from");
  const exitHref =
    from && /^\/(?![/\\])/.test(from) ? from : `/map?album=${albumId}`;

  const [fading, setFading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [held, setHeld] = useState(false);
  const [looking, setLooking] = useState(false);
  const [hidden, setHidden] = useState(
    () =>
      typeof document !== "undefined" && document.visibilityState === "hidden",
  );
  const elapsedRef = useRef(0);
  const travelRef = useRef<number | null>(null);

  // Arriving at a new capture clears the last one's ring here rather than in an
  // effect, so no frame is ever painted showing the previous countdown.
  const [renderedIndex, setRenderedIndex] = useState(index);
  if (renderedIndex !== index) {
    setRenderedIndex(index);
    setFading(false);
    setProgress(0);
  }

  // The elapsed half of that reset. Declared above the hold below so that on a
  // step it has run before the new interval starts.
  useEffect(() => {
    elapsedRef.current = 0;
  }, [index]);

  const stepHref = useCallback(
    (next: number) => {
      const query = new URLSearchParams({ i: String(next) });
      if (from) query.set("from", from);
      return `/tour/${albumId}?${query.toString()}`;
    },
    [albumId, from],
  );

  const exit = useCallback(() => {
    if (travelRef.current !== null) {
      window.clearTimeout(travelRef.current);
      travelRef.current = null;
    }
    router.push(exitHref);
  }, [router, exitHref]);

  const travelTo = useCallback(
    (next: number) => {
      if (travelRef.current !== null) return;
      setFading(true);
      travelRef.current = window.setTimeout(() => {
        travelRef.current = null;
        // replace, so backing out of a seven-capture walkthrough is one press
        // rather than seven.
        router.replace(stepHref(next));
      }, FADE_MS);
    },
    [router, stepHref],
  );

  useEffect(() => {
    // A fade still in flight has to be called off when the viewer leaves during
    // it, or it lands afterwards and drags them back into the tour.
    return () => {
      if (travelRef.current !== null) window.clearTimeout(travelRef.current);
      travelRef.current = null;
    };
  }, []);

  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const paused = held || looking || hidden;

  /**
   * The hold. Elapsed time lives in a ref so that pausing and resuming restarts
   * the interval without restarting the countdown — the whole point of pausing
   * is that the twelve seconds already spent looking around are not spent
   * again. Nothing here waits on the capture having loaded: some older records
   * point at files that are gone, and a walkthrough that stops dead on one of
   * them is a walkthrough that ends there.
   */
  useEffect(() => {
    if (paused || fading || !place) return;
    const last = index >= total - 1;

    const timer = window.setInterval(() => {
      const elapsed = elapsedRef.current + TICK_MS;
      elapsedRef.current = elapsed;
      if (elapsed < HOLD_MS) {
        setProgress(elapsed / HOLD_MS);
        return;
      }
      window.clearInterval(timer);
      setProgress(1);
      if (last) exit();
      else travelTo(index + 1);
    }, TICK_MS);

    return () => window.clearInterval(timer);
  }, [paused, fading, place, index, total, travelTo, exit]);

  // The next capture, fetched while this one is on screen.
  const nextSplatUrl = steps?.[index + 1]?.splatUrl;
  useEffect(() => {
    void warmSplat(nextSplatUrl);
  }, [nextSplatUrl]);

  useEffect(() => {
    if (!place) return;

    const onKey = (event: KeyboardEvent) => {
      if (typingTarget(event.target)) return;

      if (event.key === "ArrowRight") {
        if (index >= total - 1) exit();
        else travelTo(index + 1);
      } else if (event.key === "ArrowLeft") {
        if (index > 0) travelTo(index - 1);
      } else if (event.key === "Escape") {
        exit();
      } else if (event.key === " ") {
        setHeld((was) => !was);
      } else return;

      event.preventDefault();
      // Capture phase, and stopped here: the pivot controls also listen on the
      // window for the arrow keys, and without this every step would turn the
      // camera on the way out. A and D still turn it, as they always did.
      event.stopPropagation();
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [place, index, total, travelTo, exit]);

  if (!isFirebaseConfigured) {
    return <Curtain>Walkthroughs need Firebase configured.</Curtain>;
  }

  if (album === null) {
    return <Curtain href={exitHref}>That journey doesn&apos;t exist.</Curtain>;
  }

  if (!steps) return <Curtain>Loading…</Curtain>;

  if (steps.length === 0) {
    return (
      <Curtain href={exitHref}>
        {user
          ? "Nothing in this journey can be walked through yet."
          : "Sign in to walk through this journey."}
      </Curtain>
    );
  }

  if (!place) return <Curtain href={exitHref}>Loading…</Curtain>;

  return (
    <main className="h-screen w-screen">
      <PlaceExperience
        key={place.id}
        place={place}
        onLookingChange={setLooking}
        tour={{
          albumName: album?.name ?? "Walkthrough",
          index,
          total,
          progress,
          paused,
          fading,
          onPrevious: index > 0 ? () => travelTo(index - 1) : undefined,
          onNext: () => (index >= total - 1 ? exit() : travelTo(index + 1)),
          onTogglePause: () => setHeld((was) => !was),
          onExit: exit,
        }}
      />
    </main>
  );
}

function Curtain({ children, href }: { children: ReactNode; href?: string }) {
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-3 bg-black px-6 text-center text-neutral-400">
      <p>{children}</p>
      {href && (
        <Link href={href} className="text-sky-400 underline">
          Back
        </Link>
      )}
    </main>
  );
}

function clampIndex(raw: string | null, total: number) {
  const asked = Number.parseInt(raw ?? "0", 10);
  if (!Number.isFinite(asked) || total === 0) return 0;
  return Math.min(Math.max(asked, 0), total - 1);
}

/** Arrow keys belong to the field, and to the audio scrubber, when one is aimed at. */
function typingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}
