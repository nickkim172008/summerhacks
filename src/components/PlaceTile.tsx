"use client";

import Link from "next/link";
import PlaceThumb from "@/components/PlaceThumb";
import type { Place } from "@/lib/types";

/**
 * One capture in a grid. Its actions sit on the square rather than inside the
 * environment, so correcting a name, taking it out of an album or deleting it
 * does not mean loading a splat first.
 *
 * The buttons are siblings of the link, not children: nesting a button inside
 * an anchor is invalid, and the click would race the navigation.
 */
export default function PlaceTile({
  place,
  href,
  onEdit,
  onRemoveFromAlbum,
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
  /** To the trash, where it waits rather than ends. */
  onTrash?: () => void;
}) {
  return (
    <div className="group relative aspect-square overflow-hidden bg-neutral-100">
      <Link href={href} className="block h-full w-full">
        <PlaceThumb place={place} />
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-6 text-xs font-medium text-white opacity-0 transition group-hover:opacity-100">
          {place.name}
        </span>
      </Link>

      {/* Always there on touch, where there is no hover to reveal them. */}
      <div className="absolute right-1.5 top-1.5 z-10 flex gap-1 md:opacity-0 md:transition md:group-hover:opacity-100 md:focus-within:opacity-100">
        {onEdit && (
          <button
            onClick={onEdit}
            aria-label={`Edit ${place.name}`}
            className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-[#0071e3] shadow-sm backdrop-blur transition hover:bg-white"
          >
            Edit
          </button>
        )}
        {onRemoveFromAlbum && (
          <button
            onClick={onRemoveFromAlbum}
            aria-label={`Remove ${place.name} from this album`}
            title="Remove from this album — the environment is kept"
            className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-[#1d1d1f] shadow-sm backdrop-blur transition hover:bg-white"
          >
            Remove
          </button>
        )}
        {onTrash && (
          <button
            onClick={onTrash}
            aria-label={`Delete ${place.name}`}
            title="Move to trash"
            className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-red-500 shadow-sm backdrop-blur transition hover:bg-white"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
