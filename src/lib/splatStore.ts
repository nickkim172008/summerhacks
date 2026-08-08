import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { FirebaseError } from "firebase/app";
import { storage } from "./firebase";

/**
 * Where a saved capture's bytes go. Firestore holds only the URL this returns
 * — documents cap at 1 MiB, nowhere near a splat.
 *
 * - `local` writes under public/ and returns a relative URL. No bucket, no
 *   billing, but the file exists only on the machine that ran the save, while
 *   Firestore is shared: other machines will list the environment and fail to
 *   load it. Commit the .spz to share it, or point everyone at one host.
 * - `firebase` uploads to Cloud Storage and returns an absolute download URL,
 *   which works from anywhere.
 */
export type SplatStore = "local" | "firebase";

export const SPLAT_STORE: SplatStore =
  process.env.NEXT_PUBLIC_SPLAT_STORE === "firebase" ? "firebase" : "local";

export async function uploadSplat(
  placeId: string,
  splatFile: Blob & { name?: string },
): Promise<string> {
  if (SPLAT_STORE === "local") return uploadToApp(placeId, splatFile);
  return uploadToFirebase(placeId, splatFile);
}

async function uploadToApp(placeId: string, splatFile: Blob) {
  const form = new FormData();
  form.append("placeId", placeId);
  form.append("splat", splatFile);

  const res = await fetch("/api/places/splat", { method: "POST", body: form });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Could not store the splat");
  return body.splatUrl as string;
}

async function uploadToFirebase(
  placeId: string,
  splatFile: Blob & { name?: string },
) {
  const splatRef = ref(
    storage,
    `splats/${placeId}/${splatFile.name ?? "scene.spz"}`,
  );
  try {
    await uploadBytes(splatRef, splatFile);
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
  return getDownloadURL(splatRef);
}
