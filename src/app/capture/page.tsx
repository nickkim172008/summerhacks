"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  MAX_VIDEO_HEIGHT,
  MAX_VIDEO_SECONDS,
  MAX_VIDEO_WIDTH,
} from "@/lib/kiri";
import CaptureRunner from "@/components/CaptureRunner";

export default function CapturePage() {
  return (
    <Suspense fallback={null}>
      <CaptureFlow />
    </Suspense>
  );
}

/**
 * A place to begin captures, not to watch them. Work already reconstructing
 * shows in the album it was started from, so this form opens empty every time —
 * picking up somebody else's half-finished batch here was only ever confusing,
 * and losing sight of one is impossible when its album is holding it.
 */
function CaptureFlow() {
  const params = useSearchParams();
  const albumId = params.get("album");
  const backHref = albumId ? `/album/${albumId}` : "/";

  return (
    <main className="min-h-screen bg-white pb-20 text-[#1d1d1f]">
      <nav className="sticky top-0 z-20 border-b border-black/10 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex h-13 max-w-5xl items-center px-6 py-3">
          <Link
            href={backHref}
            className="flex items-center gap-1 text-[17px] text-[#0071e3]"
          >
            <span aria-hidden className="text-xl leading-none">
              ‹
            </span>
            {albumId ? "Album" : "Albums"}
          </Link>
        </div>
      </nav>

      <div className="mx-auto max-w-3xl px-6">
        <h1 className="mt-8 text-[34px] font-bold tracking-tight">
          New Environments
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          Pick one slow walkthrough video per space — each under{" "}
          {MAX_VIDEO_SECONDS / 60} minutes, {MAX_VIDEO_WIDTH}×{MAX_VIDEO_HEIGHT}{" "}
          or smaller. They reconstruct in parallel, and each one saves on its
          own.
          {albumId
            ? " Everything you save here joins this album, and you can watch it reconstruct there."
            : " You can watch them reconstruct in Recents."}
        </p>

        <CaptureRunner albumId={albumId} mode="new" />
      </div>
    </main>
  );
}
