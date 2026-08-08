import {
  collection,
  doc,
  endAt,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAt,
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

export const PROFILE_SEARCH_LIMIT = 20;

/**
 * Handle search, matched by prefix.
 *
 * Firestore has no substring or full-text search, so "ayd" finds "aydan" but
 * nothing finds "dan" inside it. Prefix is the normal shape for handles.
 * The endAt sentinel is U+F8FF, which sorts above every character a username
 * can contain, so the range [term, term + U+F8FF] spans exactly the strings
 * beginning with term. Ordered on one field, so the automatic index covers it.
 */
export async function searchProfiles(rawTerm: string): Promise<Profile[]> {
  const term = normalizeUsername(rawTerm);
  if (!term) return [];
  const snap = await getDocs(
    query(
      collection(db, "profiles"),
      orderBy("username"),
      startAt(term),
      endAt(`${term}`),
      limit(PROFILE_SEARCH_LIMIT),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Profile);
}

/** Newest accounts, for an empty search box to have something to show. */
export function subscribeToRecentProfiles(
  onChange: (profiles: Profile[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db, "profiles"),
    orderBy("createdAt", "desc"),
    limit(PROFILE_SEARCH_LIMIT),
  );
  return onSnapshot(
    q,
    (snap) =>
      onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Profile)),
    onError,
  );
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

export async function updatePhotoURL(
  uid: string,
  photoURL: string,
): Promise<void> {
  await updateDoc(doc(db, "profiles", uid), { photoURL });
}

/**
 * Downscale + center-crop to a square JPEG so avatars stay small and consistent.
 */
export async function prepareProfilePhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error("That image is too large. Try one under 12 MB.");
  }

  const bitmap = await createImageBitmap(file);
  const size = 512;
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const drawW = bitmap.width * scale;
  const drawH = bitmap.height * scale;
  const dx = (size - drawW) / 2;
  const dy = (size - drawH) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Could not process that image.");
  }
  ctx.fillStyle = "#f5f5f7";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bitmap, dx, dy, drawW, drawH);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.88),
  );
  if (!blob) throw new Error("Could not process that image.");
  return blob;
}
