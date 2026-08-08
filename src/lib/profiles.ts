import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Profile } from "./types";

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function normalizeUsername(raw: string) {
  return raw.trim().toLowerCase();
}

export function validateUsername(raw: string): string | null {
  const username = normalizeUsername(raw);
  if (!USERNAME_RE.test(username)) {
    return "Use 3–20 characters: lowercase letters, numbers, or _";
  }
  return null;
}

export function subscribeToProfile(
  uid: string,
  onChange: (profile: Profile | null) => void,
): Unsubscribe {
  return onSnapshot(doc(db, "profiles", uid), (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as Profile) : null);
  });
}

export async function getProfile(uid: string): Promise<Profile | null> {
  const snap = await getDoc(doc(db, "profiles", uid));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Profile) : null;
}

export function subscribeToProfileByUsername(
  username: string,
  onChange: (profile: Profile | null) => void,
): Unsubscribe {
  const normalized = normalizeUsername(username);
  const q = query(
    collection(db, "profiles"),
    where("username", "==", normalized),
  );
  return onSnapshot(q, (snap) => {
    const first = snap.docs[0];
    onChange(
      first ? ({ id: first.id, ...first.data() } as Profile) : null,
    );
  });
}

/**
 * Claims a username for this uid. Uses a usernames/{name} lock doc so two
 * people can't take the same handle.
 */
export async function claimUsername(
  uid: string,
  rawUsername: string,
  extras: { displayName?: string | null; photoURL?: string | null },
): Promise<Profile> {
  const username = normalizeUsername(rawUsername);
  const invalid = validateUsername(username);
  if (invalid) throw new Error(invalid);

  const profileRef = doc(db, "profiles", uid);
  const usernameRef = doc(db, "usernames", username);

  await runTransaction(db, async (tx) => {
    const [profileSnap, usernameSnap] = await Promise.all([
      tx.get(profileRef),
      tx.get(usernameRef),
    ]);

    if (profileSnap.exists()) {
      throw new Error("You already have a username.");
    }
    if (usernameSnap.exists()) {
      throw new Error("That username is taken.");
    }

    tx.set(usernameRef, { uid });
    tx.set(profileRef, {
      username,
      displayName: extras.displayName?.trim() || username,
      photoURL: extras.photoURL ?? "",
      createdAt: serverTimestamp(),
    });
  });

  const created = await getProfile(uid);
  if (!created) throw new Error("Could not create profile.");
  return created;
}

export const BIO_MAX_LENGTH = 280;

export async function updateBio(uid: string, bio: string): Promise<void> {
  await updateDoc(doc(db, "profiles", uid), {
    bio: bio.trim().slice(0, BIO_MAX_LENGTH),
  });
}
