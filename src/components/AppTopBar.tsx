"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AtlasLogo from "@/components/AtlasLogo";
import Avatar from "@/components/Avatar";
import { signOut, useAuthProfile } from "@/lib/auth";
import { signInHref, signUpHref } from "@/lib/returnTo";
import { shouldHideAppChrome } from "@/lib/appChrome";
import { useNotifications } from "@/lib/notifications";

type Tab = "library" | "feed" | "discover" | "map";

/**
 * The bar is measured before paint on the client, but useLayoutEffect has
 * nothing to do during server rendering and says so loudly. Nothing is
 * measured on the server anyway — the indicator only renders once it has a box.
 */
const useLayoutEffectSafe =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

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

        <NavTabs current={current} />

        <div className="flex-1" />

        <div className="flex shrink-0 items-center gap-3">
          {/* No search field here: Discover is one click away in the nav and
              owns the only search, so a second one would just be a link
              wearing a field's clothes. */}
          {/* Capturing is the one thing that needs an account, so for a
              visitor this is the door to one — and it comes back here. */}
          <Link
            href={user ? "/capture?new=1" : signInHref("/capture?new=1")}
            className="press flex h-9 items-center gap-[7px] rounded-full bg-[#14161A] px-[18px] text-[14px] font-medium text-white transition hover:bg-[#2A2E35]"
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
              {/* Both come back to the page the visitor was reading — being
                  sent to the library for signing in from a journey loses the
                  journey. */}
              <Link
                href={signInHref(pathname)}
                className="text-[14px] font-medium text-[#14161A]"
              >
                Sign In
              </Link>
              <Link
                href={signUpHref(pathname)}
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

const TABS: { tab: Tab; href: string; label: string }[] = [
  { tab: "library", href: "/", label: "Library" },
  { tab: "feed", href: "/feed", label: "Feed" },
  { tab: "discover", href: "/discover", label: "Discover" },
  { tab: "map", href: "/map", label: "Map" },
];

/**
 * Where you are is the first job Atlas blue does: a 2px bar pinned to the
 * bottom edge of the header.
 *
 * One bar owned by the nav, not one per tab. Rendering it inside the active
 * link means it can only ever blink out under the old tab and blink in under
 * the new one; a single element can travel between them, which is the thing
 * that makes a tab bar feel connected rather than switched. Its position comes
 * from measuring the active link, because the tabs are label-width and there
 * is no arithmetic that predicts where "Discover" ends without asking.
 */
function NavTabs({ current }: { current: Tab | null }) {
  const navRef = useRef<HTMLElement>(null);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  // Withheld until after the first measured paint. Without it the bar animates
  // in from x=0 on every cold load, which reads as the page mis-rendering.
  const [travels, setTravels] = useState(false);

  const measure = useCallback(() => {
    const nav = navRef.current;
    const active = current
      ? nav?.querySelector<HTMLElement>(`[data-tab="${current}"]`)
      : null;
    if (!active) {
      setBox(null);
      return;
    }
    setBox({ left: active.offsetLeft, width: active.offsetWidth });
  }, [current]);

  // Layout effect, so the bar is already under the right tab on the frame the
  // new route paints rather than one frame later.
  useLayoutEffectSafe(measure, [measure]);

  // Tabs are as wide as their labels, and the labels are set in a webfont that
  // arrives after the first paint — so the widths this measured are not final
  // until it lands. Observing the links themselves catches that, along with
  // zoom and any future change to the set of tabs.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    for (const link of nav.querySelectorAll("[data-tab]")) observer.observe(link);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    if (!box || travels) return;
    const frame = requestAnimationFrame(() => setTravels(true));
    return () => cancelAnimationFrame(frame);
  }, [box, travels]);

  return (
    <nav className="relative flex h-full items-center gap-1" ref={navRef}>
      {TABS.map(({ tab, href, label }) => (
        <Link
          key={tab}
          href={href}
          data-tab={tab}
          aria-current={current === tab ? "page" : undefined}
          className={`flex h-16 items-center px-3.5 text-[15px] transition-colors duration-200 ${
            current === tab
              ? "font-medium text-[#14161A]"
              : "font-normal text-[#6B7178] hover:text-[#14161A]"
          }`}
        >
          {label}
        </Link>
      ))}
      {box && (
        <span
          aria-hidden
          className={`absolute bottom-[-1px] left-0 h-[2px] rounded-[2px] bg-[#0071E3] ${
            travels ? "nav-indicator" : ""
          }`}
          // Inset by the link's own 14px padding, so the bar is the width of
          // the label rather than the width of the tap target.
          style={{
            transform: `translateX(${box.left + 14}px)`,
            width: Math.max(0, box.width - 28),
          }}
        />
      )}
    </nav>
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
