import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { FirebaseError } from "firebase/app";
import { storage } from "./firebase";

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
    const code = error instanceof FirebaseError ? ` (${error.code})` : "";
    throw new Error(
      `Upload to Firebase Storage failed${code}. Enable Storage in the Firebase console, then try again.`,
      { cause: error },
    );
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
    const code = error instanceof FirebaseError ? ` (${error.code})` : "";
    throw new Error(
      `Video upload to Firebase Storage failed${code}. Enable Storage in the Firebase console, then try again.`,
      { cause: error },
    );
  }
  return getDownloadURL(videoRef);
}

function extensionFor(file: Blob & { name?: string }) {
  const fromName = file.name?.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  if (file.type === "video/quicktime") return "mov";
  if (file.type === "video/webm") return "webm";
  if (file.type === "video/mp4") return "mp4";
  return "mp4";
}
