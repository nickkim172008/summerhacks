/**
 * Auth / setup screens stay chrome-free (no top logo bar or bottom tabs), and
 * so does a place: standing inside a capture is the whole screen, and a tab bar
 * sitting over the floor of the room breaks that — as well as covering the part
 * of the canvas a drag needs to reach.
 */
export function shouldHideAppChrome(pathname: string) {
  return (
    pathname === "/signin" ||
    pathname === "/signup" ||
    pathname === "/setup" ||
    pathname.startsWith("/signin/") ||
    pathname.startsWith("/signup/") ||
    pathname.startsWith("/setup/") ||
    pathname.startsWith("/place/")
  );
}
