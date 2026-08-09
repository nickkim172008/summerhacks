"use client";

import { useState } from "react";
import AlbumCover from "@/components/AlbumCover";
import type { Album, Place } from "@/lib/types";

/**
 * Puts one capture into an album, from wherever the capture is being looked at.
 * The album page's own picker runs the other way — several captures into the
 * album already open — which is the wrong shape when the thing in hand is the
 * capture.
 */
export default function AlbumPicker({
  place,
  albums,
  placesIn,
  onPick,
  onClose,
}: {
  place: Place;
  albums: Album[];
  /** The album's contents, which stand in as its cover when none was chosen. */
  placesIn: (album: Album) => Place[];
  onPick: (albumId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(album: Album) {
    setBusy(album.id);
    setError(null);
    try {
      await onPick(album.id);
      onClose();
    } catch {
      setError(`Could not add it to ${album.name}.`);
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl bg-white text-[#1d1d1f] shadow-2xl">
        <div className="border-b border-black/5 px-6 py-4">
          <h2 className="text-[17px] font-semibold">Add to journey</h2>
          <p className="mt-0.5 truncate text-[13px] text-neutral-500">
            {place.name}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {albums.length === 0 && (
            <p className="px-3 py-6 text-center text-[13px] text-neutral-500">
              No journeys yet. Create one from the library first.
            </p>
          )}

          {albums.map((album) => {
            const holds = (album.placeIds ?? []).includes(place.id);
            return (
              <button
                key={album.id}
                onClick={() => pick(album)}
                disabled={holds || busy !== null}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-neutral-50 disabled:cursor-default disabled:hover:bg-transparent"
              >
                <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-neutral-100">
                  <AlbumCover
                    coverUrl={album.coverUrl}
                    places={placesIn(album)}
                    alt={album.name}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">
                    {album.name}
                  </p>
                  <p className="text-[12px] text-neutral-500">
                    {album.placeIds?.length ?? 0} places
                  </p>
                </div>
                <span className="shrink-0 text-[13px] text-neutral-400">
                  {holds ? "Already in" : busy === album.id ? "Adding…" : ""}
                </span>
              </button>
            );
          })}
        </div>

        {error && <p className="px-6 pb-2 text-[13px] text-red-600">{error}</p>}

        <div className="flex justify-end border-t border-black/5 px-6 py-3">
          <button
            onClick={onClose}
            className="rounded-full border border-black/10 px-5 py-2 text-[15px] transition hover:bg-neutral-50"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
