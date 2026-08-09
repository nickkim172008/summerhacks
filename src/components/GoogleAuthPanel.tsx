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
import AtlasLogo from "@/components/AtlasLogo";

export type AuthMode = "signin" | "signup";

const COPY = {
  signin: {
    title: "Welcome back",
    action: "Continue with Google",
    busy: "Signing in…",
    switchText: "New here?",
    switchLabel: "Create an account",
    switchHref: "/signup",
    failure: "Sign-in failed",
  },
  signup: {
    title: "Start capturing",
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
    <main className="auth-shell relative flex min-h-screen flex-col overflow-hidden text-[#14161A]">
      <div aria-hidden className="auth-glow auth-glow-a" />
      <div aria-hidden className="auth-glow auth-glow-b" />
      <div aria-hidden className="auth-grain" />

      {/* The switch to the other mode lives under the form, next to the line
          that explains it — offering it twice on one screen just competes. */}
      <nav className="relative z-10 flex w-full items-center px-8 py-5">
        <Link
          href="/"
          aria-label="Atlas home"
          className="transition hover:opacity-80"
        >
          <AtlasLogo priority className="h-auto w-[78px]" />
        </Link>
      </nav>

      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-8 pb-16 pt-6">
        <div className="auth-rise">
          <AtlasLogo
            priority
            className="h-auto w-[min(100%,18rem)] drop-shadow-sm"
          />
          <h1 className="auth-brand mt-8 font-display text-[40px] font-normal leading-[42px] tracking-[-0.02em]">
            {copy.title}
          </h1>
        </div>

        {!isFirebaseConfigured && (
          <p className="auth-rise-delay mt-8 text-[13px] leading-[18px] text-amber-700">
            Firebase isn&apos;t configured. Add your keys to{" "}
            <code className="rounded bg-[rgba(20,22,26,0.05)] px-1.5 py-0.5">
              .env.local
            </code>{" "}
            and restart the server.
          </p>
        )}

        {loading ? (
          <p className="auth-rise-delay mt-12 text-[15px] text-[#6B7178]">
            Checking session…
          </p>
        ) : user ? (
          <div className="auth-rise-delay mt-12 space-y-4">
            <p className="text-[15px] leading-6 text-[#4A4F57]">
              Signed in as{" "}
              <span className="font-medium text-[#14161A]">
                {user.displayName ?? user.email}
              </span>
            </p>
            <button
              onClick={() => signOut()}
              className="h-12 w-full rounded-full border border-[rgba(20,22,26,0.14)] bg-white/70 px-6 text-[15px] font-medium text-[#14161A] backdrop-blur transition hover:bg-white"
            >
              Sign Out
            </button>
          </div>
        ) : (
          <div className="auth-rise-delay mt-12 space-y-5">
            <button
              onClick={handleGoogle}
              disabled={!isFirebaseConfigured || busy}
              className="auth-cta group flex h-14 w-full items-center justify-center gap-3 rounded-full bg-[#14161A] px-6 text-[15px] font-medium text-white transition hover:bg-[#2A2E35] disabled:opacity-40"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white">
                <GoogleMark />
              </span>
              {busy ? copy.busy : copy.action}
            </button>

            {error && (
              <p className="rounded-2xl bg-[rgba(192,54,44,0.08)] px-4 py-3 text-[14px] leading-relaxed text-[#C0362C]">
                {error}
              </p>
            )}

            <p className="text-center text-[13px] leading-[18px] text-[#6B7178]">
              {copy.switchText}{" "}
              <Link
                href={copy.switchHref}
                className="font-medium text-[#14161A] transition hover:text-[#4A4F57]"
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
