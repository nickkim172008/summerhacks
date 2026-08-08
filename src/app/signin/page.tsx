"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isFirebaseConfigured } from "@/lib/firebase";
import { signInWithGoogle, signOut, useAuthProfile } from "@/lib/auth";
import { getProfile } from "@/lib/profiles";

export default function SignInPage() {
  const router = useRouter();
  const { user, profile, loading } = useAuthProfile();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (profile) router.replace(`/u/${profile.username}`);
    else if (user) router.replace("/setup");
  }, [user, profile, loading, router]);

  async function handleGoogle() {
    setError(null);
    setBusy(true);
    try {
      const cred = await signInWithGoogle();
      const existing = await getProfile(cred.user.uid);
      router.replace(existing ? `/u/${existing.username}` : "/setup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
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
        <h1 className="text-[34px] font-bold tracking-tight">Sign In</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Sign in to create albums, share environments, and collaborate with
          friends.
        </p>

        {!isFirebaseConfigured && (
          <p className="mt-6 text-sm text-amber-600">
            Firebase isn&apos;t configured. Add your keys to{" "}
            <code>.env.local</code> and restart the server.
          </p>
        )}

        {loading ? (
          <p className="mt-10 text-sm text-neutral-500">Checking session…</p>
        ) : user ? (
          <div className="mt-10 space-y-4">
            <p className="text-sm text-neutral-600">
              Signed in as{" "}
              <span className="font-medium text-[#1d1d1f]">
                {user.displayName ?? user.email}
              </span>
            </p>
            <button
              onClick={() => signOut()}
              className="w-full rounded-full border border-black/10 px-6 py-2.5 text-[15px] font-medium transition hover:bg-neutral-50"
            >
              Sign Out
            </button>
          </div>
        ) : (
          <div className="mt-10 space-y-3">
            <button
              onClick={handleGoogle}
              disabled={!isFirebaseConfigured || busy}
              className="flex w-full items-center justify-center gap-3 rounded-full bg-[#0071e3] px-6 py-2.5 text-[15px] font-medium text-white transition hover:bg-[#0077ed] disabled:opacity-40"
            >
              <GoogleMark />
              {busy ? "Signing in…" : "Continue with Google"}
            </button>
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
        )}
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="#fff"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#fff"
        opacity=".9"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#fff"
        opacity=".75"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#fff"
        opacity=".85"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
