"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthProfile } from "@/lib/auth";
import { claimUsername, validateUsername } from "@/lib/profiles";
import AtlasLogo from "@/components/AtlasLogo";

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
    if (profile) router.replace("/");
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
      await claimUsername(user.uid, username, {
        displayName: user.displayName,
        photoURL: user.photoURL,
      });
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save username");
      setSaving(false);
    }
  }

  if (loading || !needsUsername) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#FAF9F7] text-[15px] text-[#6B7178]">
        Loading…
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#FAF9F7] text-[#14161A]">
      <nav className="border-b border-[rgba(20,22,26,0.09)] bg-[rgba(250,249,247,0.92)] backdrop-blur-xl">
        <div className="flex h-16 items-center px-8">
          <Link href="/" aria-label="Atlas home">
            <AtlasLogo priority className="h-auto w-[78px]" />
          </Link>
        </div>
      </nav>

      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-8">
        <h1 className="font-display text-[40px] font-normal leading-[40px] tracking-[-0.02em]">
          Choose a username
        </h1>
        <p className="mt-3 text-[15px] leading-6 text-[#4A4F57]">
          This is how people find your journeys and places.
        </p>

        <div className="mt-8">
          <div className="flex items-center rounded-xl border border-[rgba(20,22,26,0.12)] bg-white px-3 transition focus-within:border-[#0071E3]">
            <span className="text-[15px] text-[#6B7178]">@</span>
            <input
              autoFocus
              value={username}
              onChange={(e) => {
                setUsername(e.target.value.toLowerCase());
                setError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="summerhacks"
              className="w-full bg-transparent px-1 py-2.5 text-[15px] outline-none placeholder:text-[#8A9098]"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <p className="mt-2 text-[13px] leading-[18px] text-[#6B7178]">
            3–20 characters. Letters, numbers, underscore.
          </p>
          {error && (
            <p className="mt-2 text-[13px] leading-[18px] text-[#C0362C]">
              {error}
            </p>
          )}
        </div>

        <button
          onClick={save}
          disabled={saving || !username.trim()}
          className="mt-6 h-10 rounded-full bg-[#14161A] px-6 text-[15px] font-medium text-white transition hover:bg-[#2A2E35] disabled:opacity-40"
        >
          {saving ? "Saving…" : "Continue"}
        </button>
      </div>
    </main>
  );
}
