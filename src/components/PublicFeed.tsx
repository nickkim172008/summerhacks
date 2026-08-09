"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import PlaceThumb from "@/components/PlaceThumb";
import Avatar from "@/components/Avatar";
import { getProfile } from "@/lib/profiles";
import { formatPlaceDate } from "@/lib/places";
import { warmSplat } from "@/lib/splatPrefetch";
import type { Album, Place, Profile } from "@/lib/types";

const SplatViewer = dynamic(() => import("./SplatViewer"), { ssr: false });

export interface FeedEntry {
  place: Place;
  /** The public journey this place arrived through — the card's chip. */
  album: Album | null;
}

/**
 * A vertical, snap-scrolled feed of live places — the environments themselves,
 * not stills. Only the card on screen mounts a 3D viewer; everything else
 * shows its poster, so a long feed never holds a stack of renderers open.
 * The poster stays on top until the splat decodes, then fades out over it.
 */
export default function PublicFeed({
  entries,
  onActiveIndexChange,
}: {
  entries: FeedEntry[];
  /** Lets the page around the feed react to scrolling — e.g. fold its header. */
  onActiveIndexChange?: (index: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [profiles, setProfiles] = useState<Map<string, Profile | null>>(
    () => new Map(),
  );

  const onActiveIndexChangeRef = useRef(onActiveIndexChange);
  useEffect(() => {
    onActiveIndexChangeRef.current = onActiveIndexChange;
  });
  useEffect(() => {
    onActiveIndexChangeRef.current?.(activeIndex);
  }, [activeIndex]);

  // Which card is on screen. Driven by the scroll container itself, so the
  // chevrons, a drag on the poster, and a trackpad all agree on what's active.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cards = Array.from(
      container.querySelectorAll<HTMLElement>("[data-feed-index]"),
    );
    const observer = new IntersectionObserver(
      (observed) => {
        for (const entry of observed) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.feedIndex);
          if (Number.isFinite(index)) setActiveIndex(index);
        }
      },
      { root: container, threshold: 0.6 },
    );
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [entries.length]);

  // Attribution needs faces. Fetched once per uploader and cached; a profile
  // that cannot be read just leaves the card unattributed.
  useEffect(() => {
    const missing = [
      ...new Set(entries.map((entry) => entry.place.uploaderId)),
    ].filter((id) => !profiles.has(id));
    if (missing.length === 0) return;
    let active = true;
    void Promise.all(
      missing.map(
        async (id) => [id, await getProfile(id).catch(() => null)] as const,
      ),
    ).then((pairs) => {
      if (!active) return;
      setProfiles((prev) => {
        const next = new Map(prev);
        for (const [id, profile] of pairs) next.set(id, profile);
        return next;
      });
    });
    return () => {
      active = false;
    };
  }, [entries, profiles]);

  // The next place starts downloading while this one is being looked at.
  useEffect(() => {
    void warmSplat(entries[activeIndex + 1]?.place.splatUrl);
  }, [activeIndex, entries]);

  function step(direction: 1 | -1) {
    const container = containerRef.current;
    if (!container) return;
    container.scrollBy({
      top: direction * container.clientHeight,
      behavior: "smooth",
    });
  }

  return (
    <div className="relative h-full">
      <div
        ref={containerRef}
        className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain"
      >
        {entries.map((entry, index) => (
          <div
            key={entry.place.id}
            data-feed-index={index}
            className="h-full snap-start py-2 first:pt-0"
          >
            <FeedCard
              entry={entry}
              active={index === activeIndex}
              profile={profiles.get(entry.place.uploaderId) ?? null}
            />
          </div>
        ))}
      </div>

      {entries.length > 1 && (
        <div className="pointer-events-none absolute inset-y-0 right-3 z-20 flex flex-col items-center justify-center gap-2">
          <FeedStepButton
            label="Previous place"
            disabled={activeIndex === 0}
            onClick={() => step(-1)}
          >
            <Chevron up />
          </FeedStepButton>
          <FeedStepButton
            label="Next place"
            disabled={activeIndex >= entries.length - 1}
            onClick={() => step(1)}
          >
            <Chevron />
          </FeedStepButton>
        </div>
      )}
    </div>
  );
}

function FeedStepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition hover:bg-black/60 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function FeedCard({
  entry,
  active,
  profile,
}: {
  entry: FeedEntry;
  active: boolean;
  profile: Profile | null;
}) {
  const { place, album } = entry;
  const [ready, setReady] = useState(false);

  // Scrolled away and back means a fresh viewer, so the poster returns first.
  useEffect(() => {
    if (!active) setReady(false);
  }, [active]);

  const taken = formatPlaceDate(place);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-[#14161A] shadow-[0_2px_4px_rgba(20,22,26,0.06),0_20px_40px_-24px_rgba(20,22,26,0.5)]">
      {active && (
        <div className="absolute inset-0">
          <SplatViewer
            splatUrl={place.splatUrl}
            entryPoint={place.entryPoint}
            onReady={() => setReady(true)}
          />
        </div>
      )}

      {/* Poster sits over the canvas until the splat has decoded, so a card
          never opens on an empty black room. */}
      <div
        className={`absolute inset-0 transition-opacity duration-700 ${
          active && ready ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <PlaceThumb place={place} />
        {active && !ready && (
          <div className="absolute inset-x-0 bottom-24 flex justify-center">
            <span className="rounded-full bg-black/50 px-3.5 py-1.5 text-[13px] font-medium text-white backdrop-blur-md">
              Loading place…
            </span>
          </div>
        )}
      </div>

      {/* The journey this place belongs to — tap to explore it or add yours. */}
      {album && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 bg-gradient-to-b from-black/55 to-transparent p-4 pb-10">
          <Link
            href={`/album/${album.id}`}
            className="pointer-events-auto inline-flex max-w-[70%] items-center gap-2 rounded-full bg-black/40 px-3.5 py-2 text-[13px] font-medium text-white backdrop-blur-md transition hover:bg-black/60"
          >
            <JourneyGlyph />
            <span className="truncate">{album.name}</span>
            <span className="shrink-0 text-white/60">
              · {album.placeIds?.length ?? 0}{" "}
              {(album.placeIds?.length ?? 0) === 1 ? "place" : "places"}
            </span>
          </Link>
          <Link
            href={`/capture?album=${album.id}&new=1`}
            className="pointer-events-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-black/40 px-3.5 py-2 text-[13px] font-medium text-white backdrop-blur-md transition hover:bg-black/60"
          >
            <PlusGlyph />
            Add yours
          </Link>
        </div>
      )}

      {/* Who captured it, what it is, and the way in. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 via-black/25 to-transparent p-5 pt-14">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            {profile && (
              <Link
                href={`/u/${profile.username}`}
                className="pointer-events-auto inline-flex items-center gap-2.5"
              >
                <Avatar
                  profile={profile}
                  className="h-8 w-8 shadow-[0_0_0_2px_rgba(255,255,255,0.7)]"
                  textClassName="text-[12px]"
                />
                <span className="truncate text-[14px] font-semibold text-white">
                  {profile.displayName}
                </span>
                <span className="truncate text-[13px] text-white/60">
                  @{profile.username}
                </span>
              </Link>
            )}
            <p className="mt-2 truncate font-display text-[22px] leading-[26px] text-white">
              {place.name}
            </p>
            {taken && <p className="mt-1 text-[12px] text-white/60">{taken}</p>}
          </div>
          <Link
            href={`/place/${place.id}?from=${encodeURIComponent("/feed")}`}
            className="pointer-events-auto inline-flex h-10 shrink-0 items-center rounded-full bg-white px-[22px] text-[14px] font-medium text-[#14161A] transition hover:bg-white/90"
          >
            Step inside
          </Link>
        </div>
      </div>
    </div>
  );
}

function Chevron({ up = false }: { up?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 ${up ? "rotate-180" : ""}`}
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[13px] w-[13px]"
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

function JourneyGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[14px] w-[14px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7L12 2.5Z" />
      <path d="M3.5 7 12 11.5 20.5 7" />
      <path d="M12 11.5V21.5" />
    </svg>
  );
}
