import type { EntryPoint } from "@/lib/types";

/**
 * The contract every splat renderer honours, so the screens above one never
 * learn which is mounted. Shared rather than declared on either implementation
 * so neither has to import the other.
 */
export interface SplatViewerProps {
  splatUrl: string;
  entryPoint?: EntryPoint;
  /** Fired once the splat has decoded — for posters that fade out over it. */
  onReady?: () => void;
}

/**
 * Which renderer is mounted. PlayCanvas is what SuperSplat is built on and is
 * the default; Spark stays reachable for a side-by-side while the swap settles.
 *
 * Spark is not gone from the app either way: the capture pipeline still calls
 * its `transcodeSpz` to turn KIRI's PLY into the SPZ we store.
 */
export type SplatRenderer = "playcanvas" | "spark";

export const SPLAT_RENDERER: SplatRenderer =
  process.env.NEXT_PUBLIC_SPLAT_RENDERER === "spark" ? "spark" : "playcanvas";
