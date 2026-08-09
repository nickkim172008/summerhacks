"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  MAX_VIDEO_HEIGHT,
  MAX_VIDEO_SECONDS,
  MAX_VIDEO_WIDTH,
} from "@/lib/kiri";
import CaptureRunner, { CAPTURE_INPUT_ID } from "@/components/CaptureRunner";

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
    <main className="min-h-screen bg-[#FAF9F7] text-[#14161A]">
      <div className="mx-auto max-w-[1152px] p-8">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#4A4F57] transition hover:text-[#14161A]"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-[14px] w-[14px]"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 5l-7 7 7 7" />
          </svg>
          {albumId ? "Journey" : "Library"}
        </Link>

        <div className="mt-[18px] flex flex-wrap items-end justify-between gap-8 border-b border-[rgba(20,22,26,0.09)] pb-6">
          <div className="min-w-0">
            <h1 className="font-display text-[44px] font-normal leading-[44px] tracking-[-0.02em]">
              New places
            </h1>
          </div>

          {/* The picker itself. Its input lives in CaptureRunner, beside the
              queue it feeds, and is reached by id rather than by nesting. */}
          <label
            htmlFor={CAPTURE_INPUT_ID}
            className="flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full bg-[#14161A] px-[22px] text-[15px] font-medium text-white transition hover:bg-[#2A2E35]"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-[15px] w-[15px]"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Choose videos
          </label>
        </div>

        <div className="mt-6 flex items-center gap-5 rounded-2xl border border-dashed border-[rgba(20,22,26,0.2)] bg-white p-[22px_26px]">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgba(20,22,26,0.05)] text-[#14161A]">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 16V4M7 9l5-5 5 5M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-medium">Drop walkthroughs here</p>
            {/* KIRI's limits, in words, from the same constants the queue
                measures a picked video against. */}
            <p className="mt-[3px] text-[13px] leading-[18px] tabular-nums text-[#6B7178]">
              Under {MAX_VIDEO_SECONDS / 60} minutes · {MAX_VIDEO_WIDTH}×
              {MAX_VIDEO_HEIGHT} or smaller · one continuous slow walk, no cuts
            </p>
          </div>
          <span className="hidden shrink-0 text-[13px] text-[#6B7178] sm:block">
            or use{" "}
            <span className="font-medium text-[#14161A]">Choose videos</span>{" "}
            above
          </span>
        </div>

        <CaptureRunner albumId={albumId} mode="new" />
      </div>
    </main>
  );
}
