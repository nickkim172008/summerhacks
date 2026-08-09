"use client";

import Link from "next/link";

/**
 * Starts an album's walkthrough from a list. It is a link rather than a button
 * so a tour can be copied, shared and reloaded: the URL it points at is the
 * whole of the opening, and /tour picks up from there.
 */
export default function AlbumTourButton({
  albumId,
  name,
}: {
  albumId: string;
  name: string;
}) {
  return (
    <Link
      href={`/map?album=${albumId}&tour=1`}
      aria-label={`Play the ${name} walkthrough`}
      title="Play walkthrough"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] text-[#0071e3] ring-1 ring-black/8 transition hover:bg-neutral-100"
    >
      <span aria-hidden>▶</span>
    </Link>
  );
}
