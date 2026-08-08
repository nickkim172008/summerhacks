import type { Timestamp } from "firebase/firestore";

export interface Place {
  id: string;
  name: string;
  uploaderId: string;
  createdAt: Timestamp;
  splatUrl: string;
  thumbnailUrl: string;
  location?: { lat: number; lng: number };
}

export interface AudioPin {
  id: string;
  x: number;
  y: number;
  z: number;
  audioUrl: string;
  duration: number;
  createdAt: Timestamp;
  caption?: string;
}
