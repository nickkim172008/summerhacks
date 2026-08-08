"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  KIRI_STATUS_LABEL,
  MAX_VIDEO_HEIGHT,
  MAX_VIDEO_SECONDS,
  MAX_VIDEO_WIDTH,
  type KiriStatus,
} from "@/lib/kiri";
import {
  clearJob,
  fetchSplat,
  fetchStatus,
  parseJob,
  readJobSnapshot,
  saveJob,
  subscribeToJob,
  uploadVideo,
  type CaptureJob,
} from "@/lib/captureJob";
import {
  dropCachedSplat,
  readCachedSplat,
  writeCachedSplat,
} from "@/lib/splatCache";
import { createPlace } from "@/lib/places";
import { addPlacesToAlbum } from "@/lib/albums";
import { isFirebaseConfigured } from "@/lib/firebase";

const SplatViewer = dynamic(() => import("@/components/SplatViewer"), {
  ssr: false,
});

const POLL_INTERVAL_MS = 20_000;
const CLOCK_INTERVAL_MS = 30_000;
const FAILURES_BEFORE_REPORTING = 3;

type Busy = "uploading" | "downloading" | "saving" | null;
type VideoMeta = { seconds: number; width: number; height: number };

export default function CapturePage() {
  return (
    <Suspense fallback={null}>
      <CaptureFlow />
    </Suspense>
  );
}

