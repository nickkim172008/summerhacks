"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPlace } from "@/lib/places";
import { isFirebaseConfigured } from "@/lib/firebase";

// https://docs.kiriengine.app/3dgs-scan/video-upload
const MAX_SECONDS = 180;
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;
const POLL_INTERVAL_MS = 20_000;

type Phase = "idle" | "uploading" | "processing" | "saving";

const PHASE_LABEL: Record<Exclude<Phase, "idle">, string> = {
  uploading: "Sending the walkthrough to KIRI…",
  processing: "KIRI is reconstructing the scene. This takes 30–90 minutes.",
  saving: "Saving the place…",
};

type VideoMeta = { seconds: number; width: number; height: number };

export default function CapturePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [video, setVideo] = useState<File | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const problem = meta && describeProblem(meta);
  const canSubmit = name.trim() && video && !problem && phase === "idle";

  async function handleFile(file: File | undefined) {
    setVideo(file ?? null);
    setMeta(file ? await readVideoMeta(file) : null);
  }

  async function submit() {
    if (!video) return;
    setError(null);
    setPhase("uploading");
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
      router.push(`/place/${placeId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Capture failed");
      setPhase("idle");
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12 text-white">
      <h1 className="text-2xl font-semibold">Capture a place</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Upload one slow walkthrough video of the space — under {MAX_SECONDS / 60}{" "}
        minutes, {MAX_WIDTH}×{MAX_HEIGHT} or smaller. Move steadily and cover it
        from several angles and heights. Each place is its own scene; you link
        them together with hotspots afterwards.
      </p>

      {!isFirebaseConfigured && (
        <p className="mt-6 text-sm text-amber-400">
          Firebase isn&apos;t configured, so the finished place can&apos;t be
          saved. Fill in <code>.env.local</code> first.
        </p>
      )}

      <div className="mt-8 flex flex-col gap-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What is this place called?"
          className="rounded bg-neutral-900 px-3 py-2 outline-none"
        />

        <input
          type="file"
          accept="video/*"
          onChange={(e) => handleFile(e.target.files?.[0])}
          className="text-sm text-neutral-400"
        />

        {meta && (
          <p className={`text-sm ${problem ? "text-amber-400" : "text-neutral-400"}`}>
            {meta.width}×{meta.height}, {meta.seconds.toFixed(0)}s
            {problem && ` — ${problem}`}
          </p>
        )}

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-full bg-sky-500 px-6 py-2 font-medium disabled:opacity-40"
        >
          Start capture
        </button>

        {phase !== "idle" && (
          <p className="text-sm text-neutral-300">{PHASE_LABEL[phase]}</p>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </main>
  );
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
