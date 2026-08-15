"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import dynamic from "next/dynamic";
import { CAPTURE_STATUS_LABEL } from "@/lib/captureStatus";
import {
  BACKENDS,
  DEFAULT_BACKEND,
  describeVideoProblem,
  type CaptureBackend,
} from "@/lib/captureBackend";
import { fetchSplat, fetchStatus, uploadVideo } from "@/lib/captureJob";
import {
  listJobs,
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
  POSTER_LIMIT,
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
  posterCacheTargets,
  posterTargets,
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
  dropCachedPoster,
  dropCachedSplat,
  readCachedAudio,
  readCachedPoster,
  readCachedSplat,
  writeCachedAudio,
  writeCachedPoster,
  writeCachedSplat,
} from "@/lib/splatCache";
import { extractAudio } from "@/lib/audioTrack";
import { grabPoster } from "@/lib/videoFrame";
import { readVideoCapture, type VideoCapture } from "@/lib/videoMeta";
import { reverseGeocode } from "@/lib/geocode";
import { createPlace } from "@/lib/places";
import { addPlacesToAlbum } from "@/lib/albums";
import { isFirebaseConfigured } from "@/lib/firebase";
import CaptureQueue from "@/components/CaptureQueue";
import { useAuth } from "@/lib/auth";
import { getLiveLocation } from "@/lib/geolocation";
import { ANONYMISE_LOCATIONS, locationToStore } from "@/lib/privacy";

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

/** Pitch mode: accept the walkthrough without calling KIRI or waiting on it. */
const DEMO_CAPTURE = process.env.NEXT_PUBLIC_DEMO_CAPTURE === "true";
/** The server has no localStorage, so it renders as if nothing were queued. */
const emptySnapshot = () => "{}";

let rowCounter = 0;
/** React's key. Deliberately not the KIRI task id — a picked video has none. */
function nextRowId() {
  rowCounter += 1;
  return `row-${rowCounter}`;
}
/**
 * Pitch mode has no upload and no KIRI job to wait on, so the bar is walked
 * through a few steps rather than sitting frozen, which reads as broken.
 */
const DEMO_UPLOAD_STEPS = [0.2, 0.55, 0.85, 1];
const DEMO_STEP_MS = 220;

/**
 * The capture queue and everything that drives it: picking videos, uploading
 * them, polling KIRI, downloading what comes back and saving it.
 *
 * It lives here rather than on the capture route because whoever shows the rows
 * has to be the one polling them. Captures belong to the album they were
 * started from, so that album is where they should be visible reconstructing —
 * and the capture form, which is a place to begin work rather than watch it,
 * opens empty every time.
 */
export type RunnerMode =
  /** A blank form. Nothing already running is adopted, so it never shows work. */
  | "new"
  /** Watches what this album has in flight, and has no picker of its own. */
  | "album";

export interface CaptureRunnerProps {
  /** Null for Recents, whose captures are the ones filed under no album. */
  albumId: string | null;
  mode: RunnerMode;
}

/**
 * The picker's input lives here, beside `addVideos` and the remount key, but the
 * control that opens it is the "Choose videos" pill in the page's header row —
 * so the two are joined by id rather than by nesting.
 */
export const CAPTURE_INPUT_ID = "capture-videos";

