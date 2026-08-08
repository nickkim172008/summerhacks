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
  id: string;
  name: string;
  uploaderId: string;
  createdAt: Timestamp;
  splatUrl: string;
  thumbnailUrl: string;
  /** Original walkthrough video in Firebase Storage, when uploaded. */
  videoUrl?: string;
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
}

/** Public profile keyed by Firebase Auth uid. Username is unique. */
export interface Profile {
  id: string;
  username: string;
  displayName: string;
  photoURL: string;
  createdAt: Timestamp;
}
