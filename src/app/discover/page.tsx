"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthProfile } from "@/lib/auth";
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

  const showing = results ?? recent;
  const isSearch = Boolean(term.trim());

  return (
    <main className="min-h-screen bg-white pb-24 text-[#1d1d1f]">
      <nav className="sticky top-0 z-20 border-b border-black/10 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-13 max-w-5xl items-center px-6 py-3">
          <span className="text-sm font-semibold tracking-tight">Discover</span>
        </div>
      </nav>

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
          {isSearch ? "Results" : "Newest"}
        </h2>

        {showing === null || (isSearch && searching && results === null) ? (
          <p className="mt-4 text-sm text-neutral-500">
            {isSearch ? "Searching…" : "Loading…"}
          </p>
        ) : showing.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500">
            {isSearch
              ? `No one matches “${term.trim()}”.`
              : "No accounts yet."}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-black/5">
            {showing.map((profile) => (
              <PersonRow
                key={profile.id}
                profile={profile}
                isYou={profile.id === user?.uid}
              />
            ))}
          </ul>
        )}
      </div>

    </main>
  );
}

function PersonRow({
  profile,
  isYou,
}: {
  profile: Profile;
  isYou: boolean;
}) {
  return (
    <li>
      <Link
        href={`/u/${profile.username}`}
        className="flex items-center gap-3 py-3 transition hover:opacity-70"
      >
        {profile.photoURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.photoURL}
            alt=""
            className="h-11 w-11 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[15px] font-semibold text-neutral-500">
            {profile.username.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">
            {profile.displayName}
            {isYou && (
              <span className="ml-2 text-[13px] font-normal text-neutral-400">
                You
              </span>
            )}
          </p>
          <p className="truncate text-[13px] text-neutral-500">
            @{profile.username}
          </p>
        </div>
        {profile.bio && (
          <p className="hidden max-w-[45%] truncate text-[13px] text-neutral-400 sm:block">
            {profile.bio}
          </p>
        )}
      </Link>
    </li>
  );
}
