import {
  arrayUnion,
  collection,
  deleteField,
  doc,
  documentId,
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

/** Firestore rejects an `in` filter with more than 30 values. */
const IN_CHUNK = 30;

/**
 * Places uploaded by any of `uploaderIds`, newest first.
 *
 * Split across several listeners because of the `in` cap above, so results
 * arrive per chunk and are stitched back together here. Passing no ids yields
 * an empty list without opening a listener — an `in` on [] is an error.
 */
export function subscribeToPlacesByUploaders(
  uploaderIds: string[],
  onChange: (places: Place[]) => void,
  onError?: (error: Error) => void,
) {
  if (uploaderIds.length === 0) {
    onChange([]);
    return () => {};
  }

  const chunks: string[][] = [];
  for (let i = 0; i < uploaderIds.length; i += IN_CHUNK) {
    chunks.push(uploaderIds.slice(i, i + IN_CHUNK));
  }

  const byChunk: Place[][] = chunks.map(() => []);
  const unsubs = chunks.map((chunk, index) =>
    onSnapshot(
      query(collection(db, "places"), where("uploaderId", "in", chunk)),
      (snap) => {
        byChunk[index] = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as Place,
        );
        onChange(sortByCreatedDesc(byChunk.flat()));
      },
      onError,
    ),
  );

  return () => unsubs.forEach((off) => off());
}

/**
 * The places an album holds, whoever captured them.
 *
 * A shared album mixes several people's environments, so its grid cannot be
 * built by filtering the viewer's own uploads — everything a collaborator
 * added would quietly go missing. Chunked for the same `in` cap as above.
 */
export function subscribeToPlacesByIds(
  placeIds: string[],
  onChange: (places: Place[]) => void,
  onError?: (error: Error) => void,
) {
  if (placeIds.length === 0) {
    onChange([]);
    return () => {};
  }

  const chunks: string[][] = [];
  for (let i = 0; i < placeIds.length; i += IN_CHUNK) {
    chunks.push(placeIds.slice(i, i + IN_CHUNK));
  }

  const byChunk: Place[][] = chunks.map(() => []);
  const unsubs = chunks.map((chunk, index) =>
    onSnapshot(
      query(collection(db, "places"), where(documentId(), "in", chunk)),
      (snap) => {
        byChunk[index] = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as Place,
        );
        onChange(sortByCreatedDesc(byChunk.flat()));
      },
      onError,
    ),
  );

  return () => unsubs.forEach((off) => off());
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

export interface PlaceEdits {
  name: string;
  locationName: string;
  /** null clears the pin, leaving the name to place it on the map. */
  location: { lat: number; lng: number } | null;
}

/**
 * What the capture form guessed is not always what happened: the video's GPS
 * can be absent, or wrong, and a name typed in a hurry reads badly later.
 *
 * Cleared fields are deleted rather than written empty, so a place with no
 * location looks the same whether it never had one or lost one — the map and
 * the geocoder both key off absence.
 */
export async function updatePlaceDetails(placeId: string, edits: PlaceEdits) {
  const locationName = edits.locationName.trim();
  await updateDoc(doc(db, "places", placeId), {
    name: edits.name.trim(),
    locationName: locationName || deleteField(),
    location: edits.location ?? deleteField(),
  });
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
