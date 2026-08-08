"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPlace } from "@/lib/places";
import { isFirebaseConfigured } from "@/lib/firebase";

const MIN_IMAGES = 20;
const MAX_IMAGES = 300;
const POLL_INTERVAL_MS = 20_000;

type Phase = "idle" | "uploading" | "processing" | "saving";

const PHASE_LABEL: Record<Exclude<Phase, "idle">, string> = {
  uploading: "Sending photos to KIRI…",
  processing: "KIRI is reconstructing the scene. This takes 30–90 minutes.",
  saving: "Saving the place…",
};

export default function CapturePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const countValid = files.length >= MIN_IMAGES && files.length <= MAX_IMAGES;
  const canSubmit = name.trim() && countValid && phase === "idle";

  async function submit() {
    setError(null);
    setPhase("uploading");
    try {
      const form = new FormData();
      for (const file of files) form.append("images", file);

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
        Upload {MIN_IMAGES}–{MAX_IMAGES} photos taken from all angles and
        heights. KIRI reconstructs them into a walkable Gaussian splat.
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
          accept="image/*"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="text-sm text-neutral-400"
        />

        {files.length > 0 && (
          <p className={`text-sm ${countValid ? "text-neutral-400" : "text-amber-400"}`}>
            {files.length} photos selected
            {!countValid && ` — need between ${MIN_IMAGES} and ${MAX_IMAGES}`}
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
