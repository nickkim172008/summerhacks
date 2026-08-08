import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { FirebaseError } from "firebase/app";
import { storage } from "./firebase";

/**
 * Where a saved capture's bytes go — both the splat and the audio lifted off
 * the walkthrough video. Firestore holds only the URL this returns; documents
 * cap at 1 MiB, nowhere near either file.
 *
 * - `local` writes under public/ and returns a relative URL. No bucket, no
 *   billing, but the file exists only on the machine that ran the save, while
 *   Firestore is shared: other machines will list the environment and fail to
 *   load it. Commit the file to share it, or point everyone at one host.
 * - `firebase` uploads to Cloud Storage and returns an absolute download URL,
 *   which works from anywhere.
 */
export type PlaceAssetStore = "local" | "firebase";

export type AssetKind = "splat" | "audio";

export const PLACE_ASSET_STORE: PlaceAssetStore =
  process.env.NEXT_PUBLIC_SPLAT_STORE === "firebase" ? "firebase" : "local";

export async function uploadPlaceAsset(
  placeId: string,
  kind: AssetKind,
  file: File,
): Promise<string> {
  if (PLACE_ASSET_STORE === "local") return uploadToApp(placeId, kind, file);
  return uploadToFirebase(placeId, kind, file);
}

async function uploadToApp(placeId: string, kind: AssetKind, file: File) {
  const form = new FormData();
  form.append("placeId", placeId);
  form.append("kind", kind);
  form.append("file", file);

  const res = await fetch("/api/places/asset", { method: "POST", body: form });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Could not store the ${kind}`);
  return body.url as string;
}

async function uploadToFirebase(placeId: string, kind: AssetKind, file: File) {
  // Splats keep the nested, file-named layout they have always been uploaded
  // under, so URLs already saved in Firestore still resolve. A place has only
  // ever one audio track, so that one is a flat, predictable name.
  const objectPath =
    kind === "splat"
      ? `splats/${placeId}/${file.name}`
      : `audio/${placeId}.wav`;
  const assetRef = ref(storage, objectPath);

  try {
    await uploadBytes(assetRef, file);
  } catch (error) {
    // A project with no bucket provisioned answers 404, which the SDK reports
    // as an opaque storage/unknown — worth naming, since it is the one cause
    // no amount of retrying fixes.
    const code = error instanceof FirebaseError ? ` (${error.code})` : "";
    throw new Error(
      `Upload to Firebase Storage failed${code}. If Storage has never been enabled for this project, turn it on in the Firebase console, then try again.`,
      { cause: error },
    );
  }
  return getDownloadURL(assetRef);
}
