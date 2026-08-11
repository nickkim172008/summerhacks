/**
 * Where a visitor was standing when Atlas asked them to sign in.
 *
 * Public browsing means the sign-in prompt now arrives mid-visit — from a
 * journey someone was reading, from Capture, from the Add button on a public
 * album — and dropping them on the library afterwards loses the thing they
 * were about to do. The destination rides along in ?next and is handed back
 * once the account exists.
 */

/**
 * Only a path on this site may aim a redirect. Anything else — an absolute
 * URL, or the "//evil.example" that a browser also reads as one — would let a
 * crafted link bounce someone off Atlas through its own sign-in screen.
 */
export function sitePath(value: string | null | undefined): string | null {
  return value && /^\/(?![/\\])/.test(value) ? value : null;
}

/** A link to sign-in that comes back here. */
export function signInHref(next?: string | null): string {
  const target = sitePath(next);
  return target ? `/signin?next=${encodeURIComponent(target)}` : "/signin";
}

/** The same, for the sign-up half of the same door. */
export function signUpHref(next?: string | null): string {
  const target = sitePath(next);
  return target ? `/signup?next=${encodeURIComponent(target)}` : "/signup";
}

/** Carries the destination through the username step and on to the end. */
export function setupHref(next?: string | null): string {
  const target = sitePath(next);
  return target ? `/setup?next=${encodeURIComponent(target)}` : "/setup";
}
