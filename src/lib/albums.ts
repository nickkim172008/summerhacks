import {
  arrayUnion,
  collection,
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
import type { Album } from "./types";

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
) {
  return onSnapshot(doc(db, "albums", albumId), (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as Album) : null);
  });
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
