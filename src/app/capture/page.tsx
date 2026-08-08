"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  KIRI_STATUS_LABEL,
  MAX_VIDEO_HEIGHT,
  MAX_VIDEO_SECONDS,
  MAX_VIDEO_WIDTH,
} from "@/lib/kiri";
import { fetchSplat, fetchStatus, uploadVideo } from "@/lib/captureJob";
import {
  parseJobs,
  readJobsSnapshot,
  removeJob,
  saveJob,
  subscribeToJobs,
} from "@/lib/captureQueue";
import {
  AUDIO_LIMIT,
  createLimiter,
  DOWNLOAD_LIMIT,
  SAVE_LIMIT,
  UPLOAD_LIMIT,
} from "@/lib/limiter";
import {
  activeCount,
  audioCacheTargets,
  audioTargets,
  canStart,
  checkTargets,
  createQueue,
  downloadTargets,
  pickedItem,
  pollTargets,
  reduceQueue,
  resumedItem,
  saveTargets,
  uploadTargets,
  type CaptureDetails,
  type CaptureItem,
  type SplatHandle,
  type VideoMeta,
} from "@/lib/captureRunner";
import {
  dropCachedAudio,
  dropCachedSplat,
  readCachedAudio,
  readCachedSplat,
  writeCachedAudio,
  writeCachedSplat,
} from "@/lib/splatCache";
import { extractAudio } from "@/lib/audioTrack";
import { readVideoCapture, type VideoCapture } from "@/lib/videoMeta";
import { createPlace } from "@/lib/places";
import { addPlacesToAlbum } from "@/lib/albums";
import { isFirebaseConfigured } from "@/lib/firebase";
import CaptureQueue from "@/components/CaptureQueue";
import { useAuth } from "@/lib/auth";
import { getLiveLocation } from "@/lib/geolocation";
import { uploadVideoFile } from "@/lib/splatStore";

const SplatViewer = dynamic(() => import("@/components/SplatViewer"), {
  ssr: false,
});

const POLL_INTERVAL_MS = 20_000;
/**
 * A gap between the status checks of one sweep. They already go one at a time,
 * but firing N of them back to back still buys nothing and spends the connection
 * budget the downloads need.
 */
const POLL_STAGGER_MS = 1_500;
const CLOCK_INTERVAL_MS = 30_000;

/** Pitch mode: upload video to Firebase Storage, skip the KIRI wait. */
const DEMO_CAPTURE = process.env.NEXT_PUBLIC_DEMO_CAPTURE === "true";
/**
 * uploadBytes reports no progress of its own, so the archive upload is given a
 * flat slice of the bar and KIRI's upload drives what is left.
 */
const VIDEO_UPLOAD_FRACTION = 0.15;

/** The server has no localStorage, so it renders as if nothing were queued. */
const emptySnapshot = () => "{}";

let rowCounter = 0;
/** React's key. Deliberately not the KIRI task id — a picked video has none. */
function nextRowId() {
  rowCounter += 1;
  return `row-${rowCounter}`;
}
/**
 * Pitch mode has no KIRI job to wait on, so the bar is walked through a few
 * steps to show the archive upload actually going somewhere.
 */
const DEMO_UPLOAD_STEPS = [0.2, 0.55, 0.85, 1];
const DEMO_STEP_MS = 220;

export default function CapturePage() {
  return (
    <Suspense fallback={null}>
      <CaptureFlow />
    </Suspense>
  );
}

