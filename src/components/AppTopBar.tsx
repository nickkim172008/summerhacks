"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AtlasLogo from "@/components/AtlasLogo";
import Avatar from "@/components/Avatar";
import { signOut, useAuthProfile } from "@/lib/auth";
import { shouldHideAppChrome } from "@/lib/appChrome";

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
