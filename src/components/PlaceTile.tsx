"use client";

import Link from "next/link";
import PlaceThumb from "@/components/PlaceThumb";
import TileMenu, { type TileMenuItem } from "@/components/TileMenu";
import { formatPlaceDate } from "@/lib/places";
import type { Place } from "@/lib/types";

/**
 * One capture in a grid. Its actions sit on the square rather than inside the
 * environment, so correcting a name, taking it out of an album or deleting it
 * does not mean loading a splat first.
 *
 * The menu is a sibling of the link, not a child: nesting a button inside an
 * anchor is invalid, and the click would race the navigation.
 */
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
      title: "Remove from this journey — the place is kept",
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
    <div className="group relative aspect-square bg-neutral-100">
      <Link href={href} className="absolute inset-0 overflow-hidden">
        <PlaceThumb place={place} />
        {taken && (
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-2 pb-1.5 pt-6 text-right text-[11px] font-medium text-white opacity-0 transition group-hover:opacity-100">
            {taken}
          </span>
        )}
      </Link>
      <TileMenu items={items} />
    </div>
  );
}
