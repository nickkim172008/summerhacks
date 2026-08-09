"use client";

import Link from "next/link";
import PlaceThumb from "@/components/PlaceThumb";
import TileMenu, { type TileMenuItem } from "@/components/TileMenu";
import { formatPlaceDate } from "@/lib/places";
import type { Place } from "@/lib/types";

/**
 * One capture in a grid: a square of the place, then its name and date beneath
 * it. The caption lives outside the square rather than in a gradient that only
 * appears on hover — a library you can read without pointing at it.
 *
 * Its actions sit on the square rather than inside the environment, so
 * correcting a name, taking it out of an album or deleting it does not mean
 * loading a splat first.
 *
 * The menu is a sibling of the link, not a child: nesting a button inside an
 * anchor is invalid, and the click would race the navigation. It also sits
 * outside the square, whose overflow is clipped, so the dropdown can escape.
 */

/** Audio length as a listener reads it: 1:36, not 96. */
function formatAudioLength(seconds: number) {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export default function PlaceTile({
  place,
  href,
  onEdit,
  onRemoveFromAlbum,
  onAddToAlbum,
  onTrash,
}: {
  place: Place;
  href: string;
  /** Offered only to whoever captured this. */
  onEdit?: () => void;
  /**
   * Takes it out of the album being viewed and nothing more — it stays in the
   * library and in any other album. Absent where there is no album to leave,
   * which is what Recents is.
   */
  onRemoveFromAlbum?: () => void;
  /** Files it into one of your albums, from a view that is not an album. */
  onAddToAlbum?: () => void;
  /** To the trash, where it waits rather than ends. */
  onTrash?: () => void;
}) {
  const items: TileMenuItem[] = [];
  if (onEdit) items.push({ label: "Edit", onClick: onEdit });
  if (onAddToAlbum) {
    items.push({
      label: "Add",
      onClick: onAddToAlbum,
      title: "Add to a journey",
    });
  }
  if (onRemoveFromAlbum) {
    items.push({
      label: "Remove",
      onClick: onRemoveFromAlbum,
      title: "Remove from this journey",
    });
  }
  if (onTrash) {
    items.push({
      label: "Delete",
      onClick: onTrash,
      danger: true,
      title: "Move to trash",
    });
  }

  const taken = formatPlaceDate(place);

  return (
    <div className="group relative">
      <div className="relative aspect-square overflow-hidden rounded-[14px] bg-[rgba(20,22,26,0.05)] shadow-[0_1px_2px_rgba(20,22,26,0.06)]">
        <Link
          href={href}
          className="absolute inset-0 transition-opacity duration-150 hover:opacity-90"
        >
          <PlaceThumb place={place} />
        </Link>
        {/* Somewhere with a recording of itself says so on the tile. */}
        {place.audioSeconds != null && (
          <span className="pointer-events-none absolute bottom-2.5 left-2.5 inline-flex items-center gap-[5px] rounded-full bg-[rgba(20,22,26,0.62)] px-[9px] py-1 text-[11px] font-medium text-white backdrop-blur-[6px]">
            <svg
              viewBox="0 0 24 24"
              width="11"
              height="11"
              fill="currentColor"
              aria-hidden
            >
              <path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4Z" />
            </svg>
            <span className="tabular-nums">
              {formatAudioLength(place.audioSeconds)}
            </span>
          </span>
        )}
      </div>
      <TileMenu items={items} />
      <p className="mt-2.5 truncate font-display text-[17px] leading-[22px] tracking-[-0.01em] text-[#14161A]">
        {place.name}
      </p>
      {taken && (
        <p className="mt-0.5 truncate text-[13px] tabular-nums text-[#6B7178]">
          {taken}
        </p>
      )}
    </div>
  );
}
