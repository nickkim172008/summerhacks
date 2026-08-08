"use client";

import { useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { auth, isFirebaseConfigured } from "./firebase";
import { subscribeToProfile } from "./profiles";
import type { Profile } from "./types";

export function useAuth() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setUser(null);
      return;
    }
    return onAuthStateChanged(auth, setUser);
  }, []);

  return {
    user,
    loading: user === undefined,
  };
}

/** Auth user + their profile (null if signed in but no username yet). */
export function useAuthProfile() {
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setProfile(null);
      return;
    }
    setProfile(undefined);
    return subscribeToProfile(user.uid, setProfile);
  }, [user, authLoading]);

  return {
    user,
    profile,
    loading: authLoading || (Boolean(user) && profile === undefined),
    needsUsername: Boolean(user && profile === null),
  };
}

/** Google creates the Firebase Auth account automatically on first use. */
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  /**
   * The popup backgrounds this tab, so Firebase's default IndexedDB persistence
   * closes its connection and rejects the write-back with "Database is
   * closing/hidden". localStorage has no such page-lifecycle handling.
   */
  await setPersistence(auth, browserLocalPersistence);

  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

/** Turn Firebase auth failures into something the user can act on. */
export function describeAuthError(err: unknown, fallback: string) {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : "";

  switch (code) {
    case "auth/popup-blocked":
      return "Your browser blocked the popup. Allow popups for this site, then try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "The Google window closed before finishing. Try again.";
    case "auth/unauthorized-domain":
      return "This domain isn’t listed under Firebase Auth → Settings → Authorized domains.";
    case "auth/operation-not-allowed":
      return "Enable Google as a sign-in provider in the Firebase console.";
    case "auth/network-request-failed":
      return "Couldn’t reach Firebase. Check your connection and try again.";
    default:
      break;
  }

  if (err instanceof Error && err.message.includes("closing/hidden")) {
    return "Sign-in was interrupted while the tab was in the background. Try again.";
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

export async function signOut() {
  return firebaseSignOut(auth);
}
