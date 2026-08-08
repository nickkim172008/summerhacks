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
import { db } from "./firebase";
import { uploadAudio, uploadSplat } from "./splatStore";
import type { Place, Vec3 } from "./types";

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
    locationName?: string;
    /** ISO 8601, off the video or typed in when it carried no date. */
    capturedAt?: string;
    /** The walkthrough's own audio, lifted off it at capture time. */
    audioFile?: (Blob & { name?: string }) | null;
    audioSeconds?: number;
  },
) {
  const placeRef = doc(collection(db, "places"));
  // Bytes live in Firebase Storage; Firestore only holds the download URLs.
  const splatUrl = await uploadSplat(placeRef.id, splatFile);
  const audioUrl = options?.audioFile
    ? await uploadAudio(placeRef.id, options.audioFile)
    : undefined;

  await setDoc(placeRef, {
    name,
    uploaderId,
    createdAt: serverTimestamp(),
    splatUrl,
    thumbnailUrl: "",
    // Firestore rejects undefined outright, so absent details are left off the
    // document rather than written as blanks.
    ...(audioUrl ? { audioUrl } : {}),
    ...(audioUrl && options?.audioSeconds !== undefined
      ? { audioSeconds: options.audioSeconds }
      : {}),
    ...(options?.capturedAt ? { capturedAt: options.capturedAt } : {}),
    ...(options?.location ? { location: options.location } : {}),
    ...(options?.locationName ? { locationName: options.locationName } : {}),
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