export default function CaptureRunner({ albumId, mode }: CaptureRunnerProps) {
  const { user } = useAuth();
  const isNew = mode === "new";

  const [queue, dispatch] = useReducer(reduceQueue, !isNew, createQueue);
  const [formKey, setFormKey] = useState(0);
  /**
   * Which service the next videos go to. Held on the form rather than per row,
   * because it is a decision about the batch you are about to pick — a row that
   * has already been uploaded is at whichever service took it and cannot move.
   */
  const [backend, setBackend] = useState<CaptureBackend>(DEFAULT_BACKEND);
  const [now, setNow] = useState(() => Date.now());

  // The jobs live in localStorage, not in state: reconstruction outlasts the
  // tab, so a reload — or a second tab — has to find them still waiting.
  const storedJobs = useSyncExternalStore(
    subscribeToJobs,
    readJobsSnapshot,
    emptySnapshot,
  );
  // Storage hands back the newest first; the queue reads chronologically.
  const jobs = useMemo(() => {
    // A blank form adopts nothing: work already running belongs to the album it
    // was started from, and showing it here is what made "capture a new
    // environment" open onto somebody else's half-finished batch.
    if (isNew) return [];
    return (
      parseJobs(storedJobs)
        // Recents is not an album, so what belongs to it is everything filed
        // under no album at all.
        .filter((job) => (albumId ? job.albumId === albumId : !job.albumId))
        .slice()
        .reverse()
    );
  }, [storedJobs, isNew, albumId]);

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
  const posterLimit = useMemo(() => createLimiter(POSTER_LIMIT), []);

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
        let found = await readVideoCapture(file);
        if (!mountedRef.current) return;
        const when = found.capturedAt ?? fileDate(file);
        // Swapped here, at the first moment the real coordinates exist, rather
        // than at save. Everything downstream — the suggested name, the form,
        // the pin, the document — then works from the decoy, and the real
        // coordinates never reach a field anyone can read or a request that
        // leaves the browser. Changing it at save would still have sent the
        // true position to the geocoder to be named.
        const pinned = locationToStore(item.id, found.location);
        found = { ...found, location: pinned };
        dispatch({
          type: "meta-read",
          id: item.id,
          meta,
          // Demo mode never reaches the backend, so its limits are not this
          // row's problem. An unreadable file is let through as it always was:
          // the server rejects what it must.
          problem:
            DEMO_CAPTURE || !meta
              ? null
              : describeVideoProblem(item.backend, { ...meta, bytes: file.size }),
          details: toDetails(found, when),
        });

        // The video knows where it was, not what that place is called. A name
        // is what reads in a list, so the coordinates are turned back into one
        // while the row waits.
        if (found.location) {
          reverseGeocode(found.location).then((locationName) => {
            if (!mountedRef.current || !locationName) return;
            dispatch({ type: "location-suggested", id: item.id, locationName });
          });
        }
        return;
      }
      if (!item.serialize) return;
      const cached = await readCachedSplat(item.serialize);
      if (!mountedRef.current) return;
      dispatch({
        type: "cache-checked",
        id: item.id,
        splat: cached
          ? attachSplat(item.id, splatFile(cached, item.name, item.backend), item.name)
          : null,
      });
    },
    [attachSplat],
  );

  const runUpload = useCallback(
    async (item: CaptureItem) => {
      const file = item.file;
      if (!file) return;

      if (DEMO_CAPTURE) {
        // No KIRI call, but the progress bar still moves — a frozen one reads as
        // broken on a projector.
        for (const fraction of DEMO_UPLOAD_STEPS) {
          await sleep(DEMO_STEP_MS);
          if (!mountedRef.current) return;
          dispatch({ type: "upload-progress", id: item.id, fraction });
        }
        dispatch({ type: "demo-queued", id: item.id, startedAt: Date.now() });
        return;
      }

      try {
        // The walkthrough goes to KIRI and nowhere else. Reconstruction is the
        // only thing that reads it, and what survives afterwards is the splat,
        // the details, and the sound — a few megabytes rather than the several
        // hundred a copy of every source video would cost to keep unread.
        const { serialize, backend } = await uploadLimit(() =>
          uploadVideo(
            file,
            (fraction) =>
              dispatch({ type: "upload-progress", id: item.id, fraction }),
            item.backend,
          ),
        );
        const startedAt = Date.now();
        dispatch({
          type: "upload-succeeded",
          id: item.id,
          serialize,
          backend,
          startedAt,
        });
        // A row dropped mid-upload must not come back from the dead: persisting
        // the job now would have the next reconcile read it as one to resume.
        if (!discardedRef.current.has(item.id)) {
          saveJob({
            serialize,
            name: item.name.trim() || "Untitled",
            startedAt,
            albumId: item.albumId ?? undefined,
            capturedAt: item.capturedAt ?? undefined,
            location: item.location ?? undefined,
            locationName: item.locationName.trim() || undefined,
            audioSeconds: item.audio?.seconds,
            backend,
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
    [uploadLimit],
  );

  const runDownload = useCallback(
    async (item: CaptureItem) => {
      const serialize = item.serialize;
      if (!serialize) return;
      try {
        const blob = await downloadLimit(() =>
          // By world id when it is known: an operation stops being addressable
          // three hours in, and a capture left overnight would otherwise find
          // its job aged out while the world is still there.
          fetchSplat(serialize, item.world?.worldId, item.backend),
        );
        const splat = attachSplat(
          item.id,
          splatFile(blob, item.name, item.backend),
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
          // The row's own frame first: it is still in hand unless this session
          // began after a reload, and a cache the browser reclaimed under us
          // would otherwise lose a still we are holding.
          const poster =
            item.poster ??
            (item.serialize ? await readCachedPoster(item.serialize) : null);
          // Where the video says it was filmed is the true answer. The device's
          // own position only stands in for a walkthrough that carried no GPS —
          // which is what puts the place on the Map tab either way.
          // The device's position stands in only for a walkthrough that
          // carried none — and it is the person's own position, so it is
          // swapped for the same decoy rather than being the one true
          // coordinate that survives.
          const live = ANONYMISE_LOCATIONS
            ? null
            : await getLiveLocation().catch(() => null);
          const location =
            item.location ??
            (ANONYMISE_LOCATIONS ? locationToStore(item.id, null) : live);
          const placeId = await createPlace(
            splat.name,
            // World Labs stores SPZ, so its result needs nothing doing to it.
            // KIRI returns float32 PLY — 65MB for a small room, most of it
            // spherical harmonics at full precision — which SPZ quantises to
            // about a thirteenth with no visible loss, and only the compressed
            // copy is ever uploaded or served.
            item.backend === "kiri" ? await toSpz(splat) : splat.file,
            user?.uid ?? "anonymous",
            {
              location,
              locationName: item.locationName.trim() || undefined,
              capturedAt: item.capturedAt ?? undefined,
              audioFile: wav && wavFile(wav, splat.name),
              audioSeconds: item.audioSeconds ?? undefined,
              thumbnail: poster,
              world: item.world ?? undefined,
            },
          );
          const album = item.albumId ?? albumId;
          if (album) await addPlacesToAlbum(album, [placeId]);
          // It serves from Storage now, so the local copies and the resume
          // record are all dead weight.
          if (item.serialize) {
            await dropCachedSplat(item.serialize);
            await dropCachedAudio(item.serialize);
            await dropCachedPoster(item.serialize);
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
          message: messageOf(err, "Could not save this place"),
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

  // The frame comes off the video on the same terms as the sound: beside the
  // upload rather than ahead of it, because this is the last moment there is a
  // video to take one from.
  useEffect(() => {
    const claimed = claimedRef.current;
    for (const item of posterTargets(queue.items)) {
      if (claimed.has(`poster:${item.id}`)) continue;
      claimed.add(`poster:${item.id}`);
      const file = item.file;
      if (!file) continue;
      void posterLimit(() => grabPoster(file)).then((poster) => {
        if (!mountedRef.current) return;
        dispatch({ type: "poster-grabbed", id: item.id, poster });
      });
    }
  }, [queue.items, posterLimit]);

  useEffect(() => {
    const claimed = claimedRef.current;
    for (const item of posterCacheTargets(queue.items)) {
      const key = `poster-cache:${item.serialize}`;
      if (claimed.has(key)) continue;
      claimed.add(key);
      const serialize = item.serialize;
      const poster = item.poster;
      if (!serialize || !poster) continue;
      void writeCachedPoster(serialize, poster);
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
        const report = await fetchStatus(target.serialize as string, target.backend);
        if (stopped) return;
        // A failure now says why, and says that the credits went with it —
        // World Labs charges at submit and does not return them.
        const message = report.error ?? CAPTURE_STATUS_LABEL[report.status];
        // Written down before the row hears about it: a refusal is final, and a
        // reload that found this job still looking unanswered would put it back
        // in the poll loop to be told the same thing again.
        if (report.failed && target.serialize) {
          const job = listJobs().find(
            (entry) => entry.serialize === target.serialize,
          );
          if (job) saveJob({ ...job, failed: message });
        }
        dispatch({
          type: "status-polled",
          id: target.id,
          report,
          message,
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
        pickedItem(nextRowId(), file, prettyName(file.name), albumId, backend),
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

  return (
    <>
      {isNew && (
        <>
          {/* Opened by the "Choose videos" pill in the header row, which is this
              input's label. Remounting on formKey is what lets the same file be
              picked twice: the element holds on to its selection otherwise. */}
          <input
            key={formKey}
            id={CAPTURE_INPUT_ID}
            type="file"
            accept="video/*"
            multiple
            onChange={(e) => addVideos(e.target.files)}
            className="sr-only"
          />

          <BackendPicker value={backend} onChange={setBackend} />

          {!isFirebaseConfigured && !DEMO_CAPTURE && (
            <p className="mt-6 rounded-xl border border-[rgba(138,90,18,0.25)] bg-[rgba(138,90,18,0.06)] px-4 py-3 text-[13px] leading-[18px] text-[#8A5A12]">
              Firebase isn&apos;t configured, so finished places
              can&apos;t be saved. Capture still works, and each one renders
              here and can be downloaded.
            </p>
          )}
        </>
      )}

      {previewed?.splat && (
        <section className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h2 className="font-display text-[22px] leading-[28px] tracking-[-0.01em] text-[#14161A]">
                {previewed.splat.name}
              </h2>
              <p className="mt-1 text-[13px] text-[#6B7178]">
                Drag to look around.
              </p>
            </div>
            <button
              onClick={() => dispatch({ type: "previewed", id: null })}
              className="text-[14px] font-medium text-[#4A4F57] transition hover:text-[#14161A]"
            >
              Close Preview
            </button>
          </div>
          {/* One viewer for the whole queue: each is a WebGL2 context, which is
                costly enough that this repo turns StrictMode off to avoid a
                second. Keyed by row so switching previews rebuilds the scene. */}
          <div className="mt-4 h-[60vh] overflow-hidden rounded-2xl bg-black ring-1 ring-[rgba(20,22,26,0.09)]">
            <SplatViewer
              key={previewed.id}
              splatUrl={previewed.splat.url}
            />
          </div>
        </section>
      )}

      {/* What the two notes under the queue used to say, said once, above it:
          how long this takes is on the page already, and what is left is that
          each capture stands on its own. */}
      {isNew && queue.items.length > 0 && (
        <div className="mt-6 flex flex-wrap items-baseline justify-between gap-6 border-t border-[rgba(20,22,26,0.09)] pt-4">
          <h2 className="text-[20px] font-semibold leading-[26px] tracking-[-0.01em] text-[#14161A]">
            In flight
          </h2>
          <div className="flex flex-wrap items-center gap-2.5">
            {running > 0 && (
              <span className="rounded-full bg-[rgba(20,22,26,0.05)] px-[11px] py-[5px] text-[11px] font-semibold uppercase leading-3 tracking-[0.08em] tabular-nums text-[#4A4F57]">
                {running} transferring
              </span>
            )}
            <p className="text-[13px] text-[#6B7178]">
              Each one saves on its own · safe to close this tab
            </p>
          </div>
        </div>
      )}

      <CaptureQueue
        items={queue.items}
        previewId={queue.previewId}
        now={now}
        albumId={albumId}
        canSave={isFirebaseConfigured}
        canStart={canStart(queue.items)}
        layout={isNew ? "rows" : "tiles"}
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
        onStart={() => dispatch({ type: "start-requested" })}
        onSave={(id) => dispatch({ type: "save-requested", id })}
        onRetry={(id) => dispatch({ type: "retried", id })}
        onRemove={remove}
      />
    </>
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


function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/**
 * Which service the next videos go to.
 *
 * Both are shown with what they cost you rather than only what they offer.
 * They differ in ways that are invisible until it is too late to change your
 * mind — one invents the parts of a room it never saw, the other takes an hour
 * and charges nothing — and someone picking between them at the moment they
 * pick a video is the only point where that is still a choice.
 */
function BackendPicker({
  value,
  onChange,
}: {
  value: CaptureBackend;
  onChange: (next: CaptureBackend) => void;
}) {
  return (
    <fieldset className="mt-6">
      <legend className="text-[11px] leading-3 font-semibold tracking-[0.12em] uppercase text-[#6B7178]">
        Reconstruct with
      </legend>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {Object.values(BACKENDS).map((profile) => {
          const active = profile.id === value;
          return (
            <label
              key={profile.id}
              className={`cursor-pointer rounded-2xl border p-4 transition-colors duration-150 ${
                active
                  ? "border-[#0071E3] bg-[rgba(0,113,227,0.04)]"
                  : "border-[rgba(20,22,26,0.12)] bg-white hover:border-[rgba(20,22,26,0.24)]"
              }`}
            >
              <span className="flex items-baseline gap-2">
                <input
                  type="radio"
                  name="capture-backend"
                  value={profile.id}
                  checked={active}
                  onChange={() => onChange(profile.id)}
                  className="sr-only"
                />
                <span className="text-[15px] font-semibold text-[#14161A]">
                  {profile.label}
                </span>
                <span className="text-[12px] text-[#6B7178]">
                  {profile.duration}
                </span>
              </span>
              <span className="mt-1 block text-[13px] leading-[18px] text-[#4A4F57]">
                {profile.summary}
              </span>
              <ul className="mt-2 space-y-1">
                {profile.notes.map((note) => (
                  <li
                    key={note}
                    className="text-[12px] leading-[17px] text-[#6B7178]"
                  >
                    {note}
                  </li>
                ))}
              </ul>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function wavFile(blob: Blob, name: string) {
  return new File([blob], `${slug(name)}.wav`, { type: "audio/wav" });
}

function prettyName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
}

/**
 * Spark's transcode, imported lazily: the form and progress views have no use
 * for it, and only KIRI's output reaches it. Saves run one at a time — this
 * holds the whole capture in memory, decoded.
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

function splatFile(blob: Blob, name: string, backend: CaptureBackend) {
  // The extension has to match what actually arrived: Spark and PlayCanvas both
  // sniff the format from the bytes, but Storage keys the object off this name
  // and a .spz holding PLY is a capture nobody can explain later.
  return new File([blob], `${slug(name)}.${backend === "kiri" ? "ply" : "spz"}`, {
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
