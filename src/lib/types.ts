import type { Timestamp } from "firebase/firestore";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A marker inside one place that jumps the viewer to another place. */
export interface Hotspot extends Vec3 {
  linksToPlaceId: string;
  label?: string;
}

/** Where the camera lands when a place is entered or jumped to. */
export interface EntryPoint {
  position: Vec3;
  target: Vec3;
}

export interface Place {
  /**
   * Set when the place is in the trash. Deleting is reversible until it is
   * emptied, because the bytes behind a place took an hour of reconstruction
   * and a misplaced tap should not be able to spend that.
   */
  deletedAt?: Timestamp;
  id: string;
  name: string;
  uploaderId: string;
  createdAt: Timestamp;
  splatUrl: string;
  thumbnailUrl: string;
  hotspots?: Hotspot[];
  entryPoint?: EntryPoint;
  /** The walkthrough video's own audio, lifted off at capture time. */
  audioUrl?: string;
  audioSeconds?: number;
  /** ISO 8601. Read from the video, or typed in when it carried none. */
  capturedAt?: string;
  location?: { lat: number; lng: number };
  locationName?: string;
}

/** A user-created collection of places, shown like an Apple Photos album. */
export interface Album {
  id: string;
  name: string;
  ownerId: string;
  placeIds: string[];
  createdAt: Timestamp;
  /**
   * A picture chosen for this album. Absent is the normal case, and means the
   * cover is built out of what the album holds instead.
   */
  coverUrl?: string;
}

/** Public profile keyed by Firebase Auth uid. Username is unique. */
export interface Profile {
  id: string;
  username: string;
  displayName: string;
  photoURL: string;
  bio?: string;
  createdAt: Timestamp;
}

/** One follow edge. Doc id is `{followerId}_{followingId}`. */
export interface Follow {
  id: string;
  followerId: string;
  followingId: string;
  createdAt: Timestamp | null;
}
