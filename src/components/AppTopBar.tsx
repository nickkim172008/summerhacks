"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AtlasLogo from "@/components/AtlasLogo";
import Avatar from "@/components/Avatar";
import { signOut, useAuthProfile } from "@/lib/auth";
import { shouldHideAppChrome } from "@/lib/appChrome";
import { useNotifications } from "@/lib/notifications";

/** Sticky Atlas mark — mount once from the root layout. */
export default function AppTopBar() {
  const pathname = usePathname() ?? "/";
  const { user, profile, loading } = useAuthProfile();

  if (shouldHideAppChrome(pathname)) return null;

  return (
    <header className="sticky top-0 z-40 border-b border-black/10 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex h-13 max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/" aria-label="Atlas home" className="shrink-0">
          <AtlasLogo priority className="h-auto w-[92px]" />
        </Link>

        <div className="flex items-center gap-3">
          {loading ? null : profile ? (
            <>
              <NotificationsBell uid={profile.id} />
              <Link
                href={`/u/${profile.username}`}
                aria-label={`Your profile, @${profile.username}`}
                title={`@${profile.username}`}
                className="rounded-full ring-black/10 transition hover:ring-2"
              >
                <Avatar profile={profile} />
              </Link>
              <button
                onClick={() => signOut()}
                className="rounded-full border border-[#0071e3]/25 px-3 py-1.5 text-[13px] font-medium text-[#0071e3] transition hover:border-[#0071e3]/40 hover:bg-[#0071e3]/5"
              >
                Sign Out
              </button>
            </>
          ) : user ? (
            <Link href="/setup" className="text-[13px] text-[#0071e3]">
              Finish setup
            </Link>
          ) : (
            <>
              <Link href="/signin" className="text-[13px] text-[#0071e3]">
                Sign In
              </Link>
              <Link
                href="/signup"
                className="rounded-full bg-[#0071e3] px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-[#0077ed]"
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
      className="relative flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-100 hover:text-[#1d1d1f]"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
        <path d="M12 2a6 6 0 0 0-6 6v3.6l-1.4 2.8A1 1 0 0 0 5.5 16h13a1 1 0 0 0 .9-1.45L18 11.6V8a6 6 0 0 0-6-6Zm0 20a2.75 2.75 0 0 0 2.75-2.5h-5.5A2.75 2.75 0 0 0 12 22Z" />
      </svg>
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff3b30] px-1 text-[10px] font-semibold leading-none text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