function CaptureFlow() {
  const router = useRouter();
  const albumId = useSearchParams().get("album");
  const [name, setName] = useState("");
  const [video, setVideo] = useState<File | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [formKey, setFormKey] = useState(0);

  // The job lives in localStorage, not in state: reconstruction outlasts the
  // tab, so a reload — or a second tab — has to find the same job waiting.
  const storedJob = useSyncExternalStore(
    subscribeToJob,
    readJobSnapshot,
    () => null,
  );
  const job = useMemo(() => parseJob(storedJob), [storedJob]);

  const [status, setStatus] = useState<KiriStatus | null>(null);
  const [uploadFraction, setUploadFraction] = useState(0);
  // Carries the name so the result view survives clearing the job on save.
  const [splat, setSplat] = useState<{
    url: string;
    file: File;
    name: string;
  } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const problem = meta && describeProblem(meta);
  const canSubmit = Boolean(name.trim() && video && !problem && !busy);
  const backHref = albumId ? `/album/${albumId}` : "/";

  // An object URL pins its blob — a hundred-odd megabytes here — until it is
  // revoked, so the live one is tracked in a ref and released when it is
  // replaced, when the page goes away, or when a download lands too late.
  const splatUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const showSplat = useCallback((file: File, label: string) => {
    if (splatUrlRef.current) URL.revokeObjectURL(splatUrlRef.current);
    splatUrlRef.current = null;
    if (!mountedRef.current) return;
    const url = URL.createObjectURL(file);
    splatUrlRef.current = url;
    setSplat({ url, file, name: label });
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (splatUrlRef.current) URL.revokeObjectURL(splatUrlRef.current);
    };
  }, []);

  const download = useCallback(
    async (target: CaptureJob) => {
      setBusy("downloading");
      setError(null);
      try {
        const blob = await fetchSplat(target.serialize);
        showSplat(splatFile(blob, target.name), target.name);
        // After the render, so keeping a copy never delays first paint.
        void writeCachedSplat(target.serialize, blob);
      } catch (err) {
        setError(messageOf(err, "Could not download the finished capture"));
      } finally {
        setBusy(null);
      }
    },
    [showSplat],
  );

  useEffect(() => {
    if (!job || splat) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;

    async function poll(target: CaptureJob) {
      try {
        const report = await fetchStatus(target.serialize);
        if (stopped) return;
        failures = 0;
        setError((shown) => (shown ? null : shown));
        setStatus(report.status);
        if (report.failed) {
          setError(KIRI_STATUS_LABEL[report.status]);
          clearJob();
          return;
        }
        if (report.ready) {
          await download(target);
          return;
        }
      } catch (err) {
        // A blip during a 90-minute job is not a failure, so polling continues
        // either way — but a bad key or a dead task id looks identical to a
        // blip, so say something once the failures stop looking transient.
        failures += 1;
        if (failures >= FAILURES_BEFORE_REPORTING) {
          setError(messageOf(err, "Lost contact with KIRI"));
        }
      }
      if (!stopped) timer = setTimeout(() => poll(target), POLL_INTERVAL_MS);
    }

    // A capture already downloaded once needs neither the status check nor the
    // transfer — it renders straight from disk.
    async function start(target: CaptureJob) {
      const cached = await readCachedSplat(target.serialize);
      if (stopped) return;
      if (cached) {
        showSplat(splatFile(cached, target.name), target.name);
        return;
      }
      poll(target);
    }

    start(job);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [job, splat, download, showSplat]);

  // Drives the "waiting for N minutes" readout.
  useEffect(() => {
    if (!job || splat) return;
    const id = setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [job, splat]);

  async function handleFile(file: File | undefined) {
    setVideo(file ?? null);
    setMeta(file ? await readVideoMeta(file) : null);
    // The file is usually named after the place; save the typing.
    if (file && !name.trim()) setName(prettyName(file.name));
  }

  async function submit() {
    if (!video) return;
    setError(null);
    setBusy("uploading");
    setUploadFraction(0);
    try {
      const serialize = await uploadVideo(video, setUploadFraction);
      saveJob({ serialize, name: name.trim(), startedAt: Date.now() });
    } catch (err) {
      setError(messageOf(err, "Upload failed"));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!splat) return;
    setBusy("saving");
    setError(null);
    try {
      const placeId = await createPlace(splat.name, splat.file, "anonymous");
      if (albumId) await addPlacesToAlbum(albumId, [placeId]);
      // It serves from Storage now, so the local copy is dead weight.
      if (job) await dropCachedSplat(job.serialize);
      clearJob();
      router.push(`/place/${placeId}`);
    } catch (err) {
      setError(messageOf(err, "Could not save this environment"));
      setBusy(null);
    }
  }

  function startOver() {
    if (job) void dropCachedSplat(job.serialize);
    clearJob();
    if (splatUrlRef.current) {
      URL.revokeObjectURL(splatUrlRef.current);
      splatUrlRef.current = null;
    }
    setSplat(null);
    setStatus(null);
    setError(null);
    setName("");
    setVideo(null);
    setMeta(null);
    setUploadFraction(0);
    setFormKey((key) => key + 1);
  }

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

      {splat ? (
        <div className="mx-auto max-w-5xl px-6">
          <h1 className="mt-8 text-[34px] font-bold tracking-tight">
            {splat.name}
          </h1>
          <p className="text-neutral-500">
            Drag to look around, scroll to zoom.
          </p>

          <div className="mt-6 h-[65vh] overflow-hidden rounded-2xl bg-black ring-1 ring-black/10">
            <SplatViewer
              splatUrl={splat.url}
              pins={[]}
              placementMode={false}
              onPlacePoint={() => {}}
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={save}
              disabled={!isFirebaseConfigured || busy === "saving"}
              className="rounded-full bg-[#0071e3] px-6 py-2.5 font-medium text-white transition hover:bg-[#0077ed] disabled:opacity-40"
            >
              {busy === "saving"
                ? "Saving…"
                : albumId
                  ? "Add to Album"
                  : "Save to Photos"}
            </button>
            <a
              href={splat.url}
              download={splat.file.name}
              className="rounded-full border border-black/10 px-6 py-2.5 text-[15px] transition hover:bg-neutral-50"
            >
              Download .ply
            </a>
            <button
              onClick={startOver}
              className="px-2 text-[15px] text-[#0071e3]"
            >
              Capture Another
            </button>
          </div>

          {!isFirebaseConfigured && (
            <p className="mt-4 text-sm text-amber-600">
              Firebase isn&apos;t configured, so this can&apos;t be saved yet —
              what you see is rendering straight from the finished capture.
            </p>
          )}
          {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
        </div>
      ) : job ? (
        <div className="mx-auto max-w-xl px-6">
          <h1 className="mt-8 text-[34px] font-bold tracking-tight">
            {job.name}
          </h1>
          <p className="mt-2 text-neutral-500">
            {busy === "downloading"
              ? "Downloading your environment…"
              : status === null
                ? "Checking on it…"
                : `${KIRI_STATUS_LABEL[status]}.`}
          </p>

          <div className="mt-8 overflow-hidden rounded-full bg-neutral-100">
            <div className="h-1.5 w-1/3 animate-pulse rounded-full bg-[#0071e3]" />
          </div>

          <p className="mt-4 text-sm text-neutral-500">
            {describeWait(job.startedAt, now)} Reconstruction takes 30–90
            minutes and keeps going without you — close this tab and come back,
            and your environment will be waiting here.
          </p>

          <div className="mt-6 flex items-center gap-4">
            {error && !busy && (
              <button
                onClick={() => download(job)}
                className="rounded-full bg-[#0071e3] px-5 py-2 text-[15px] font-medium text-white transition hover:bg-[#0077ed]"
              >
                Try Again
              </button>
            )}
            <button onClick={startOver} className="text-[15px] text-[#0071e3]">
              Cancel
            </button>
          </div>
          {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
        </div>
      ) : (
        <div className="mx-auto max-w-xl px-6">
          <h1 className="mt-8 text-[34px] font-bold tracking-tight">
            New Environment
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            Upload one slow walkthrough video of the space — under{" "}
            {MAX_VIDEO_SECONDS / 60} minutes, {MAX_VIDEO_WIDTH}×
            {MAX_VIDEO_HEIGHT} or smaller. Move steadily and cover it from
            several angles and heights.
            {albumId && " It will be added to this album when it's ready."}
          </p>

          <div className="mt-8 flex flex-col gap-4">
            <label className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed border-black/20 bg-neutral-50 px-4 py-8 text-center transition hover:border-[#0071e3]">
              <span className="text-[15px] font-medium text-[#0071e3]">
                {video ? video.name : "Choose a Video"}
              </span>
              <span className="text-xs text-neutral-500">
                One continuous walkthrough works best
              </span>
              <input
                key={formKey}
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

            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What is this place called?"
              className="rounded-xl border border-black/10 bg-neutral-50 px-4 py-2.5 text-[15px] outline-none focus:border-[#0071e3]"
            />

            <button
              onClick={submit}
              disabled={!canSubmit}
              className="rounded-full bg-[#0071e3] px-6 py-2.5 font-medium text-white transition hover:bg-[#0077ed] disabled:opacity-40"
            >
              {busy === "uploading" ? "Uploading…" : "Start Capture"}
            </button>

            {busy === "uploading" && (
              <div className="overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-1.5 rounded-full bg-[#0071e3] transition-[width]"
                  style={{ width: `${Math.round(uploadFraction * 100)}%` }}
                />
              </div>
            )}

            {!isFirebaseConfigured && (
              <p className="text-sm text-amber-600">
                Firebase isn&apos;t configured, so a finished environment
                can&apos;t be saved. Capture still works — it renders here and
                can be downloaded.
              </p>
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
        </div>
      )}
    </main>
  );
}

function describeProblem({ seconds, width, height }: VideoMeta) {
  if (seconds > MAX_VIDEO_SECONDS) {
    return `too long, max ${MAX_VIDEO_SECONDS / 60} minutes`;
  }
  // KIRI documents the cap as a frame size, not an orientation, and phones
  // record portrait — so measure the long and short sides, not width and
  // height, or every handheld walkthrough gets rejected at 1080×1920.
  if (
    Math.max(width, height) > MAX_VIDEO_WIDTH ||
    Math.min(width, height) > MAX_VIDEO_HEIGHT
  ) {
    return `too large, max ${MAX_VIDEO_WIDTH}×${MAX_VIDEO_HEIGHT}`;
  }
  return null;
}

function describeWait(startedAt: number, now: number) {
  const minutes = Math.floor((now - startedAt) / 60_000);
  if (minutes < 1) return "Just started.";
  return `Waiting ${minutes} minute${minutes === 1 ? "" : "s"} so far.`;
}

function prettyName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
}

function splatFile(blob: Blob, name: string) {
  return new File([blob], `${slug(name)}.ply`, {
    type: "application/octet-stream",
  });
}

function slug(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "capture"
  );
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
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
