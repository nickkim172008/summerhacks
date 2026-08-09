import Image from "next/image";
import { canOptimizeImage } from "@/lib/imageHosts";

/* Someone without a photo still gets a face of their own: a muted gradient
   picked from their handle, so the same person is the same colour everywhere.
   Same idea as PlaceThumb's gradientFor(), tuned to sit under the neutrals. */
const AVATAR_GRADIENTS = [
  "bg-[linear-gradient(140deg,#C8D3E0,#8593A5)]",
  "bg-[linear-gradient(140deg,#CDBBA8,#A3866A)]",
  "bg-[linear-gradient(140deg,#A8C0B4,#6D8D80)]",
  "bg-[linear-gradient(140deg,#B9A8CD,#7D6B9C)]",
];

function gradientFor(username: string) {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash * 31 + username.charCodeAt(i)) | 0;
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

/**
 * Profile photo, falling back to the first letter of the handle. Google
 * accounts without a photo, and profiles claimed before one was set, both
 * arrive with photoURL as an empty string rather than undefined.
 */
export default function Avatar({
  profile,
  className = "h-8 w-8",
  textClassName = "text-[13px]",
}: {
  profile: { username: string; photoURL?: string };
  className?: string;
  textClassName?: string;
}) {
  if (profile.photoURL) {
    return (
      // Twice the largest frame an avatar gets, so a retina screen has enough
      // and nobody downloads a 400px face for a 32px circle. The optimizer
      // fetches it server-side, which also settles the referrer Google rejects.
      <Image
        src={profile.photoURL}
        alt=""
        width={64}
        height={64}
        // A photo from somewhere unlisted is still worth showing; the optimizer
        // would refuse it, and next/image turns that refusal into a crash.
        unoptimized={!canOptimizeImage(profile.photoURL)}
        className={`${className} shrink-0 rounded-full object-cover`}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={`${className} ${textClassName} ${gradientFor(profile.username)} flex shrink-0 items-center justify-center rounded-full font-semibold text-white`}
    >
      {profile.username.slice(0, 1).toUpperCase()}
    </div>
  );
}
