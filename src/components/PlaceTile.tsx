"use client";

import Link from "next/link";
import PlaceThumb from "@/components/PlaceThumb";
import type { Place } from "@/lib/types";

/**
 * One capture in a grid. Edit sits on the square rather than inside the
 * environment, so correcting a name or a pin does not mean loading a splat
 * first.
 *
 * The button is a sibling of the link, not a child: nesting a button inside an
 * anchor is invalid, and the click would race the navigation.
 */
export default function PlaceTile({
  place,
  href,
  onEdit,
}: {
  place: Place;
  href: string;
  /** Offered only to whoever captured this. */
  onEdit?: () => void;
}) {
  return (
    <div className="group relative aspect-square overflow-hidden bg-neutral-100">
      <Link href={href} className="block h-full w-full">
        <PlaceThumb place={place} />
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-6 text-xs font-medium text-white opacity-0 transition group-hover:opacity-100">
          {place.name}
        </span>
      </Link>

      {onEdit && (
        // Always there on touch, where there is no hover to reveal it.
        <button
          onClick={onEdit}
          aria-label={`Edit ${place.name}`}
          className="absolute right-1.5 top-1.5 z-10 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-[#0071e3] shadow-sm backdrop-blur transition hover:bg-white md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
        >
          Edit
        </button>
      )}
    </div>
  );
}
