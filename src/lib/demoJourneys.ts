/**
 * Pitch / demo journeys for the library — covers and counts only, not real
 * Firestore albums. Display-only seed data, same idea as the Discover
 * organizers.
 */

export type DemoJourney = {
  id: string;
  name: string;
  coverUrl: string;
  placeCount: number;
  /** When set, the card sits under Shared with you and shows collaborator faces. */
  shared?: {
    /** Faces to show on the cover (real profiles are filled in at runtime). */
    faceCount: number;
    /** Total people on the journey, for the +N badge and the subtitle. */
    peopleCount: number;
  };
};

export const DEMO_OWNED_JOURNEYS: DemoJourney[] = [
  {
    id: "demo-garden",
    name: "Backyard",
    coverUrl: "/demo-journeys/garden.png",
    placeCount: 4,
  },
  {
    id: "demo-fishing",
    name: "Morning on the lake",
    coverUrl: "/demo-journeys/fishing.png",
    placeCount: 8,
  },
  {
    id: "demo-summer-nights",
    name: "Summer nights",
    coverUrl: "/demo-journeys/summer-nights.png",
    placeCount: 10,
  },
];

export const DEMO_SHARED_JOURNEY: DemoJourney = {
  id: "demo-bishop-allen-grad",
  name: "bishop allen grad",
  coverUrl: "/demo-journeys/bishop-allen-grad.png",
  placeCount: 30,
  shared: {
    faceCount: 3,
    peopleCount: 18,
  },
};
