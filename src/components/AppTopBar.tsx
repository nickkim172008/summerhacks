"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AtlasLogo from "@/components/AtlasLogo";
import Avatar from "@/components/Avatar";
import { signOut, useAuthProfile } from "@/lib/auth";
import { shouldHideAppChrome } from "@/lib/appChrome";
import { useNotifications } from "@/lib/notifications";

type Tab = "library" | "feed" | "discover" | "map";

/**
 * The whole of Atlas's navigation, in one 64px bar — mount once from the root
 * layout. It used to be two: a mark up here and a tab bar pinned across the
 * bottom of the window, which is a phone's idea sitting on a desktop.
 */
export default function AppTopBar() {
  const pathname = usePathname() ?? "/";
  const { user, profile, loading } = useAuthProfile();

  if (shouldHideAppChrome(pathname)) return null;

  const current = tabForPath(pathname);

  return (
    <header className="sticky top-0 z-40 border-b border-[rgba(20,22,26,0.09)] bg-[rgba(250,249,247,0.92)] backdrop-blur-xl">
      {/* Full width rather than the content column the pages below use: the
          mark belongs at the edge of the screen, not at the edge of the
          content. Constrained, it floated inwards on a wide display and read as
          though it had been centred by accident. */}
      <div className="flex h-16 items-center gap-8 px-8">
        <Link href="/" aria-label="Atlas home" className="shrink-0">
          <AtlasLogo priority className="h-auto w-[78px]" />
        </Link>

        <nav className="flex h-full items-center gap-1">
          <NavLink href="/" label="Library" active={current === "library"} />
          <NavLink href="/feed" label="Feed" active={current === "feed"} />
          <NavLink
            href="/discover"
            label="Discover"
            active={current === "discover"}
          />
          <NavLink href="/map" label="Map" active={current === "map"} />
        </nav>

        <div className="flex-1" />

        <div className="flex shrink-0 items-center gap-3">
          {/* No search field here: Discover is one click away in the nav and
              owns the only search, so a second one would just be a link
              wearing a field's clothes. */}
          <Link
            href="/capture?new=1"
            className="flex h-9 items-center gap-[7px] rounded-full bg-[#14161A] px-[18px] text-[14px] font-medium text-white transition hover:bg-[#2A2E35]"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-[15px] w-[15px]"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Capture
          </Link>

          {loading ? null : profile ? (
            <>
              <NotificationsBell uid={profile.id} />
              <Link
                href={`/u/${profile.username}`}
                aria-label={`Your profile, @${profile.username}`}
                title={`@${profile.username}`}
                className="rounded-full shadow-[0_0_0_1px_rgba(20,22,26,0.1)] transition hover:opacity-90"
              >
                <Avatar profile={profile} className="h-[34px] w-[34px]" />
              </Link>
              <button
                onClick={() => signOut()}
                className="text-[14px] text-[#4A4F57] transition hover:text-[#14161A]"
              >
                Sign Out
              </button>
            </>
          ) : user ? (
            <Link
              href="/setup"
              className="text-[14px] font-medium text-[#14161A]"
            >
              Finish setup
            </Link>
          ) : (
            <>
              <Link
                href="/signin"
                className="text-[14px] font-medium text-[#14161A]"
              >
                Sign In
              </Link>
              <Link
                href="/signup"
                className="flex h-9 items-center rounded-full bg-[#14161A] px-[18px] text-[14px] font-medium text-white transition hover:bg-[#2A2E35]"
              >
                Sign Up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * Where you are is the first job Atlas blue does: a 2px bar pinned to the
 * bottom edge of the bar itself, not to the label.
 */
function NavLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative flex h-16 items-center px-3.5 text-[15px] transition ${
        active
          ? "font-medium text-[#14161A]"
          : "font-normal text-[#6B7178] hover:text-[#14161A]"
      }`}
    >
      {label}
      {active && (
        <span className="absolute bottom-[-1px] left-[14px] right-[14px] h-[2px] rounded-[2px] bg-[#0071E3]" />
      )}
    </Link>
  );
}

function tabForPath(pathname: string): Tab | null {
  if (pathname === "/feed" || pathname.startsWith("/feed/")) {
    return "feed";
  }
  if (pathname === "/discover" || pathname.startsWith("/discover/")) {
    return "discover";
  }
  if (pathname === "/map" || pathname.startsWith("/map/")) {
    return "map";
  }
  // Library covers home, albums, profiles, capture, places, etc.
  return "library";
}

/**
 * Split out so the notification listeners only run for a signed-in visitor —
 * a hook here in AppTopBar would open them on every page for everyone.
 */
function NotificationsBell({ uid }: { uid: string }) {
  const { unread } = useNotifications(uid);

  return (
    <Link
      href="/notifications"
      aria-label={
        unread > 0 ? `Notifications, ${unread} new` : "Notifications"
      }
      className="relative flex h-9 w-9 items-center justify-center rounded-full text-[#4A4F57] transition hover:text-[#14161A]"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-[19px] w-[19px]"
        fill="currentColor"
        aria-hidden
      >
        <path d="M12 2a6 6 0 0 0-6 6v3.6l-1.4 2.8A1 1 0 0 0 5.5 16h13a1 1 0 0 0 .9-1.45L18 11.6V8a6 6 0 0 0-6-6Zm0 20a2.75 2.75 0 0 0 2.75-2.5h-5.5A2.75 2.75 0 0 0 12 22Z" />
      </svg>
      {unread > 0 && (
        // The count itself is carried by the aria-label above; what the eye
        // needs here is only that there is something new.
        <span className="absolute right-[7px] top-[6px] h-[7px] w-[7px] rounded-full border-[1.5px] border-[#FAF9F7] bg-[#0071E3]" />
      )}
    </Link>
  );
}
