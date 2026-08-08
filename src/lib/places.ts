import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "./firebase";
import type { AudioPin, Place } from "./types";

export function subscribeToPlaces(onChange: (places: Place[]) => void) {
  const q = query(collection(db, "places"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Place));
  });
}

export function subscribeToPins(
  placeId: string,
  onChange: (pins: AudioPin[]) => void,
) {
  const q = query(
    collection(db, "places", placeId, "audioPins"),
    orderBy("createdAt", "asc"),
  );
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AudioPin));
  });
}

export async function getPlace(placeId: string): Promise<Place | null> {
  const snap = await getDoc(doc(db, "places", placeId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Place) : null;
}

export async function createPlace(
  name: string,
  splatFile: File,
  uploaderId: string,
) {
  const placeRef = doc(collection(db, "places"));
  const splatRef = ref(storage, `splats/${placeRef.id}/${splatFile.name}`);
  await uploadBytes(splatRef, splatFile);

  await setDoc(placeRef, {
    name,
    uploaderId,
    createdAt: serverTimestamp(),
    splatUrl: await getDownloadURL(splatRef),
    thumbnailUrl: "",
  });
  return placeRef.id;
}

export async function addAudioPin(
  placeId: string,
  point: { x: number; y: number; z: number },
  recording: { blob: Blob; duration: number },
  caption?: string,
) {
  const pinRef = doc(collection(db, "places", placeId, "audioPins"));
  const audioRef = ref(storage, `audio/${placeId}/${pinRef.id}`);
  await uploadBytes(audioRef, recording.blob, {
    contentType: recording.blob.type,
  });

  await setDoc(pinRef, {
    ...point,
    audioUrl: await getDownloadURL(audioRef),
    duration: recording.duration,
    createdAt: serverTimestamp(),
    ...(caption ? { caption } : {}),
  });
}
