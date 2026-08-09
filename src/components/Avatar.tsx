import Image from "next/image";

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
        className={`${className} shrink-0 rounded-full object-cover`}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={`${className} ${textClassName} flex shrink-0 items-center justify-center rounded-full bg-neutral-100 font-semibold text-neutral-500`}
    >
      {profile.username.slice(0, 1).toUpperCase()}
    </div>
  );
}
