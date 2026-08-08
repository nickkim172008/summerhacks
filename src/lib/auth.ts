"use client";

import { useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
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

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
}

export async function signOut() {
  return firebaseSignOut(auth);
}
