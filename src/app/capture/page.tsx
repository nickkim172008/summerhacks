"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
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

  // An object URL pins its blob — a hundred-odd megabytes here — until it is
  // revoked, so the live one is tracked in a ref and released when it is
  // replaced, when the page goes away, or when a download lands too late.
  const splatUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const showSplat = useCallback((file: File, name: string) => {
    if (splatUrlRef.current) URL.revokeObjectURL(splatUrlRef.current);
    splatUrlRef.current = null;
    if (!mountedRef.current) return;
    const url = URL.createObjectURL(file);
    splatUrlRef.current = url;
    setSplat({ url, file, name });
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
        setError(messageOf(err, "Could not download the finished splat"));
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
  }

  async function submit() {
    if (!video) return;
    setError(null);
    setBusy("uploading");
    setUploadFraction(0);
    try {
      const serialize = await uploadVideo(video, setUploadFraction);
      const started: CaptureJob = {
        serialize,
        name: name.trim(),
        startedAt: Date.now(),
      };
      saveJob(started);
    } catch (err) {
      setError(messageOf(err, "Upload failed"));
    } finally {
      setBusy(null);
    }
  }

  async function saveToAtlas() {
    if (!splat) return;
    setBusy("saving");
    setError(null);
    try {
      const placeId = await createPlace(splat.name, splat.file, "anonymous");
      // The place serves from Storage now, so the local copy is dead weight.
      if (job) await dropCachedSplat(job.serialize);
      clearJob();
      router.push(`/place/${placeId}`);
    } catch (err) {
      setError(messageOf(err, "Could not save this place"));
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

  if (splat) {
    return (
      <div className="min-h-screen w-full bg-black text-white">
        <main className="mx-auto w-full max-w-5xl px-6 py-10">
          <header className="flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="text-2xl font-semibold">{splat.name}</h1>
            <p className="text-sm text-neutral-400">
              {(splat.file.size / 1e6).toFixed(0)} MB of splats, rendering live
            </p>
          </header>

          <div className="mt-6 h-[65vh] overflow-hidden rounded-xl bg-neutral-950">
            <SplatViewer
              splatUrl={splat.url}
              pins={[]}
              placementMode={false}
              onPlacePoint={() => {}}
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={saveToAtlas}
              disabled={!isFirebaseConfigured || busy === "saving"}
              className="rounded-full bg-sky-500 px-6 py-2 font-medium disabled:opacity-40"
            >
              {busy === "saving" ? "Saving…" : "Save to the atlas"}
            </button>
            <a
              href={splat.url}
              download={splat.file.name}
              className="rounded-full border border-neutral-700 px-6 py-2 text-sm"
            >
              Download .ply
            </a>
            <button
              onClick={startOver}
              className="text-sm text-neutral-400 underline"
            >
              Capture another
            </button>
          </div>

          {!isFirebaseConfigured && (
            <p className="mt-4 text-sm text-amber-400">
              Firebase isn&apos;t configured, so this can&apos;t join the atlas
              yet — the splat above is rendering straight from the download.
            </p>
          )}
          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-black text-white">
      <main className="mx-auto w-full max-w-xl px-6 py-12">
        <h1 className="text-2xl font-semibold">Capture a place</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Upload one slow walkthrough video of the space — under{" "}
          {MAX_VIDEO_SECONDS / 60} minutes, {MAX_VIDEO_WIDTH}×{MAX_VIDEO_HEIGHT}{" "}
          or smaller. Move steadily and cover it from several angles and
          heights. KIRI reconstructs it into a Gaussian splat, which renders
          here as soon as it lands.
        </p>

        {job ? (
          <section className="mt-8 rounded-xl bg-neutral-900 p-5">
            <h2 className="font-medium">{job.name}</h2>
            <p className="mt-2 text-sm text-neutral-300">
              {busy === "downloading"
                ? "Downloading the finished splat…"
                : status === null
                  ? "Checking with KIRI…"
                  : KIRI_STATUS_LABEL[status]}
            </p>
            <p className="mt-1 text-sm text-neutral-500">
              {describeWait(job.startedAt, now)} Reconstruction takes 30–90
              minutes. You can close this tab — reopen /capture and it picks the
              job back up.
            </p>
            <p className="mt-3 font-mono text-xs text-neutral-600">
              task {job.serialize}
            </p>
            <div className="mt-4 flex items-center gap-4">
              {error && !busy && (
                <button
                  onClick={() => download(job)}
                  className="rounded-full bg-sky-500 px-5 py-1.5 text-sm font-medium"
                >
                  Try the download again
                </button>
              )}
              <button
                onClick={startOver}
                className="text-sm text-neutral-400 underline"
              >
                Forget this job
              </button>
            </div>
          </section>
        ) : (
          <div className="mt-8 flex flex-col gap-4">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What is this place called?"
              className="rounded bg-neutral-900 px-3 py-2 outline-none"
            />

            <input
              key={formKey}
              type="file"
              accept="video/*"
              onChange={(e) => handleFile(e.target.files?.[0])}
              className="text-sm text-neutral-400"
            />

            {meta && (
              <p
                className={`text-sm ${problem ? "text-amber-400" : "text-neutral-400"}`}
              >
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

            {busy === "uploading" && (
              <p className="text-sm text-neutral-300">
                Sending the walkthrough to KIRI —{" "}
                {Math.round(uploadFraction * 100)}%
              </p>
            )}
          </div>
        )}

        {!isFirebaseConfigured && (
          <p className="mt-6 text-sm text-amber-400">
            Firebase isn&apos;t configured, so a finished place can&apos;t be
            saved to the atlas. Capture still works — the splat renders here and
            can be downloaded. Fill in <code>.env.local</code> to keep it.
          </p>
        )}
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <Link
          href="/"
          className="mt-8 inline-block text-sm text-neutral-500 underline"
        >
          Back to the atlas
        </Link>
      </main>
    </div>
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
  if (!now || minutes < 1) return "Just started.";
  return `Waiting ${minutes} minute${minutes === 1 ? "" : "s"} so far.`;
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
