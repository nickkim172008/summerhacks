import type { Timestamp } from "firebase/firestore";
import type { Place } from "./types";

/**
 * Fake geotagged environments around Toronto so the Map heatmap looks alive
 * before real users seed GPS data.
 */
const TORONTO_SPOTS: { name: string; lat: number; lng: number }[] = [
  { name: "Harbourfront Walk", lat: 43.6387, lng: -79.3817 },
  { name: "CN Tower Plaza", lat: 43.6426, lng: -79.3871 },
  { name: "Rogers Centre Gate", lat: 43.6414, lng: -79.3894 },
  { name: "St. Lawrence Market", lat: 43.6487, lng: -79.3715 },
  { name: "Distillery Lane", lat: 43.6503, lng: -79.3595 },
  { name: "Kensington Corner", lat: 43.6548, lng: -79.4005 },
  { name: "Chinatown Gate", lat: 43.653, lng: -79.397 },
  { name: "Queen West Studio", lat: 43.6475, lng: -79.418 },
  { name: "Trinity Bellwoods", lat: 43.647, lng: -79.414 },
  { name: "U of T St. George", lat: 43.6629, lng: -79.3957 },
  { name: "Yorkville Courtyard", lat: 43.6705, lng: -79.393 },
  { name: "Bloor Annex Café", lat: 43.6655, lng: -79.411 },
  { name: "High Park Lookout", lat: 43.6465, lng: -79.4637 },
  { name: "Liberty Village Yard", lat: 43.6385, lng: -79.4205 },
  { name: "Fort York Path", lat: 43.6375, lng: -79.406 },
  { name: "Eaton Centre Spadina", lat: 43.6544, lng: -79.3807 },
  { name: "Nathan Phillips Square", lat: 43.6527, lng: -79.383 },
  { name: "Yonge-Dundas Pulse", lat: 43.6561, lng: -79.3802 },
  { name: "Rosedale Ravine", lat: 43.681, lng: -79.378 },
  { name: "Leslieville Stoop", lat: 43.662, lng: -79.337 },
  { name: "The Beaches Boardwalk", lat: 43.6677, lng: -79.295 },
  { name: "Danforth Patio", lat: 43.678, lng: -79.35 },
  { name: "Little Italy Night", lat: 43.6555, lng: -79.42 },
  { name: "Junction Market", lat: 43.6655, lng: -79.465 },
  { name: "Entertainment District", lat: 43.6466, lng: -79.39 },
  // Dense cluster downtown so the heat reads clearly
  { name: "King & Bay Lobby", lat: 43.6486, lng: -79.3802 },
  { name: "Bay Adelaide Steps", lat: 43.6503, lng: -79.3808 },
  { name: "PATH Tunnel Node", lat: 43.6495, lng: -79.3815 },
  { name: "Union Station Hall", lat: 43.6453, lng: -79.3806 },
  { name: "Scotiabank Arena Door", lat: 43.6435, lng: -79.3791 },
  { name: "Sugar Beach Spot", lat: 43.643, lng: -79.367 },
  { name: "Corktown Common", lat: 43.654, lng: -79.353 },
  { name: "Evergreen Brick Works", lat: 43.6847, lng: -79.3655 },
  { name: "Casa Loma Drive", lat: 43.678, lng: -79.4094 },
  { name: "Dufferin Grove", lat: 43.6565, lng: -79.433 },
];

export const DEMO_MAP_PLACES: Place[] = TORONTO_SPOTS.map((spot, i) => ({
  id: `demo-map-${i}`,
  name: spot.name,
  uploaderId: "demo",
  createdAt: null as unknown as Timestamp,
  splatUrl: "",
  thumbnailUrl: "",
  location: { lat: spot.lat, lng: spot.lng },
}));

/** A smaller personal-looking subset for the Personal filter demo. */
export const DEMO_PERSONAL_PLACE_IDS = new Set(
  DEMO_MAP_PLACES.slice(0, 8).map((p) => p.id),
);
