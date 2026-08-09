import {
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
import { deleteObject, listAll, ref } from "firebase/storage";
import { deleteDoc } from "firebase/firestore";
import { db, storage } from "./firebase";
import { uploadAudio, uploadSplat, uploadThumbnail } from "./splatStore";
import type { Place } from "./types";

/** Prefer when it was filmed; fall back to when it was saved. */
export function placeTakenMs(place: Place): number {
  if (place.capturedAt) {
    const filmed = Date.parse(place.capturedAt);
    if (Number.isFinite(filmed)) return filmed;
  }
  return place.createdAt?.toMillis?.() ?? 0;
}

/** Newest → oldest by capture date (then upload time). */
export function sortPlacesNewestFirst(places: Place[]) {
  return [...places].sort((a, b) => {
    const diff = placeTakenMs(b) - placeTakenMs(a);
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Date + time with AM/PM for tile hover captions. */
export function formatPlaceDate(place: Place): string | null {
  const ms = placeTakenMs(place);
  if (!ms) return null;
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
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
      onChange(
        livePlaces(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Place)),
      );
    },
    onError,
  );
}

/**
 * A place in the trash is still a document, so every listing has to say it does
 * not want one. Filtering here rather than in the query is deliberate: Firestore
 * cannot match "field absent" with an equality, and every place saved before the
 * trash existed has no deletedAt at all.
 */
function livePlaces(places: Place[]) {
  return places.filter((place) => !place.deletedAt);
}

/**
 * Reversible on purpose. The bytes behind a place cost an hour of
 * reconstruction, so a tap that means "get this out of my library" should not
 * be the same act as spending that hour.
 */
export async function movePlaceToTrash(placeId: string) {
  await updateDoc(doc(db, "places", placeId), { deletedAt: serverTimestamp() });
}

export async function restorePlace(placeId: string) {
  await updateDoc(doc(db, "places", placeId), { deletedAt: deleteField() });
}

/** What is in the trash, for whoever put it there. */
export function subscribeToTrashedPlaces(
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
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Place);
      onChange(
        sortPlacesNewestFirst(all.filter((place) => place.deletedAt)),
      );
    },
    onError,
  );
}

/**
 * Gone for good: the stored bytes first, then the document.
 *
 * That order matters. Losing the document while its files remain leaves bytes
 * nothing names and no way to find them again; losing the files first leaves a
 * document that renders as a missing capture, which at least says what happened
 * and can be cleared. Storage is listed rather than addressed directly because a
 * splat keeps the name it was captured under, and only the folder is known.
 */
export async function deletePlaceForever(placeId: string) {
  for (const folder of ["splats", "audio", "thumbnails"]) {
    try {
      const listing = await listAll(ref(storage, `${folder}/${placeId}`));
      await Promise.all(listing.items.map((item) => deleteObject(item)));
    } catch {
      // Already gone, or never written for this place. Either way there is
      // nothing here to clean up, and it must not stop the rest.
    }
  }
  await deleteDoc(doc(db, "places", placeId));
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
        sortPlacesNewestFirst(
          livePlaces(
            snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Place),
          ),
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
        byChunk[index] = livePlaces(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Place),
        );
        onChange(sortPlacesNewestFirst(byChunk.flat()));
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
        onChange(sortPlacesNewestFirst(byChunk.flat()));
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
    /** A frame off the walkthrough, taken when its video was picked. */
    thumbnail?: Blob | null;
  },
) {
  const placeRef = doc(collection(db, "places"));
  // Bytes live in Firebase Storage; Firestore only holds the download URLs.
  const splatUrl = await uploadSplat(placeRef.id, splatFile);
  const audioUrl = options?.audioFile
    ? await uploadAudio(placeRef.id, options.audioFile)
    : undefined;
  const thumbnailUrl = options?.thumbnail
    ? await uploadThumbnail(placeRef.id, options.thumbnail).catch((error) => {
        // A still is decoration, and this is the tail end of a save that has
        // already put the whole capture in Storage — losing that over a 60 KB
        // JPEG would be the wrong trade. Said out loud rather than swallowed:
        // from the grid, a rule that was never deployed looks exactly like a
        // video no frame could be taken from.
        console.warn(error);
        return "";
      })
    : "";

  await setDoc(placeRef, {
    name,
    uploaderId,
    createdAt: serverTimestamp(),
    splatUrl,
    thumbnailUrl,
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
  /**
   * Already uploaded, since only the caller knows whether a picture was
   * chosen at all. Undefined leaves whatever is there alone; the empty string
   * is an explicit ask for the gradient tile back.
   */
  thumbnailUrl?: string;
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
    // Written empty rather than deleted, unlike the fields above: every place
    // carries a thumbnailUrl from the moment it is created, and the tile reads
    // an empty one as "draw the gradient".
    ...(edits.thumbnailUrl === undefined
      ? {}
      : { thumbnailUrl: edits.thumbnailUrl }),
  });
}
