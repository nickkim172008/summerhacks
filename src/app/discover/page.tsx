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
    <main className="min-h-screen bg-white pb-24 text-[#1d1d1f]">
      <div className="mx-auto max-w-2xl px-6">
        <h1 className="mt-8 text-[34px] font-bold tracking-tight">People</h1>

        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search by username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="mt-6 w-full rounded-xl border border-black/10 bg-neutral-50 px-4 py-2.5 text-[15px] outline-none focus:border-[#0071e3]"
        />
        <p className="mt-2 text-[13px] text-neutral-400">
          Handles match from the start — “ayd” finds “aydan”.
        </p>

        <h2 className="mt-8 text-[13px] font-semibold uppercase tracking-wider text-neutral-500">
          {isSearch ? "Results" : "People"}
        </h2>

        {showing.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500">
            {isSearch && searching
              ? "Searching…"
              : isSearch
                ? `No one matches “${term.trim()}”.`
                : "No accounts yet."}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-black/5">
            {showing.map((profile) => (
              <PersonRow key={profile.id} profile={profile} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function PersonRow({ profile }: { profile: Profile }) {
  const demo = isDemoOrganizerProfile(profile);
  const body = (
    <>
      {profile.photoURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profile.photoURL}
          alt=""
          className="h-11 w-11 shrink-0 rounded-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[15px] font-semibold text-neutral-500">
          {profile.username.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium">
          {profile.displayName}
        </p>
        <p className="truncate text-[13px] text-neutral-500">
          @{profile.username}
        </p>
        {profile.bio && (
          <p className="truncate text-[12px] text-neutral-400 sm:hidden">
            {profile.bio}
          </p>
        )}
      </div>
      {profile.bio && (
        <p className="hidden max-w-[45%] truncate text-[13px] text-neutral-400 sm:block">
          {profile.bio}
        </p>
      )}
    </>
  );

  return (
    <li>
      {demo ? (
        <div className="flex items-center gap-3 py-3">{body}</div>
      ) : (
        <Link
          href={`/u/${profile.username}`}
          className="flex items-center gap-3 py-3 transition hover:opacity-70"
        >
          {body}
        </Link>
      )}
    </li>
  );
}
