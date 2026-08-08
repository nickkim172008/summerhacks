import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { FirebaseError } from "firebase/app";
import { storage } from "./firebase";

/**
 * Firebase reports both "there is no bucket" and "the rules said no" as an
 * upload failure, and they need opposite fixes. Telling someone to enable
 * Storage when the rules refused them sends them to a console page that already
 * looks correct, which is the slowest possible way to find a rules problem.
 */
function explainStorageError(error: unknown, what: string) {
  const code = error instanceof FirebaseError ? error.code : "";
  if (code === "storage/unauthorized") {
    return `${what} upload was refused by Firebase Storage rules (${code}). Sign in, and make sure storage.rules is deployed: firebase deploy --only storage.`;
  }
  if (code === "storage/unauthenticated") {
    return `${what} upload needs you to be signed in (${code}).`;
  }
  // A project with no bucket provisioned answers 404, which the SDK reports as
  // an opaque storage/unknown — worth naming, since no amount of retrying fixes it.
  const suffix = code ? ` (${code})` : "";
  return `${what} upload to Firebase Storage failed${suffix}. If Storage has never been enabled for this project, turn it on in the Firebase console, then try again.`;
}

/** Upload a finished splat to Firebase Storage; returns a public download URL. */
export async function uploadSplat(
  placeId: string,
  splatFile: Blob & { name?: string },
): Promise<string> {
  const splatRef = ref(
    storage,
    `splats/${placeId}/${splatFile.name ?? "scene.spz"}`,
  );
  try {
    await uploadBytes(splatRef, splatFile, {
      contentType: splatFile.type || "application/octet-stream",
    });
  } catch (error) {
    throw new Error(explainStorageError(error, "Splat"), { cause: error });
  }
  return getDownloadURL(splatRef);
}

/**
 * Upload the source walkthrough video to Firebase Storage.
 * Kept separately from the KIRI reconstruction upload.
 */
export async function uploadVideoFile(
  pathKey: string,
  video: Blob & { name?: string },
): Promise<string> {
  const ext = extensionFor(video) || "mp4";
  const videoRef = ref(storage, `videos/${pathKey}/walkthrough.${ext}`);
  try {
    await uploadBytes(videoRef, video, {
      contentType: video.type || "video/mp4",
    });
  } catch (error) {
    // storage/unauthorized is the rules refusing the write, which is a different
    // problem from the bucket not existing and has a different fix — saying
    // "enable Storage" for it sends you to a console page that already looks
    // fine. storage/unknown is the one that means no bucket: a project without
    // one answers 404, which the SDK reports opaquely.
    throw new Error(explainStorageError(error, "Video"), { cause: error });
  }
  return getDownloadURL(videoRef);
}

/**
 * Upload the audio lifted off the walkthrough. A place has only ever one such
 * track, so the name is fixed rather than taken from the file.
 */
export async function uploadAudio(
  placeId: string,
  audio: Blob & { name?: string },
): Promise<string> {
  const audioRef = ref(storage, `audio/${placeId}/walkthrough.wav`);
  try {
    await uploadBytes(audioRef, audio, { contentType: "audio/wav" });
  } catch (error) {
    throw new Error(explainStorageError(error, "Audio"), { cause: error });
  }
  return getDownloadURL(audioRef);
}

/** Profile avatar — always stored as a square JPEG under avatars/{uid}. */
export async function uploadProfilePhoto(
  uid: string,
  image: Blob,
): Promise<string> {
  const photoRef = ref(storage, `avatars/${uid}/profile.jpg`);
  try {
    await uploadBytes(photoRef, image, { contentType: "image/jpeg" });
  } catch (error) {
    throw new Error(explainStorageError(error, "Photo"), { cause: error });
  }
  return getDownloadURL(photoRef);
}

function extensionFor(file: Blob & { name?: string }) {
  const fromName = file.name?.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  if (file.type === "video/quicktime") return "mov";
  if (file.type === "video/webm") return "webm";
  if (file.type === "video/mp4") return "mp4";
  return "mp4";
}
