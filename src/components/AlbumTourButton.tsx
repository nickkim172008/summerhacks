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
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgba(20,22,26,0.14)] bg-white text-[#14161A] transition hover:bg-[rgba(20,22,26,0.05)]"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3 w-3"
        fill="currentColor"
        aria-hidden
      >
        <path d="M8 5v14l11-7z" />
      </svg>
    </Link>
  );
}