function CaptureFlow() {
  const { user } = useAuth();
  const params = useSearchParams();
  const albumId = params.get("album");
  // "Capture New Environment" asks for a blank form. The queue still lists what
  // is in flight — losing sight of a running job would be worse — but nothing
  // opens itself over the form.
  const startingNew = params.get("new") === "1";

  const [queue, dispatch] = useReducer(reduceQueue, !startingNew, createQueue);
  const [formKey, setFormKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // The jobs live in localStorage, not in state: reconstruction outlasts the
  // tab, so a reload — or a second tab — has to find them still waiting.
  const storedJobs = useSyncExternalStore(
    subscribeToJobs,
    readJobsSnapshot,
    emptySnapshot,
  );
  // Storage hands back the newest first; the queue reads chronologically.
  const jobs = useMemo(
    () => parseJobs(storedJobs).slice().reverse(),
    [storedJobs],
  );

  const mountedRef = useRef(true);
  const urlsRef = useRef<Map<string, string>>(new Map());
  /**
   * Which rows already have their stage running. Phases alone would nearly do
   * it, but an effect re-runs before its dispatch has been rendered, and a
   * second upload of the same video is not a mistake worth risking.
   */
  const claimedRef = useRef<Set<string>>(new Set());
  /** Rows dropped while their upload was still in the air. */
  const discardedRef = useRef<Set<string>>(new Set());
  const itemsRef = useRef<CaptureItem[]>(queue.items);

  const uploadLimit = useMemo(() => createLimiter(UPLOAD_LIMIT), []);
  const downloadLimit = useMemo(() => createLimiter(DOWNLOAD_LIMIT), []);
  const saveLimit = useMemo(() => createLimiter(SAVE_LIMIT), []);
  const audioLimit = useMemo(() => createLimiter(AUDIO_LIMIT), []);

  useEffect(() => {
    // The poll loop is mounted once and never restarted — resetting its timer on
    // every state change would push the next status check out for as long as
    // anything kept changing — so it reads its targets from here instead.
    itemsRef.current = queue.items;
  });

  useEffect(() => {
    mountedRef.current = true;
    const urls = urlsRef.current;
    return () => {
      mountedRef.current = false;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  /**
   * Every row owns its object URL and revokes only that one. Releasing the
   * previous URL on each new capture — which is what a single shared handle
   * amounts to — would blank a splat another row still has on screen.
   */
  const attachSplat = useCallback(
    (id: string, file: File, name: string): SplatHandle | null => {
      // A transfer that lands after its row was dropped, or after the page went
      // away, would otherwise pin its blob with nothing left to revoke it.
      if (!mountedRef.current || discardedRef.current.has(id)) return null;
      const previous = urlsRef.current.get(id);
      if (previous) URL.revokeObjectURL(previous);
      const url = URL.createObjectURL(file);
      urlsRef.current.set(id, url);
      return { url, file, name };
    },
    [],
  );

  const releaseSplat = useCallback((id: string) => {
    const url = urlsRef.current.get(id);
    if (url) URL.revokeObjectURL(url);
    urlsRef.current.delete(id);
  }, []);

  // Storage into the queue. This is how a reload picks its jobs back up, and how
  // a job started in another tab turns up here.
  useEffect(() => {
    dispatch({
      type: "added",
      items: jobs.map((job) => resumedItem(nextRowId(), job)),
    });
  }, [jobs]);

  const runCheck = useCallback(
    async (item: CaptureItem) => {
      if (item.file) {
        const file = item.file;
        const meta = await readVideoMeta(file);
        // Everything only the video can answer, read while the File is in hand:
        // after a reload there is no File left and the splat is still an hour out.
        const found = await readVideoCapture(file);
        if (!mountedRef.current) return;
        const when = found.capturedAt ?? fileDate(file);
        dispatch({
          type: "meta-read",
          id: item.id,
          meta,
          // Demo mode never reaches KIRI, so KIRI's limits are not this row's
          // problem. An unreadable file is let through as it always was: the
          // server rejects what it must.
          problem: DEMO_CAPTURE || !meta ? null : describeProblem(meta),
          details: toDetails(found, when),
        });
        return;
      }
      if (!item.serialize) return;
      const cached = await readCachedSplat(item.serialize);
      if (!mountedRef.current) return;
      dispatch({
        type: "cache-checked",
        id: item.id,
        splat: cached
          ? attachSplat(item.id, splatFile(cached, item.name), item.name)
          : null,
      });
    },
    [attachSplat],
  );

  const runUpload = useCallback(
    async (item: CaptureItem) => {
      const file = item.file;
      if (!file) return;

      // The walkthrough is archived in Firebase first, then a copy goes to
      // KIRI: the source video outlives the reconstruction that consumes it.
      const archive = () =>
        isFirebaseConfigured
          ? uploadVideoFile(storageKeyFor(user?.uid), file)
          : Promise.resolve(null);

      if (DEMO_CAPTURE) {
        // No KIRI call, but the progress bar still moves — a frozen one reads as
        // broken on a projector.
        try {
          for (const fraction of DEMO_UPLOAD_STEPS) {
            await sleep(DEMO_STEP_MS);
            if (!mountedRef.current) return;
            dispatch({ type: "upload-progress", id: item.id, fraction });
          }
          const videoUrl = await uploadLimit(archive);
          dispatch({
            type: "demo-queued",
            id: item.id,
            startedAt: Date.now(),
            videoUrl,
          });
        } catch (err) {
          dispatch({
            type: "upload-failed",
            id: item.id,
            message: messageOf(err, "Video upload failed"),
          });
          claimedRef.current.delete(`upload:${item.id}`);
        }
        return;
      }

      try {
        const { serialize, videoUrl } = await uploadLimit(async () => {
          const archived = await archive();
          dispatch({
            type: "upload-progress",
            id: item.id,
            fraction: VIDEO_UPLOAD_FRACTION,
          });
          const id = await uploadVideo(file, (fraction) =>
            dispatch({
              type: "upload-progress",
              id: item.id,
              fraction:
                VIDEO_UPLOAD_FRACTION + fraction * (1 - VIDEO_UPLOAD_FRACTION),
            }),
          );
          return { serialize: id, videoUrl: archived };
        });
        const startedAt = Date.now();
        dispatch({
          type: "upload-succeeded",
          id: item.id,
          serialize,
          startedAt,
          videoUrl,
        });
        // A row dropped mid-upload must not come back from the dead: persisting
        // the job now would have the next reconcile read it as one to resume.
        if (!discardedRef.current.has(item.id)) {
          saveJob({
            serialize,
            name: item.name.trim() || "Untitled",
            startedAt,
            albumId: item.albumId ?? undefined,
            videoUrl: videoUrl ?? undefined,
            capturedAt: item.capturedAt ?? undefined,
            location: item.location ?? undefined,
            locationName: item.locationName.trim() || undefined,
            audioSeconds: item.audio?.seconds,
          });
        }
      } catch (err) {
        dispatch({
          type: "upload-failed",
          id: item.id,
          message: messageOf(err, "Upload failed"),
        });
        claimedRef.current.delete(`upload:${item.id}`);
      }
    },
    [uploadLimit, user?.uid],
  );

  const runDownload = useCallback(
    async (item: CaptureItem) => {
      const serialize = item.serialize;
      if (!serialize) return;
      try {
        const blob = await downloadLimit(() => fetchSplat(serialize));
        const splat = attachSplat(
          item.id,
          splatFile(blob, item.name),
          item.name,
        );
        if (!splat) return;
        dispatch({ type: "download-succeeded", id: item.id, splat });
        // After the render, so keeping a copy never delays first paint.
        void writeCachedSplat(serialize, blob);
      } catch (err) {
        dispatch({
          type: "download-failed",
          id: item.id,
          message: messageOf(err, "Could not download the finished capture"),
        });
      } finally {
        claimedRef.current.delete(`download:${item.id}`);
      }
    },
    [downloadLimit, attachSplat],
  );

  const runSave = useCallback(
    async (item: CaptureItem) => {
      const splat = item.splat;
      if (!splat) return;
      try {
        await saveLimit(async () => {
          // Both the sound and the details were put aside at upload time; this
          // is the first moment there is a place to attach them to.
          const wav = item.serialize
            ? await readCachedAudio(item.serialize)
            : null;
          // Where the video says it was filmed is the true answer. The device's
          // own position only stands in for a walkthrough that carried no GPS —
          // which is what puts the place on the Map tab either way.
          const location =
            item.location ?? (await getLiveLocation().catch(() => null));
          const placeId = await createPlace(
            splat.name,
            await toSpz(splat),
            user?.uid ?? "anonymous",
            {
              location,
              locationName: item.locationName.trim() || undefined,
              capturedAt: item.capturedAt ?? undefined,
              audioFile: wav && wavFile(wav, splat.name),
              audioSeconds: item.audioSeconds ?? undefined,
              videoFile: item.file,
              videoUrl: item.videoUrl,
            },
          );
          const album = item.albumId ?? albumId;
          if (album) await addPlacesToAlbum(album, [placeId]);
          // It serves from Storage now, so the local copies and the resume
          // record are all dead weight.
          if (item.serialize) {
            await dropCachedSplat(item.serialize);
            await dropCachedAudio(item.serialize);
            removeJob(item.serialize);
          }
          // No navigation: leaving this page would unmount every other capture
          // still uploading, reconstructing or downloading beside this one.
          dispatch({ type: "save-succeeded", id: item.id, placeId });
        });
      } catch (err) {
        dispatch({
          type: "save-failed",
          id: item.id,
          message: messageOf(err, "Could not save this environment"),
        });
      } finally {
        claimedRef.current.delete(`save:${item.id}`);
      }
    },
    [saveLimit, albumId, user?.uid],
  );

  // The lift runs beside the upload rather than before it, so a row is never
  // held at the gate waiting for its own sound.
  useEffect(() => {
    const claimed = claimedRef.current;
    for (const item of audioTargets(queue.items)) {
      if (claimed.has(`audio:${item.id}`)) continue;
      claimed.add(`audio:${item.id}`);
      const file = item.file;
      if (!file) continue;
      void audioLimit(() => liftAudio(file)).then((audio) => {
        if (!mountedRef.current) return;
        dispatch({ type: "audio-lifted", id: item.id, audio });
      });
    }
  }, [queue.items, audioLimit]);

  // Samples are megabytes, so they go to Cache Storage under the task id while
  // the job beside them carries only their length.
  useEffect(() => {
    const claimed = claimedRef.current;
    for (const item of audioCacheTargets(queue.items)) {
      const key = `audio-cache:${item.serialize}`;
      if (claimed.has(key)) continue;
      claimed.add(key);
      const serialize = item.serialize;
      const audio = item.audio;
      if (!serialize || !audio) continue;
      void writeCachedAudio(serialize, audio.file);
    }
  }, [queue.items]);

  useEffect(() => {
    const claimed = claimedRef.current;
    for (const item of checkTargets(queue.items)) {
      if (claimed.has(`check:${item.id}`)) continue;
      claimed.add(`check:${item.id}`);
      void runCheck(item);
    }
  }, [queue.items, runCheck]);

  useEffect(() => {
    const claimed = claimedRef.current;
    for (const item of uploadTargets(queue.items)) {
      if (claimed.has(`upload:${item.id}`)) continue;
      claimed.add(`upload:${item.id}`);
      void runUpload(item);
    }
  }, [queue.items, runUpload]);

  useEffect(() => {
    const claimed = claimedRef.current;
    for (const item of downloadTargets(queue.items)) {
      if (claimed.has(`download:${item.id}`)) continue;
      claimed.add(`download:${item.id}`);
      void runDownload(item);
    }
  }, [queue.items, runDownload]);

  useEffect(() => {
    const claimed = claimedRef.current;
    for (const item of saveTargets(queue.items)) {
      if (claimed.has(`save:${item.id}`)) continue;
      claimed.add(`save:${item.id}`);
      void runSave(item);
    }
  }, [queue.items, runSave]);

  // One loop for every waiting job, self-rescheduling so the interval is
  // measured between sweeps rather than started against them.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function check(target: CaptureItem) {
      try {
        const report = await fetchStatus(target.serialize as string);
        if (stopped) return;
        dispatch({
          type: "status-polled",
          id: target.id,
          report,
          message: KIRI_STATUS_LABEL[report.status],
        });
      } catch (err) {
        dispatch({
          type: "poll-errored",
          id: target.id,
          message: messageOf(err, "Lost contact with KIRI"),
        });
      }
    }

    async function sweep() {
      const targets = pollTargets(itemsRef.current);
      for (let i = 0; i < targets.length; i += 1) {
        if (stopped) return;
        // A browser allows about six connections per origin, and the downloads
        // are the ones that cannot wait: KIRI's signed URL expires an hour after
        // a job goes ready. So the checks go one at a time, spaced out, instead
        // of N of them landing in the same instant and crowding the transfers.
        if (i > 0) await sleep(POLL_STAGGER_MS);
        if (stopped) return;
        await check(targets[i]);
      }
      if (!stopped) timer = setTimeout(sweep, POLL_INTERVAL_MS);
    }

    timer = setTimeout(sweep, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  const waiting = queue.items.some((item) => item.phase === "waiting");
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [waiting]);

  function addVideos(files: FileList | null) {
    if (!files || files.length === 0) return;
    dispatch({
      type: "added",
      items: Array.from(files).map((file) =>
        pickedItem(nextRowId(), file, prettyName(file.name), albumId),
      ),
    });
    // The input holds on to its selection, so re-picking a file that was just
    // dropped would not fire onChange. Remounting it clears that.
    setFormKey((key) => key + 1);
  }

  function remove(id: string) {
    const item = queue.items.find((entry) => entry.id === id);
    discardedRef.current.add(id);
    releaseSplat(id);
    // Whatever is already in flight for this row cannot be recalled; its result
    // lands on a row the reducer no longer knows, which is where it stops.
    if (item?.serialize) {
      void dropCachedSplat(item.serialize);
      removeJob(item.serialize);
    }
    dispatch({ type: "removed", id });
  }

  const previewed =
    queue.items.find((item) => item.id === queue.previewId && item.splat) ??
    null;
  const running = activeCount(queue.items);
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
          or smaller. They reconstruct in parallel, and each one saves on its own.
          {albumId && " Everything you save here joins this album."}
        </p>

        <div className="mt-8 flex flex-col gap-4">
          <label className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed border-black/20 bg-neutral-50 px-4 py-8 text-center transition hover:border-[#0071e3]">
            <span className="text-[15px] font-medium text-[#0071e3]">
              Choose Videos
            </span>
            <span className="text-xs text-neutral-500">
              One continuous walkthrough per environment
            </span>
            <input
              key={formKey}
              type="file"
              accept="video/*"
              multiple
              onChange={(e) => addVideos(e.target.files)}
              className="hidden"
            />
          </label>

          <button
            onClick={() => dispatch({ type: "start-requested" })}
            disabled={!canStart(queue.items)}
            className="rounded-full bg-[#0071e3] px-6 py-2.5 font-medium text-white transition hover:bg-[#0077ed] disabled:opacity-40"
          >
            Start Capture
          </button>

          {!isFirebaseConfigured && !DEMO_CAPTURE && (
            <p className="text-sm text-amber-600">
              Firebase isn&apos;t configured, so finished environments can&apos;t
              be saved. Capture still works — each one renders here and can be
              downloaded.
            </p>
          )}
        </div>

        {previewed?.splat && (
          <section className="mt-10">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <h2 className="text-[22px] font-semibold tracking-tight">
                  {previewed.splat.name}
                </h2>
                <p className="text-sm text-neutral-500">
                  Drag to look around, scroll to zoom.
                </p>
              </div>
              <button
                onClick={() => dispatch({ type: "previewed", id: null })}
                className="text-[15px] text-[#0071e3]"
              >
                Close Preview
              </button>
            </div>
            {/* One viewer for the whole queue: each is a WebGL2 context, which is
                costly enough that this repo turns StrictMode off to avoid a
                second. Keyed by row so switching previews rebuilds the scene. */}
            <div className="mt-4 h-[60vh] overflow-hidden rounded-2xl bg-black ring-1 ring-black/10">
              <SplatViewer
                key={previewed.id}
                splatUrl={previewed.splat.url}
                placementMode={false}
                onPlacePoint={() => {}}
              />
            </div>
          </section>
        )}

        <CaptureQueue
          items={queue.items}
          previewId={queue.previewId}
          now={now}
          albumId={albumId}
          canSave={isFirebaseConfigured}
          onRename={(id, name) => dispatch({ type: "renamed", id, name })}
          onWhenChange={(id, whenLocal) =>
            dispatch({
              type: "when-edited",
              id,
              whenLocal,
              capturedAt: toIso(whenLocal) ?? null,
            })
          }
          onLocationName={(id, locationName) =>
            dispatch({ type: "location-named", id, locationName })
          }
          onPreview={(id) => dispatch({ type: "previewed", id })}
          onSave={(id) => dispatch({ type: "save-requested", id })}
          onRetry={(id) => dispatch({ type: "retried", id })}
          onRemove={remove}
        />

        {waiting && (
          <p className="mt-6 text-sm text-neutral-500">
            Reconstruction takes 30–90 minutes and keeps going without you —
            close this tab and come back, and these will still be here.
          </p>
        )}
        {running > 0 && (
          <p className="mt-2 text-sm text-neutral-500">
            {running === 1
              ? "1 capture is transferring right now — leave this tab open until it finishes."
              : `${running} captures are transferring right now — leave this tab open until they finish.`}
          </p>
        )}
      </div>
    </main>
  );
}


/**
 * The last resort once the container carried no date of its own. It is the
 * file's timestamp, not the shoot's — a download, an AirDrop or an export all
 * rewrite it, and a browser that cannot read one is allowed to hand back the
 * current time — so it is offered as something to correct, never as an answer.
 */
/**
 * The instant is what gets persisted and reaches the Place; the wall-clock text
 * beside it is what a datetime-local field echoes while it is being typed, which
 * a half-finished date has no instant for.
 */
function toDetails(found: VideoCapture, when: string | null): CaptureDetails {
  return {
    capturedAt: when,
    whenLocal: when ? toLocalInput(when) : "",
    whenFrom: found.capturedAt ? "video" : when ? "file" : "none",
    location: found.location,
  };
}

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * Saves run one at a time — this holds the whole capture in memory, decoded.
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
