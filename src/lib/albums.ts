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
} from "firebase/firestore";
import { db } from "./firebase";
import type { Album, Place } from "./types";

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
    placeIds: [],
    createdAt: serverTimestamp(),
  });
  return albumRef.id;
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
