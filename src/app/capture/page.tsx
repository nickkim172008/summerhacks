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
  dropCachedAudio,
  dropCachedSplat,
  readCachedAudio,
  readCachedSplat,
  writeCachedAudio,
  writeCachedSplat,
} from "@/lib/splatCache";
import { extractAudio, type ExtractedAudio } from "@/lib/audioTrack";
import { readVideoCapture, type VideoCapture } from "@/lib/videoMeta";
import { createPlace } from "@/lib/places";
import { addPlacesToAlbum } from "@/lib/albums";
import { isFirebaseConfigured } from "@/lib/firebase";
import { useAuth } from "@/lib/auth";
import { getLiveLocation } from "@/lib/geolocation";
import { uploadVideoFile } from "@/lib/splatStore";

const SplatViewer = dynamic(() => import("@/components/SplatViewer"), {
  ssr: false,
});

const POLL_INTERVAL_MS = 20_000;
const CLOCK_INTERVAL_MS = 30_000;
const FAILURES_BEFORE_REPORTING = 3;

/** Pitch mode: upload video to Firebase Storage, skip the KIRI wait. */
const DEMO_CAPTURE = process.env.NEXT_PUBLIC_DEMO_CAPTURE === "true";
/**
 * uploadBytes reports no progress of its own, so the archive upload is given a
 * flat slice of the bar and KIRI's upload drives what is left.
 */
const VIDEO_UPLOAD_FRACTION = 0.15;

type Busy = "uploading" | "downloading" | "saving" | null;
type VideoMeta = { seconds: number; width: number; height: number };
/** Where a prefilled answer came from, which decides how much to trust it. */
type Provenance = "video" | "file" | "none";

export default function CapturePage() {
  return (
    <Suspense fallback={null}>
      <CaptureFlow />
    </Suspense>
  );
}

