import PlaceThumb from "@/components/PlaceThumb";
import type { Place } from "@/lib/types";

/**
 * What an album looks like from the outside.
 *
 * Three answers, in order. A cover the owner chose wins outright. Failing that
 * the album is described by what is in it, as a playlist is: four environments
 * quartered into one tile. And an album with too few to quarter shows the first
 * one whole rather than a grid with holes in it.
 */
const MOSAIC_TILES = 4;

export default function AlbumCover({
  coverUrl,
  places,
  alt = "",
}: {
  coverUrl?: string;
  /** The album's contents, in album order. */
  places: Place[];
  alt?: string;
}) {
  if (coverUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={coverUrl} alt={alt} className="h-full w-full object-cover" />
    );
  }

  const tiles = places.slice(0, MOSAIC_TILES);
  if (tiles.length === 0) return <EmptyCover />;
  if (tiles.length < MOSAIC_TILES) return <PlaceThumb place={tiles[0]} />;

  return (
    <div className="grid h-full w-full grid-cols-2 grid-rows-2">
      {tiles.map((place) => (
        <div key={place.id} className="overflow-hidden">
          <PlaceThumb place={place} />
        </div>
      ))}
    </div>
  );
}

function EmptyCover() {
  return (
    <div className="flex h-full w-full items-center justify-center text-neutral-300">
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-2/5 max-h-10 w-2/5 max-w-10"
        aria-hidden
      >
        <path d="M19 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm-9.5 3A1.5 1.5 0 1 1 8 9.5 1.5 1.5 0 0 1 9.5 8Zm9.5 9H5l4-5 2.5 3 3.5-4.5Z" />
      </svg>
    </div>
  );
}
