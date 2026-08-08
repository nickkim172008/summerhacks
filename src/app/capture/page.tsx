"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createPlace } from "@/lib/places";
import { addPlacesToAlbum } from "@/lib/albums";
import { isFirebaseConfigured } from "@/lib/firebase";

// https://docs.kiriengine.app/3dgs-scan/video-upload
const MAX_SECONDS = 180;
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;
const POLL_INTERVAL_MS = 20_000;

/** Pitch mode: show the upload UX without waiting 30–90 min for a splat. */
const DEMO_CAPTURE = process.env.NEXT_PUBLIC_DEMO_CAPTURE === "true";

type Phase = "idle" | "uploading" | "processing" | "saving" | "queued";

const PHASE_LABEL: Record<Exclude<Phase, "idle" | "queued">, string> = {
  uploading: "Sending the walkthrough…",
  processing: "KIRI is reconstructing the scene. This takes 30–90 minutes.",
  saving: "Saving the environment…",
};

type VideoMeta = { seconds: number; width: number; height: number };

export default function CapturePage() {
  return (
    <Suspense fallback={null}>
      <CaptureForm />
    </Suspense>
  );
}

function CaptureForm() {
  const router = useRouter();
  const albumId = useSearchParams().get("album");
  const [name, setName] = useState("");
  const [video, setVideo] = useState<File | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const problem = !DEMO_CAPTURE && meta && describeProblem(meta);
  const canSubmit = name.trim() && video && !problem && phase === "idle";
  const backHref = albumId ? `/album/${albumId}` : "/";

  async function handleFile(file: File | undefined) {
    setVideo(file ?? null);
    setMeta(file ? await readVideoMeta(file) : null);
  }

  async function submit() {
    if (!video) return;
    setError(null);
    setPhase("uploading");

    if (DEMO_CAPTURE) {
      await sleep(1600);
      setPhase("queued");
      return;
    }

    try {
      const form = new FormData();
      form.append("video", video);

      const submitRes = await fetch("/api/capture/submit", {
        method: "POST",
        body: form,
      });
      const submitBody = await submitRes.json();
      if (!submitRes.ok) throw new Error(submitBody.error);

      const { serialize } = submitBody;
      setPhase("processing");
      await waitUntilReady(serialize);

      setPhase("saving");
      const modelRes = await fetch(
        `/api/capture/model?serialize=${encodeURIComponent(serialize)}`,
      );
      if (!modelRes.ok) throw new Error((await modelRes.json()).error);

      const placeId = await createPlace(
        name.trim(),
        await modelRes.blob(),
        "anonymous",
      );
      if (albumId) await addPlacesToAlbum(albumId, [placeId]);
      router.push(`/place/${placeId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Capture failed");
      setPhase("idle");
    }
  }

  if (phase === "queued") {
    return (
      <main className="min-h-screen bg-white text-[#1d1d1f]">
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
        <div className="mx-auto max-w-xl px-6 pt-16 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#0071e3]/10 text-2xl text-[#0071e3]">
            ✓
          </div>
          <h1 className="mt-6 text-[28px] font-bold tracking-tight">
            Video added
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            <span className="font-medium text-[#1d1d1f]">{name.trim()}</span>{" "}
            is queued for reconstruction. In production this takes 30–90
            minutes — then it shows up as a walkable environment
            {albumId ? " in this album" : ""}.
          </p>
          <Link
            href={backHref}
            className="mt-8 inline-block rounded-full bg-[#0071e3] px-6 py-2.5 font-medium text-white transition hover:bg-[#0077ed]"
          >
            {albumId ? "Back to Album" : "Back to Albums"}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white text-[#1d1d1f]">
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

      <div className="mx-auto max-w-xl px-6">
        <h1 className="mt-8 text-[34px] font-bold tracking-tight">
          New Environment
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          Upload one slow walkthrough video of the space — under{" "}
          {MAX_SECONDS / 60} minutes, {MAX_WIDTH}×{MAX_HEIGHT} or smaller. Move
          steadily and cover it from several angles and heights.
          {albumId && " It will be added to this album when it's ready."}
        </p>

        {!isFirebaseConfigured && !DEMO_CAPTURE && (
          <p className="mt-6 text-sm text-amber-600">
            Firebase isn&apos;t configured, so the finished environment
            can&apos;t be saved. Fill in <code>.env.local</code> first.
          </p>
        )}

        <div className="mt-8 flex flex-col gap-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What is this place called?"
            className="rounded-xl border border-black/10 bg-neutral-50 px-4 py-2.5 text-[15px] outline-none focus:border-[#0071e3]"
          />

          <label className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed border-black/20 bg-neutral-50 px-4 py-8 text-center transition hover:border-[#0071e3]">
            <span className="text-[15px] font-medium text-[#0071e3]">
              {video ? video.name : "Choose a Video"}
            </span>
            <span className="text-xs text-neutral-500">
              One continuous walkthrough works best
            </span>
            <input
              type="file"
              accept="video/*"
              onChange={(e) => handleFile(e.target.files?.[0])}
              className="hidden"
            />
          </label>

          {meta && (
            <p
              className={`text-sm ${problem ? "text-amber-600" : "text-neutral-500"}`}
            >
              {meta.width}×{meta.height}, {meta.seconds.toFixed(0)}s
              {problem && ` — ${problem}`}
            </p>
          )}

          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-full bg-[#0071e3] px-6 py-2.5 font-medium text-white transition hover:bg-[#0077ed] disabled:opacity-40"
          >
            Start Capture
          </button>

          {phase !== "idle" && phase !== "queued" && (
            <p className="text-sm text-neutral-600">{PHASE_LABEL[phase]}</p>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      </div>
    </main>
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function describeProblem({ seconds, width, height }: VideoMeta) {
  if (seconds > MAX_SECONDS) return `too long, max ${MAX_SECONDS / 60} minutes`;
  if (width > MAX_WIDTH || height > MAX_HEIGHT) {
    return `too large, max ${MAX_WIDTH}×${MAX_HEIGHT}`;
  }
  return null;
}

/** Checked here so an oversized upload never costs KIRI credits. */
function readVideoMeta(file: File): Promise<VideoMeta | null> {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    const url = URL.createObjectURL(file);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({
        seconds: el.duration,
        width: el.videoWidth,
        height: el.videoHeight,
      });
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    el.src = url;
  });
}

async function waitUntilReady(serialize: string) {
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(
      `/api/capture/status?serialize=${encodeURIComponent(serialize)}`,
    );
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    if (body.ready) return;
    if (body.failed) throw new Error("KIRI could not reconstruct this scan.");
  }
}
