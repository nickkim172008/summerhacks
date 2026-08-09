import type { Timestamp } from "firebase/firestore";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
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
  /**
   * Everyone who may add to this album, the owner included. Absent on albums
   * created before sharing existed, so treat a missing value as [ownerId].
   * Invitees land here only after they accept — until then they sit in
   * pendingMemberIds.
   */
  memberIds?: string[];
  /**
   * When each collaborator was added, keyed by uid. The album's own createdAt
   * cannot stand in for this: being invited to a year-old album is news today.
   */
  memberAddedAt?: Record<string, Timestamp>;
  /**
   * People invited who have not accepted yet. They cannot edit until they
   * accept from the notification, which is what moves them into memberIds.
   */
  pendingMemberIds?: string[];
  /** When each pending invite was sent, keyed by uid. */
  invitePendingAt?: Record<string, Timestamp>;
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
