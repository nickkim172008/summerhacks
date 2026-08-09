import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Follow } from "./types";

/**
 * One doc per follow edge, in a flat `follows` collection.
 *
 * The id is derived from the pair rather than random, which makes following
 * twice impossible (a second write lands on the same doc) and unfollowing a
 * direct delete instead of a query-then-delete. It is also what the security
 * rule checks: you can only write an edge whose first half is your own uid.
 *
 * Both count queries filter on a single field, so Firestore's automatic
 * indexes cover them — there is no composite index to create.
 */
function followId(followerId: string, followingId: string) {
  return `${followerId}_${followingId}`;
}

export async function follow(followerId: string, followingId: string) {
  if (followerId === followingId) return;
  await setDoc(doc(db, "follows", followId(followerId, followingId)), {
    followerId,
    followingId,
    createdAt: serverTimestamp(),
  });
}

export async function unfollow(followerId: string, followingId: string) {
  await deleteDoc(doc(db, "follows", followId(followerId, followingId)));
}

/** Whether `followerId` currently follows `followingId`. */
export function subscribeToIsFollowing(
  followerId: string,
  followingId: string,
  onChange: (isFollowing: boolean) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, "follows", followId(followerId, followingId)),
    (snap) => onChange(snap.exists()),
    onError,
  );
}

/** How many people follow `uid`. */
export function subscribeToFollowerCount(
  uid: string,
  onChange: (count: number) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const q = query(collection(db, "follows"), where("followingId", "==", uid));
  return onSnapshot(q, (snap) => onChange(snap.size), onError);
}

/** How many people `uid` follows. */
export function subscribeToFollowingCount(
  uid: string,
  onChange: (count: number) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const q = query(collection(db, "follows"), where("followerId", "==", uid));
  return onSnapshot(q, (snap) => onChange(snap.size), onError);
}

/** The edges themselves, newest first — who followed `uid`, and when. */
export function subscribeToFollowers(
  uid: string,
  onChange: (follows: Follow[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const q = query(collection(db, "follows"), where("followingId", "==", uid));
  return onSnapshot(
    q,
    (snap) =>
      onChange(
        // Sorted here rather than with orderBy: pairing it with the where
        // would need a composite index, and these sets are small.
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as Follow)
          .sort((a, b) => millis(b.createdAt) - millis(a.createdAt)),
      ),
    onError,
  );
}

/** The uids `uid` follows, for fetching what they have posted. */
export function subscribeToFollowingIds(
  uid: string,
  onChange: (ids: string[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const q = query(collection(db, "follows"), where("followerId", "==", uid));
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => (d.data() as Follow).followingId)),
    onError,
  );
}

function millis(at: Follow["createdAt"]) {
  return at?.toMillis?.() ?? 0;
}
