"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isFirebaseConfigured } from "@/lib/firebase";
import {
  describeAuthError,
  signInWithGoogle,
  signOut,
  useAuth,
} from "@/lib/auth";
import { getProfile } from "@/lib/profiles";

export type AuthMode = "signin" | "signup";

const COPY = {
  signin: {
    title: "Welcome back",
    subtitle: "Pick up where you left off — albums, walks, and shared places.",
    action: "Continue with Google",
    busy: "Signing in…",
    switchText: "New here?",
    switchLabel: "Create an account",
    switchHref: "/signup",
    failure: "Sign-in failed",
  },
  signup: {
    title: "Start capturing",
    subtitle:
      "Save walkable environments, organize them into albums, and claim your profile.",
    action: "Sign up with Google",
    busy: "Creating account…",
    switchText: "Already have an account?",
    switchLabel: "Sign in",
    switchHref: "/signin",
    failure: "Sign-up failed",
  },
} as const;

export default function GoogleAuthPanel({ mode }: { mode: AuthMode }) {
  const copy = COPY[mode];
  const router = useRouter();
  const { user, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user || busy) return;
    let cancelled = false;
    void getProfile(user.uid)
      .then((existing) => {
        if (!cancelled) router.replace(existing ? "/" : "/setup");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeAuthError(err, copy.failure));
      });
    return () => {
      cancelled = true;
    };
  }, [busy, copy.failure, loading, router, user]);

  async function handleGoogle() {
    setError(null);
    setBusy(true);
    try {
      const signedIn = await signInWithGoogle();
      // Sign-up should not depend on a Firestore read immediately after Auth
      // creates the account. Setup will detect and redirect existing profiles.
      if (mode === "signup") {
        router.replace("/setup");
        return;
      }
      const existing = await getProfile(signedIn.uid);
      router.replace(existing ? "/" : "/setup");
    } catch (err) {
      setError(describeAuthError(err, copy.failure));
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell relative flex min-h-screen flex-col overflow-hidden text-[#1d1d1f]">
      <div aria-hidden className="auth-glow auth-glow-a" />
      <div aria-hidden className="auth-glow auth-glow-b" />
      <div aria-hidden className="auth-grain" />

      <nav className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <Link
          href="/"
          className="text-[15px] font-semibold tracking-tight text-[#1d1d1f]/80 transition hover:text-[#1d1d1f]"
        >
          Photos
        </Link>
        <Link
          href={copy.switchHref}
          className="text-[13px] font-medium text-[#0071e3] transition hover:text-[#0077ed]"
        >
          {copy.switchLabel}
        </Link>
      </nav>

      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 pb-16 pt-6">
        <div className="auth-rise">
          <p className="auth-brand text-[clamp(3.25rem,12vw,5.5rem)] font-bold leading-[0.9] tracking-[-0.04em]">
            Photos
          </p>
          <h1 className="mt-6 text-[28px] font-semibold tracking-tight text-[#1d1d1f] sm:text-[32px]">
            {copy.title}
          </h1>
          <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-neutral-600">
            {copy.subtitle}
          </p>
        </div>

        {!isFirebaseConfigured && (
          <p className="auth-rise-delay mt-8 text-sm text-amber-700">
            Firebase isn&apos;t configured. Add your keys to{" "}
            <code className="rounded bg-black/5 px-1.5 py-0.5">.env.local</code>{" "}
            and restart the server.
          </p>
        )}

        {loading ? (
          <p className="auth-rise-delay mt-12 text-sm text-neutral-500">
            Checking session…
          </p>
        ) : user ? (
          <div className="auth-rise-delay mt-12 space-y-4">
            <p className="text-sm text-neutral-600">
              Signed in as{" "}
              <span className="font-medium text-[#1d1d1f]">
                {user.displayName ?? user.email}
              </span>
            </p>
            <button
              onClick={() => signOut()}
              className="w-full rounded-full border border-black/10 bg-white/70 px-6 py-3 text-[15px] font-medium backdrop-blur transition hover:bg-white"
            >
              Sign Out
            </button>
          </div>
        ) : (
          <div className="auth-rise-delay mt-12 space-y-5">
            <button
              onClick={handleGoogle}
              disabled={!isFirebaseConfigured || busy}
              className="auth-cta group flex w-full items-center justify-center gap-3 rounded-full bg-[#1d1d1f] px-6 py-3.5 text-[15px] font-medium text-white transition hover:bg-black disabled:opacity-40"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white">
                <GoogleMark />
              </span>
              {busy ? copy.busy : copy.action}
            </button>

            {error && (
              <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-600">
                {error}
              </p>
            )}

            <p className="text-center text-[13px] text-neutral-500">
              {copy.switchText}{" "}
              <Link
                href={copy.switchHref}
                className="font-medium text-[#0071e3] transition hover:text-[#0077ed]"
              >
                {copy.switchLabel}
              </Link>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
