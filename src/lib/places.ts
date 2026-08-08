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
import { uploadPlaceAsset } from "./placeAssets";
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

export async function createPlace(input: {
  name: string;
  uploaderId: string;
  splatFile: File;
  audioFile?: File | null;
  audioSeconds?: number;
  capturedAt?: string;
  location?: { lat: number; lng: number } | null;
  locationName?: string;
}) {
  const placeRef = doc(collection(db, "places"));
  // The bytes go wherever placeAssets points; the doc only ever holds the URLs.
  const splatUrl = await uploadPlaceAsset(
    placeRef.id,
    "splat",
    input.splatFile,
  );
  const audioUrl = input.audioFile
    ? await uploadPlaceAsset(placeRef.id, "audio", input.audioFile)
    : null;

  await setDoc(placeRef, {
    name: input.name,
    uploaderId: input.uploaderId,
    createdAt: serverTimestamp(),
    splatUrl,
    thumbnailUrl: "",
    // Firestore rejects undefined outright, so absent details are left off the
    // document rather than written as blanks.
    ...(audioUrl ? { audioUrl } : {}),
    ...(audioUrl && input.audioSeconds !== undefined
      ? { audioSeconds: input.audioSeconds }
      : {}),
    ...(input.capturedAt ? { capturedAt: input.capturedAt } : {}),
    ...(input.location ? { location: input.location } : {}),
    ...(input.locationName ? { locationName: input.locationName } : {}),
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
