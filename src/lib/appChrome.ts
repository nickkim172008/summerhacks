/** Auth / setup screens stay chrome-free (no top logo bar or bottom tabs). */
export function shouldHideAppChrome(pathname: string) {
  return (
    pathname === "/signin" ||
    pathname === "/signup" ||
    pathname === "/setup" ||
    pathname.startsWith("/signin/") ||
    pathname.startsWith("/signup/") ||
    pathname.startsWith("/setup/")
  );
}
