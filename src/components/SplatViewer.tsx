"use client";

import dynamic from "next/dynamic";
import {
  SPLAT_RENDERER,
  type SplatViewerProps,
} from "@/components/splatViewerTypes";

export type { SplatViewerProps };

/**
 * One name for "show me this place", so no screen has to know which engine is
 * underneath. PlayCanvas is the default — it is what SuperSplat renders with,
 * and matching that was the whole point of the swap. Set
 * NEXT_PUBLIC_SPLAT_RENDERER=spark to put the old three.js path back for a
 * side-by-side on the same capture.
 *
 * Split rather than imported both ways: only the renderer in use is fetched,
 * so the one that is off costs nothing but the branch.
 */
const Impl =
  SPLAT_RENDERER === "spark"
    ? dynamic(() => import("@/components/SparkSplatViewer"), { ssr: false })
    : dynamic(() => import("@/components/PlayCanvasSplatViewer"), {
        ssr: false,
      });

export default function SplatViewer(props: SplatViewerProps) {
  return <Impl {...props} />;
}
