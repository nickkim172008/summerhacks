"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthProfile } from "@/lib/auth";
import { claimUsername, validateUsername } from "@/lib/profiles";

export default function SetupUsernamePage() {
  const router = useRouter();
  const { user, profile, loading, needsUsername } = useAuthProfile();
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/signin");
      return;
    }
    if (profile) router.replace(`/u/${profile.username}`);
  }, [user, profile, loading, router]);

  async function save() {
    if (!user || saving) return;
    const invalid = validateUsername(username);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await claimUsername(user.uid, username, {
        displayName: user.displayName,
        photoURL: user.photoURL,
      });
      router.replace(`/u/${created.username}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save username");
      setSaving(false);
    }
  }

  if (loading || !needsUsername) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white text-neutral-500">
        Loading…
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-white text-[#1d1d1f]">
      <nav className="border-b border-black/10 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center px-6 py-3">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Photos
          </Link>
        </div>
      </nav>

      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 pb-20">
        <h1 className="text-[34px] font-bold tracking-tight">
          Choose a username
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          This is how people find your albums and environments.
        </p>

        <div className="mt-8">
          <div className="flex items-center rounded-xl border border-black/10 bg-neutral-50 px-3 focus-within:border-[#0071e3]">
            <span className="text-[15px] text-neutral-400">@</span>
            <input
              autoFocus
              value={username}
              onChange={(e) => {
                setUsername(e.target.value.toLowerCase());
                setError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="summerhacks"
              className="w-full bg-transparent px-1 py-2.5 text-[15px] outline-none"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            3–20 characters. Letters, numbers, underscore.
          </p>
          {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        </div>

        <button
          onClick={save}
          disabled={saving || !username.trim()}
          className="mt-6 rounded-full bg-[#0071e3] px-6 py-2.5 text-[15px] font-medium text-white transition hover:bg-[#0077ed] disabled:opacity-40"
        >
          {saving ? "Saving…" : "Continue"}
        </button>
      </div>
    </main>
  );
}
