import type { Place } from "@/lib/types";

/* Splats rarely have thumbnails yet, so fall back to a stable
   per-place gradient — keeps the grid colorful like a photo library. */
const GRADIENTS = [
  "from-sky-400 to-indigo-500",
  "from-amber-300 to-orange-500",
  "from-emerald-400 to-teal-600",
  "from-rose-400 to-pink-600",
  "from-violet-400 to-purple-600",
  "from-cyan-400 to-blue-600",
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
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={place.thumbnailUrl}
        alt={place.name}
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <div
      className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${gradientFor(place.id)}`}
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
