/**
 * Where images may be fetched from, in one place because two things need it:
 * next.config builds the optimizer's allowlist from it, and the components ask
 * it whether a given URL is one the optimizer will accept.
 *
 * That second question matters because an unlisted host is not a degraded
 * image — next/image throws, and a profile photo from an unexpected provider
 * would take the whole page down with it. Anything unrecognised is passed
 * through unoptimized instead.
 */
export const IMAGE_HOSTS = [
  // Everything this app stores: splat covers, album covers, avatars.
  { hostname: "firebasestorage.googleapis.com", pathname: "/v0/b/**" },
  // Google account photos, which arrive with the sign-in rather than from us.
  { hostname: "lh3.googleusercontent.com", pathname: "/**" },
  // The hackathon's own site, which the demo organizer profiles point at.
  { hostname: "www.summerhacks.ca", pathname: "/**" },
] as const;

export function canOptimizeImage(src: string) {
  try {
    const url = new URL(src);
    return (
      url.protocol === "https:" &&
      IMAGE_HOSTS.some((host) => host.hostname === url.hostname)
    );
  } catch {
    // A relative path is served by this app and needs no allowlisting.
    return src.startsWith("/");
  }
}
