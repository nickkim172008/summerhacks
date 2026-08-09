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
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={profile.photoURL}
        alt=""
        // Google's lh3.googleusercontent.com photos 403 when a referrer is
        // sent, so every avatar has to suppress it.
        referrerPolicy="no-referrer"
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
