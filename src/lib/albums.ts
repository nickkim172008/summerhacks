import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Album, Place } from "./types";

/** Albums predate sharing, so a missing memberIds still means "just the owner". */
export function albumMemberIds(album: Album): string[] {
  return album.memberIds?.length ? album.memberIds : [album.ownerId];
}

export function canEditAlbum(album: Album, uid: string | undefined): boolean {
  return Boolean(uid) && albumMemberIds(album).includes(uid as string);
}

function sortByCreatedDesc(albums: Album[]) {
  return [...albums].sort((a, b) => {
    const aTime = a.createdAt?.toMillis?.() ?? 0;
    const bTime = b.createdAt?.toMillis?.() ?? 0;
    return bTime - aTime;
  });
}

export function subscribeToAlbums(
  onChange: (albums: Album[]) => void,
  onError?: (error: Error) => void,
) {
  const q = query(collection(db, "albums"), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Album));
    },
    onError,
  );
}

export function subscribeToAlbumsByOwner(
  ownerId: string,
  onChange: (albums: Album[]) => void,
  onError?: (error: Error) => void,
) {
  const q = query(collection(db, "albums"), where("ownerId", "==", ownerId));
  return onSnapshot(
    q,
    (snap) => {
      onChange(
        sortByCreatedDesc(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Album),
        ),
      );
    },
    onError,
  );
}

/**
 * Every album this account may add to — owned and shared alike.
 *
 * Two listeners rather than one: albums created before sharing have no
 * memberIds at all, and array-contains skips a missing field, so querying
 * membership alone would drop every legacy album out of the owner's library.
 * Firestore cannot OR across two fields in one snapshot, so the results are
 * merged here, keyed by id to drop the overlap.
 */
export function subscribeToEditableAlbums(
  uid: string,
  onChange: (albums: Album[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const byOwner = new Map<string, Album>();
  const byMembership = new Map<string, Album>();

  function emit() {
    const merged = new Map([...byOwner, ...byMembership]);
    onChange(sortByCreatedDesc([...merged.values()]));
  }

  function collect(target: Map<string, Album>) {
    return (snap: { docs: { id: string; data: () => unknown }[] }) => {
      target.clear();
      for (const d of snap.docs) {
        target.set(d.id, { id: d.id, ...(d.data() as object) } as Album);
      }
      emit();
    };
  }

  const unsubOwner = onSnapshot(
    query(collection(db, "albums"), where("ownerId", "==", uid)),
    collect(byOwner),
    onError,
  );
  const unsubMember = onSnapshot(
    query(collection(db, "albums"), where("memberIds", "array-contains", uid)),
    collect(byMembership),
    onError,
  );

  return () => {
    unsubOwner();
    unsubMember();
  };
}

/**
 * Albums someone else put this account on. Owned albums are filtered out here
 * rather than in the query, since Firestore cannot express "array-contains me
 * AND ownerId is not me" without a second index.
 */
export function subscribeToAlbumsSharedWith(
  uid: string,
  onChange: (albums: Album[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, "albums"), where("memberIds", "array-contains", uid)),
    (snap) => {
      const shared = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Album)
        .filter((album) => album.ownerId !== uid);
      onChange(sortByCreatedDesc(shared));
    },
    onError,
  );
}

/**
 * Albums this account has been invited to but has not joined yet. Drives the
 * accept/decline rows in the inbox — membership alone is not enough, because
 * an invite that auto-joined never needed a reply.
 */
export function subscribeToAlbumInvites(
  uid: string,
  onChange: (albums: Album[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(
      collection(db, "albums"),
      where("pendingMemberIds", "array-contains", uid),
    ),
    (snap) => {
      onChange(
        sortByCreatedDesc(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Album),
        ),
      );
    },
    onError,
  );
}

export function subscribeToAlbum(
  albumId: string,
  onChange: (album: Album | null) => void,
  onError?: (error: Error) => void,
) {
  return onSnapshot(
    doc(db, "albums", albumId),
    (snap) => {
      onChange(
        snap.exists() ? ({ id: snap.id, ...snap.data() } as Album) : null,
      );
    },
    onError,
  );
}

export async function createAlbum(
  name: string,
  ownerId: string,
): Promise<string> {
  const albumRef = doc(collection(db, "albums"));
  await setDoc(albumRef, {
    name,
    ownerId,
    memberIds: [ownerId],
    placeIds: [],
    createdAt: serverTimestamp(),
  });
  return albumRef.id;
}

