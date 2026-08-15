import type { EntryPoint } from "@/lib/types";
import type { WorldLabsCapture } from "@/lib/captureStatus";

/**
 * The contract every splat renderer honours, so the screens above one never
 * learn which is mounted. Shared rather than declared on either implementation
 * so neither has to import the other.
 */
export interface SplatViewerProps {
  splatUrl: string;
  entryPoint?: EntryPoint;
  /**
   * What the reconstruction knows about this capture. Only the scale factor and
   * ground plane are read, and only to stand the camera on the floor rather
   * than at the middle of the bounding box — absent on every capture made
   * before World Labs, which then frames off the bounds as it always did.
   */
  world?: WorldLabsCapture;
  /** Fired once the splat has decoded — for posters that fade out over it. */
  onReady?: () => void;
}

/**
 * Which renderer is mounted. PlayCanvas is what SuperSplat is built on and is
 * the default; Spark stays reachable for a side-by-side while the swap settles.
 *
 * Spark is still on the capture path for one thing: KIRI returns float32 PLY,
 * and `transcodeSpz` is what turns it into the SPZ that gets stored. A capture
 * reconstructed by World Labs never reaches it.
 */
export type SplatRenderer = "playcanvas" | "spark";

export const SPLAT_RENDERER: SplatRenderer =
  process.env.NEXT_PUBLIC_SPLAT_RENDERER === "spark" ? "spark" : "playcanvas";