function CaptureFlow() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useSearchParams();
  const albumId = params.get("album");
  // "Capture New Environment" asks for a blank form. Without this, /capture
  // resumes the saved job and the entry point shows the last render instead.
  const startingNew = params.get("new") === "1";
  const [name, setName] = useState("");
  const [video, setVideo] = useState<File | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [capture, setCapture] = useState<VideoCapture | null>(null);
  const [whenLocal, setWhenLocal] = useState("");
  const [whenFrom, setWhenFrom] = useState<Provenance>("none");
  const [locationName, setLocationName] = useState("");
  // undefined while the track is still being lifted, null when there is none.
  const [audio, setAudio] = useState<ExtractedAudio | null | undefined>(
    undefined,
  );
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
  const [demoQueued, setDemoQueued] = useState(false);

  const problem = !DEMO_CAPTURE && meta && describeProblem(meta);
  // `capture` gates submission so the video's own answers are in hand before
  // the job that has to carry them is written.
  const canSubmit = Boolean(
    name.trim() && video && capture && !problem && !busy,
  );
  const backHref = albumId ? `/album/${albumId}` : "/";
  const resumeHref = albumId ? `/capture?album=${albumId}` : "/capture";
  const jobDetails = job && describeCapture(job);

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
    if (!job || splat || startingNew) return;
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
  }, [job, splat, startingNew, download, showSplat]);

  // Drives the "waiting for N minutes" readout.
  useEffect(() => {
    if (!job || splat || startingNew) return;
    const id = setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [job, splat, startingNew]);

  // The lift runs alongside the upload, so what submit waits on is the promise
  // rather than the finished track. The counter keeps a slow read of one video
  // from answering for the video the user has since picked instead.
  const liftRef = useRef<Promise<ExtractedAudio | null> | null>(null);
  const pickRef = useRef(0);

  /**
   * Everything only the video can answer is read here, while the File is in
   * hand: after a reload there is no File left, and the splat it belongs to is
   * still 30-90 minutes out.
   */
  async function handleFile(file: File | undefined) {
    const pick = (pickRef.current += 1);
    const current = () => pickRef.current === pick;
    // Whatever the last pick started is now about a video nobody chose.
    liftRef.current = null;

    setVideo(file ?? null);
    setMeta(null);
    setCapture(null);
    setWhenLocal("");
    setWhenFrom("none");
    setLocationName("");
    setAudio(undefined);
    if (!file) return;

    const nextMeta = await readVideoMeta(file);
    if (!current()) return;
    setMeta(nextMeta);

    // The file is usually named after the place; save the typing.
    if (!name.trim()) setName(prettyName(file.name));

    const found = await readVideoCapture(file);
    if (!current()) return;
    setCapture(found);
    const when = found.capturedAt ?? fileDate(file);
    setWhenLocal(when ? toLocalInput(when) : "");
    setWhenFrom(found.capturedAt ? "video" : when ? "file" : "none");

    // Only now, and never for a video the gate has already refused: extractAudio
    // pulls the entire file through memory and decodes it, which on the 4K
    // twelve-minute recording being turned away is gigabytes spent on nothing.
    if (!DEMO_CAPTURE && nextMeta && describeProblem(nextMeta)) return;
    const lifting = liftAudio(file);
    // Assigned before yielding, so a submit fired the moment the form unlocks
    // finds this promise rather than nothing.
    liftRef.current = lifting;

    const track = await lifting;
    if (current()) setAudio(track);
  }

  async function submit() {
    if (!video) return;
    // Taken before the first await: the ref answers for whichever video is
    // chosen now, and this job wants the sound of the one it is uploading.
    const lifting = liftRef.current;
    setError(null);
    setBusy("uploading");
    setUploadFraction(0);

    if (DEMO_CAPTURE) {
      try {
        // Pitch path: put the walkthrough in Firebase Storage, no KIRI wait.
        if (!isFirebaseConfigured) {
          throw new Error(
            "Firebase isn't configured — add Storage keys to .env.local.",
          );
        }
        setUploadFraction(0.2);
        await uploadVideoFile(storageKeyFor(user?.uid), video);
        setUploadFraction(1);
        setDemoQueued(true);
      } catch (err) {
        setError(messageOf(err, "Video upload failed"));
      } finally {
        setBusy(null);
      }
      return;
    }

    try {
      // The walkthrough is archived in Firebase first, then a copy goes to
      // KIRI: the source video outlives the reconstruction that consumes it.
      setUploadFraction(0.05);
      const videoUrl = isFirebaseConfigured
        ? await uploadVideoFile(storageKeyFor(user?.uid), video)
        : undefined;
      setUploadFraction(VIDEO_UPLOAD_FRACTION);
      const serialize = await uploadVideo(video, (fraction) =>
        setUploadFraction(
          VIDEO_UPLOAD_FRACTION + fraction * (1 - VIDEO_UPLOAD_FRACTION),
        ),
      );
      const track = await lifting;
      // Megabytes of samples cannot go in localStorage beside the job, so the
      // job carries their length and Cache Storage carries the bytes, both
      // under the serialize that will still be here after a reload.
      if (track) await writeCachedAudio(serialize, track.file);
      saveJob({
        serialize,
        name: name.trim(),
        startedAt: Date.now(),
        videoUrl,
        capturedAt: toIso(whenLocal),
        location: capture?.location ?? undefined,
        locationName: locationName.trim() || undefined,
        audioSeconds: track?.seconds,
      });
      if (startingNew) router.replace(resumeHref);
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
      // Both the audio and the details were put aside at upload time; this is
      // the first moment there is a place to attach them to.
      const wav = job ? await readCachedAudio(job.serialize) : null;
      // Where the video says it was filmed is the true answer. The device's own
      // position only stands in for a walkthrough that carried no GPS — which
      // is what puts the place on the Map tab either way.
      const location =
        job?.location ?? (await getLiveLocation().catch(() => null));
      const placeId = await createPlace(
        splat.name,
        await toSpz(splat),
        user?.uid ?? "anonymous",
        {
          location,
          locationName: job?.locationName,
          capturedAt: job?.capturedAt,
          audioFile: wav && wavFile(wav, splat.name),
          audioSeconds: job?.audioSeconds,
          videoFile: video,
          videoUrl: job?.videoUrl,
        },
      );
      if (albumId) await addPlacesToAlbum(albumId, [placeId]);
      // They serve from the place now, so the local copies are dead weight.
      if (job) {
        await dropCachedSplat(job.serialize);
        await dropCachedAudio(job.serialize);
      }
      clearJob();
      // The place page reads ?album= to know where its Back button goes, so a
      // capture made into an album has to leave with the album still in hand.
      router.push(
        albumId ? `/place/${placeId}?album=${albumId}` : `/place/${placeId}`,
      );
    } catch (err) {
      setError(messageOf(err, "Could not save this environment"));
      setBusy(null);
    }
  }

  function startOver() {
    if (job) {
      void dropCachedSplat(job.serialize);
      void dropCachedAudio(job.serialize);
    }
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
    setCapture(null);
    setWhenLocal("");
    setWhenFrom("none");
    setLocationName("");
    setAudio(undefined);
    // A lift still running belongs to a video that is no longer chosen.
    pickRef.current += 1;
    liftRef.current = null;
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

      {demoQueued ? (
        <div className="mx-auto max-w-xl px-6 pt-16 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#0071e3]/10 text-2xl text-[#0071e3]">
            ✓
          </div>
          <h1 className="mt-6 text-[28px] font-bold tracking-tight">
            Video uploaded
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            <span className="font-medium text-[#1d1d1f]">{name.trim()}</span> is
            in Firebase Storage. In production it would reconstruct for 30–90
            minutes, then show up as a walkable environment
            {albumId ? " in this album" : ""}.
          </p>
          <Link
            href={backHref}
            className="mt-8 inline-block rounded-full bg-[#0071e3] px-6 py-2.5 font-medium text-white transition hover:bg-[#0077ed]"
          >
            {albumId ? "Back to Album" : "Back to Albums"}
          </Link>
        </div>
      ) : splat ? (
        <div className="mx-auto max-w-5xl px-6">
          <h1 className="mt-8 text-[34px] font-bold tracking-tight">
            {splat.name}
          </h1>
          {jobDetails && (
            <p className="text-[15px] text-neutral-500">{jobDetails}</p>
          )}
          <p className="text-neutral-500">
            Drag to look around, scroll to zoom.
          </p>

          <div className="mt-6 h-[65vh] overflow-hidden rounded-2xl bg-black ring-1 ring-black/10">
            <SplatViewer
              splatUrl={splat.url}
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
      ) : job && !startingNew ? (
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

          {jobDetails && (
            <p className="mt-2 text-sm text-neutral-500">
              {jobDetails} — saved with it.
            </p>
          )}

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

          {job && (
            <div className="mt-6 flex items-center justify-between gap-4 rounded-xl border border-black/10 bg-neutral-50 px-4 py-3">
              <p className="text-sm text-neutral-500">
                <span className="font-medium text-[#1d1d1f]">{job.name}</span>{" "}
                is already captured on this device. Starting a new one replaces
                it.
              </p>
              <Link
                href={resumeHref}
                className="shrink-0 text-[15px] text-[#0071e3]"
              >
                Open
              </Link>
            </div>
          )}

          <div className="mt-8 flex flex-col gap-4">
            <label
              className={`flex flex-col items-center gap-1 rounded-xl border border-dashed border-black/20 bg-neutral-50 px-4 py-8 text-center transition ${
                busy ? "opacity-50" : "cursor-pointer hover:border-[#0071e3]"
              }`}
            >
              <span className="text-[15px] font-medium text-[#0071e3]">
                {video ? video.name : "Choose a Video"}
              </span>
              <span className="text-xs text-neutral-500">
                {busy
                  ? "Choose another once this one is on its way"
                  : "One continuous walkthrough works best"}
              </span>
              <input
                key={formKey}
                type="file"
                accept="video/*"
                // An upload runs for minutes. A second video picked partway
                // through would hand its own sound and GPS to the job already
                // carrying the first one.
                disabled={Boolean(busy)}
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

            {/* A refused video is never listened to, so it has nothing to say. */}
            {video && !problem && (
              <p className="text-sm text-neutral-500">{describeAudio(audio)}</p>
            )}

            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What is this place called?"
              className="rounded-xl border border-black/10 bg-neutral-50 px-4 py-2.5 text-[15px] outline-none focus:border-[#0071e3]"
            />

            {capture && (
              <section className="flex flex-col gap-4 rounded-xl border border-black/10 px-4 py-4">
                <div>
                  <h2 className="text-[15px] font-medium">Where and when</h2>
                  <p className="text-xs text-neutral-500">
                    Kept with the environment. Anything the video did not carry
                    is yours to correct, fill in, or leave blank.
                  </p>
                </div>

                <label className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-2 text-[13px] text-neutral-500">
                    Filmed
                    <Source from={whenFrom} />
                  </span>
                  <input
                    type="datetime-local"
                    value={whenLocal}
                    onChange={(e) => setWhenLocal(e.target.value)}
                    className="rounded-xl border border-black/10 bg-neutral-50 px-4 py-2.5 text-[15px] outline-none focus:border-[#0071e3]"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-2 text-[13px] text-neutral-500">
                    Location
                    <Source from={capture.location ? "video" : "none"} />
                  </span>
                  {capture.location && (
                    <span className="text-[15px] tabular-nums">
                      {formatCoords(capture.location)}
                    </span>
                  )}
                  <input
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    placeholder={
                      capture.location
                        ? "Name it in words too, like Grandma's kitchen"
                        : "Where was this? Type it in"
                    }
                    className="rounded-xl border border-black/10 bg-neutral-50 px-4 py-2.5 text-[15px] outline-none focus:border-[#0071e3]"
                  />
                </label>
              </section>
            )}

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

            {!isFirebaseConfigured && !DEMO_CAPTURE && (
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

/**
 * Which answers came off the video, which are only a guess, and which the user
 * owes us. The middle one is the one worth being loud about: it looks filled in
 * whether or not it is right.
 */
function Source({ from }: { from: Provenance }) {
  if (from === "video") {
    return (
      <span className="rounded-full bg-[#0071e3]/10 px-2 py-0.5 text-[11px] font-medium text-[#0071e3]">
        From the video
      </span>
    );
  }
  if (from === "file") {
    return (
      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700">
        Guessed from the file — please check
      </span>
    );
  }
  return (
    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">
      Not in the video
    </span>
  );
}

/**
 * The last resort once the container carried no date of its own. It is the
 * file's timestamp, not the shoot's — a download, an AirDrop or an export all
 * rewrite it, and a browser that cannot read one is allowed to hand back the
 * current time — so it is offered as something to correct, never as an answer.
 */
function fileDate(file: File) {
  const ms = file.lastModified;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

/**
 * A walkthrough whose audio cannot be read is still a walkthrough, so nothing
 * that happens in here reaches the upload it runs alongside.
 */
async function liftAudio(file: File) {
  try {
    return await extractAudio(file, slug(prettyName(file.name)));
  } catch {
    // A container this browser cannot open, or a file that moved out from
    // under the read. Either way the environment is saved silent.
    return null;
  }
}

function describeAudio(audio: ExtractedAudio | null | undefined) {
  if (audio === undefined) return "Lifting the sound off the video…";
  if (!audio) {
    return "No sound this browser can read — the environment will be silent.";
  }
  return `${formatClock(audio.seconds)} of sound, which plays when you walk in.`;
}

function describeCapture(job: CaptureJob) {
  const parts: string[] = [];
  if (job.capturedAt) parts.push(`Filmed ${formatWhen(job.capturedAt)}`);
  const where =
    job.locationName ?? (job.location ? formatCoords(job.location) : null);
  if (where) parts.push(where);
  if (job.audioSeconds) parts.push(`${formatClock(job.audioSeconds)} of sound`);
  return parts.join(" · ");
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

/**
 * The video is archived before there is a place to hang it on, so it is filed
 * under whoever uploaded it and when, not under a place id.
 */
function storageKeyFor(uid: string | undefined) {
  return `${uid ?? "anonymous"}/${Date.now()}`;
}

/**
 * A datetime-local input speaks wall clock and carries no offset, so the
 * instant is shifted into the viewer's zone on the way in. Date reads an
 * offsetless string back against that same zone, which is what toIso relies on.
 */
function toLocalInput(iso: string) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const shifted = ms - new Date(ms).getTimezoneOffset() * 60_000;
  return new Date(shifted).toISOString().slice(0, 16);
}

/** Undefined for a field left empty, which is a legitimate answer here. */
function toIso(local: string) {
  const ms = Date.parse(local);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function formatWhen(iso: string) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Five decimals is about a metre — past that it is noise from the phone. */
function formatCoords({ lat, lng }: { lat: number; lng: number }) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function formatClock(seconds: number) {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function wavFile(blob: Blob, name: string) {
  return new File([blob], `${slug(name)}.wav`, { type: "audio/wav" });
}

function prettyName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
}

/**
 * KIRI returns float32 PLY — 65MB for a small room, most of it spherical
 * harmonics stored at full precision. SPZ quantizes them to roughly a
 * thirteenth of the size with no visible loss, and Spark reads it natively,
 * so only the compressed copy is ever uploaded or served.
 *
 * Spark is imported lazily: the form and progress views have no use for it.
 */
async function toSpz({ file, name }: { file: File; name: string }) {
  const { transcodeSpz } = await import("@sparkjsdev/spark");
  const { fileBytes } = await transcodeSpz({
    inputs: [{ fileBytes: new Uint8Array(await file.arrayBuffer()) }],
  });
  return new File([fileBytes as BlobPart], `${slug(name)}.spz`, {
    type: "application/octet-stream",
  });
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