/**
 * Asks someone to join. They stay in pendingMemberIds until they accept from
 * the notification — landing them on memberIds immediately is what used to
 * skip that step. arrayUnion keeps a repeat invite harmless.
 */
export async function inviteCollaborator(
  album: Album,
  uid: string,
): Promise<void> {
  if (uid === album.ownerId) {
    throw new Error("The owner is already on this journey.");
  }
  if (albumMemberIds(album).includes(uid)) {
    throw new Error("They are already on this journey.");
  }
  await updateDoc(doc(db, "albums", album.id), {
    // Seed the owner so a pre-sharing album has a real memberIds before the
    // first accept — otherwise the invitee would be the only name on it.
    memberIds: arrayUnion(album.ownerId),
    pendingMemberIds: arrayUnion(uid),
    [`invitePendingAt.${uid}`]: serverTimestamp(),
  });
}

/**
 * The invitee joins: leave pending, enter members. The owner is seeded into
 * memberIds so albums created before sharing pick up a correct list on the
 * first accept instead of one that silently omits them.
 */
export async function acceptAlbumInvite(
  album: Album,
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, "albums", album.id), {
    memberIds: arrayUnion(...new Set([album.ownerId, uid])),
    pendingMemberIds: arrayRemove(uid),
    [`memberAddedAt.${uid}`]: serverTimestamp(),
    [`invitePendingAt.${uid}`]: deleteField(),
  });
}

/** The invitee turns the invite down — pending only, membership untouched. */
export async function declineAlbumInvite(
  album: Album,
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, "albums", album.id), {
    pendingMemberIds: arrayRemove(uid),
    [`invitePendingAt.${uid}`]: deleteField(),
  });
}

export async function removeCollaborator(
  album: Album,
  uid: string,
): Promise<void> {
  if (uid === album.ownerId) throw new Error("The owner can't be removed.");
  await updateDoc(doc(db, "albums", album.id), {
    memberIds: arrayRemove(uid),
    pendingMemberIds: arrayRemove(uid),
    [`memberAddedAt.${uid}`]: deleteField(),
    [`invitePendingAt.${uid}`]: deleteField(),
  });
}

/**
 * A collaborator steps off the journey. Same write as the owner kicking them,
 * but the caller is always the person leaving — rules refuse the owner, and
 * refuse removing anyone else.
 */
export async function leaveAlbum(album: Album, uid: string): Promise<void> {
  if (uid === album.ownerId) {
    throw new Error("The owner can’t leave — delete the journey instead.");
  }
  if (!albumMemberIds(album).includes(uid)) {
    throw new Error("You’re not on this journey.");
  }
  // Only touch membership fields. arrayRemove on pending is a no-op when the
  // uid isn’t pending, which keeps the pending list identical for rules.
  await updateDoc(doc(db, "albums", album.id), {
    memberIds: arrayRemove(uid),
    [`memberAddedAt.${uid}`]: deleteField(),
  });
}

export async function addPlacesToAlbum(albumId: string, placeIds: string[]) {
  if (placeIds.length === 0) return;
  await updateDoc(doc(db, "albums", albumId), {
    placeIds: arrayUnion(...placeIds),
  });
}

/**
 * Sets the album's own cover, or clears it with null. Cleared means deleted
 * rather than written empty: absence is what sends the cover back to the mosaic
 * of its contents, and an album that never had one has to look the same as one
 * that gave its up.
 */
/**
 * Takes places out of an album without touching the places themselves — they
 * stay in the library and in any other album holding them. An album is a
 * grouping, so leaving one is not the same as being deleted, and conflating the
 * two would make tidying a collection destroy captures.
 */
export async function removePlacesFromAlbum(
  albumId: string,
  placeIds: string[],
) {
  if (placeIds.length === 0) return;
  await updateDoc(doc(db, "albums", albumId), {
    placeIds: arrayRemove(...placeIds),
  });
}

export async function updateAlbumCover(
  albumId: string,
  coverUrl: string | null,
) {
  await updateDoc(doc(db, "albums", albumId), {
    coverUrl: coverUrl ?? deleteField(),
  });
}

/**
 * The album's places, in the order the album lists them, skipping ids whose
 * place has not loaded — or belongs to someone else, which is what a shared
 * album looks like from a reader who can only see their own captures.
 */
export function resolveAlbumPlaces(
  placeIds: string[] | undefined,
  placeById: Map<string, Place>,
): Place[] {
  return (placeIds ?? [])
    .map((id) => placeById.get(id))
    .filter((place): place is Place => Boolean(place));
}
