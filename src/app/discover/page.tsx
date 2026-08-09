"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthProfile } from "@/lib/auth";
import {
  filterDemoOrganizers,
  isDemoOrganizerProfile,
} from "@/lib/demoOrganizers";
import {
  searchProfiles,
  subscribeToRecentProfiles,
} from "@/lib/profiles";
import Avatar from "@/components/Avatar";
import type { Profile } from "@/lib/types";

const DEBOUNCE_MS = 250;

export default function DiscoverPage() {
  const { user } = useAuthProfile();
  const [term, setTerm] = useState("");
  const [recent, setRecent] = useState<Profile[] | null>(null);
  const [results, setResults] = useState<Profile[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => subscribeToRecentProfiles(setRecent), []);

  // Debounced so a query does not fire on every keystroke. The stale guard
  // matters more than the delay: results can land out of order, and without it
  // a slow "ay" would overwrite a fast "aydan".
  useEffect(() => {
    const trimmed = term.trim();
    if (!trimmed) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const found = await searchProfiles(trimmed);
        if (!stale) setResults(found);
      } finally {
        if (!stale) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [term]);

  const isSearch = Boolean(term.trim());
  const realPool = results ?? recent;
  const realShowing = (realPool ?? []).filter(
    (profile) => profile.id !== user?.uid,
  );
  const demoShowing = filterDemoOrganizers(term);
  // Organizers first so scrolling Discover always surfaces the team.
  const showing = [...demoShowing, ...realShowing];

  return (
    <main className="min-h-screen bg-[#FAF9F7] text-[#14161A]">
      <div className="mx-auto w-full max-w-[880px] px-8 py-11">
        <h1 className="font-display text-[44px] leading-[44px] font-normal tracking-[-0.02em]">
          Discover
        </h1>
        <div className="relative mt-6">
          {/* Magnifier sits inside the field, so the input owns the whole
              52px target and keeps its own focus border. */}
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="#6B7178"
            aria-hidden="true"
            className="pointer-events-none absolute left-[18px] top-1/2 -translate-y-1/2"
          >
            <path d="M10.5 3a7.5 7.5 0 1 0 4.55 13.46l4.24 4.25a1 1 0 0 0 1.42-1.42l-4.25-4.24A7.5 7.5 0 0 0 10.5 3Zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z" />
          </svg>
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search by name or handle"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="h-[52px] w-full rounded-[14px] border border-[rgba(20,22,26,0.12)] bg-white pl-[48px] pr-[18px] text-[16px] shadow-[0_1px_2px_rgba(20,22,26,0.04)] transition-colors duration-150 ease-linear placeholder:text-[#8A9098] focus:border-[#0071E3]"
          />
        </div>
        <h2 className="mt-9 text-[11px] leading-3 font-semibold tracking-[0.12em] uppercase text-[#6B7178]">
          {isSearch ? "Results" : "People"}
        </h2>

        {showing.length === 0 ? (
          <p className="mt-4 text-[15px] text-[#6B7178]">
            {isSearch && searching
              ? "Searching…"
              : isSearch
                ? `No one matches “${term.trim()}”.`
                : "No accounts yet."}
          </p>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-4">
            {showing.map((profile) => (
              <PersonRow key={profile.id} profile={profile} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

const CARD =
  "flex items-center gap-3.5 rounded-2xl border border-[rgba(20,22,26,0.09)] bg-white p-4 shadow-[0_1px_2px_rgba(20,22,26,0.04)]";

function PersonRow({ profile }: { profile: Profile }) {
  const demo = isDemoOrganizerProfile(profile);
  const body = (
    <>
      <Avatar
        profile={profile}
        className="h-12 w-12"
        textClassName="text-[17px]"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[18px] leading-6 tracking-[-0.01em]">
          {profile.displayName}
        </p>
        <p className="mt-px truncate text-[13px] text-[#6B7178]">
          @{profile.username}
        </p>
        {profile.bio && (
          <p className="mt-1.5 truncate text-[13px] leading-[1.5] text-[#4A4F57]">
            {profile.bio}
          </p>
        )}
      </div>
    </>
  );

  return (
    <li>
      {/* Organizer rows are display-only seed data, not Firebase accounts —
          there is no profile page behind them, so they are not links. */}
      {demo ? (
        <div className={CARD}>{body}</div>
      ) : (
        <Link
          href={`/u/${profile.username}`}
          className={`${CARD} transition-colors duration-150 ease-linear hover:border-[rgba(20,22,26,0.14)]`}
        >
          {body}
        </Link>
      )}
    </li>
  );
}
