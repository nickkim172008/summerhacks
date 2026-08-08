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
  hotspots?: Hotspot[];
  entryPoint?: EntryPoint;
  location?: { lat: number; lng: number };
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

export interface AudioPin extends Vec3 {
  id: string;
  audioUrl: string;
  duration: number;
  createdAt: Timestamp;
  caption?: string;
}
