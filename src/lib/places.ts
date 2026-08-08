import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "./firebase";
import { uploadSplat, uploadVideoFile } from "./splatStore";
import type { AudioPin, Place, Vec3 } from "./types";

function sortByCreatedDesc(places: Place[]) {
  return [...places].sort((a, b) => {
    const aTime = a.createdAt?.toMillis?.() ?? 0;
    const bTime = b.createdAt?.toMillis?.() ?? 0;
    return bTime - aTime;
  });
}

export function subscribeToPlaces(
  onChange: (places: Place[]) => void,
  onError?: (error: Error) => void,
) {
  const q = query(collection(db, "places"), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Place));
    },
    onError,
  );
}

export function subscribeToPlacesByUploader(
  uploaderId: string,
  onChange: (places: Place[]) => void,
  onError?: (error: Error) => void,
) {
  const q = query(
    collection(db, "places"),
    where("uploaderId", "==", uploaderId),
  );
  return onSnapshot(
    q,
    (snap) => {
      onChange(
        sortByCreatedDesc(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Place),
        ),
      );
    },
    onError,
  );
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
  splatFile: Blob & { name?: string },
  uploaderId: string,
  options?: {
    location?: { lat: number; lng: number } | null;
    videoFile?: Blob & { name?: string } | null;
    /** Already-uploaded walkthrough URL (from capture submit). */
    videoUrl?: string | null;
  },
) {
  const placeRef = doc(collection(db, "places"));
  // Bytes live in Firebase Storage; Firestore only holds the download URLs.
  const splatUrl = await uploadSplat(placeRef.id, splatFile);
  const videoUrl =
    options?.videoUrl ||
    (options?.videoFile
      ? await uploadVideoFile(placeRef.id, options.videoFile)
      : undefined);

  await setDoc(placeRef, {
    name,
    uploaderId,
    createdAt: serverTimestamp(),
    splatUrl,
    thumbnailUrl: "",
    ...(videoUrl ? { videoUrl } : {}),
    ...(options?.location ? { location: options.location } : {}),
  });
  return placeRef.id;
}

export async function addHotspot(
  placeId: string,
  point: Vec3,
  linksToPlaceId: string,
) {
  await updateDoc(doc(db, "places", placeId), {
    hotspots: arrayUnion({ ...point, linksToPlaceId }),
  });
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
