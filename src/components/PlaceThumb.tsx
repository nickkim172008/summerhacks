import Image from "next/image";
import { canOptimizeImage } from "@/lib/imageHosts";
import type { Place } from "@/lib/types";

/* Splats rarely have thumbnails yet, so fall back to a stable
   per-place gradient — keeps the grid colorful like a photo library.
   Muted to sit under the new neutrals rather than shout over them. */
const GRADIENTS = [
  "bg-[linear-gradient(140deg,#8FB6D9,#5F6FA8)]",
  "bg-[linear-gradient(140deg,#E3C58F,#C78A54)]",
  "bg-[linear-gradient(140deg,#8EC3AC,#4C8478)]",
  "bg-[linear-gradient(140deg,#D9A1A8,#A3607A)]",
  "bg-[linear-gradient(140deg,#A89ECD,#6B5F9C)]",
  "bg-[linear-gradient(140deg,#8FC6D4,#4B7EA6)]",
];

function gradientFor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

export default function PlaceThumb({ place }: { place: Place }) {
  if (place.thumbnailUrl) {
    return (
      // Its own positioning context: `fill` measures the nearest positioned
      // ancestor, and this tile is dropped into several different grids.
      <div className="relative h-full w-full">
        <Image
          src={place.thumbnailUrl}
          alt={place.name}
          fill
          // Widest the grid ever paints one: five columns inside a 64rem page.
          sizes="(min-width: 768px) 210px, (min-width: 640px) 25vw, 33vw"
          unoptimized={!canOptimizeImage(place.thumbnailUrl)}
          className="object-cover"
        />
      </div>
    );
  }
  return (
    <div
      className={`flex h-full w-full items-center justify-center ${gradientFor(place.id)}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        className="h-1/4 w-1/4 max-h-10 max-w-10 text-white/80"
      >
        {/* 3D cube — this tile is a walkable environment, not a flat photo */}
        <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7L12 2.5Z" />
        <path d="M3.5 7 12 11.5 20.5 7" />
        <path d="M12 11.5V21.5" />
      </svg>
    </div>
  );
}
