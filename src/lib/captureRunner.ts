/**
 * The per-video state machine behind the capture queue. It is deliberately free
 * of React and of the DOM: the page does the uploading, polling, transcoding and
 * object-URL bookkeeping, then reports what happened as an event, and every
 * phase change in the feature is `reduceQueue(state, event)`.
 *
 * Keeping it separate is what makes "one video failing must not disturb the
 * others" checkable rather than hopeful — a reducer only ever rewrites the item
 * an event names, and hands back the same state object when it names none.
 *
 * Nothing here may import a *value* from another module. The tests run this file
 * under Node's type stripping, which erases `import type` outright but would
 * have to resolve a real import, and the repo's specifiers are extensionless.
 */
import type { ExtractedAudio } from "./audioTrack";
import type { StatusReport } from "./captureJob";
import type { CaptureJob } from "./captureQueue";
import type { KiriStatus } from "./kiri";

/**
 * A blip during a 90-minute job is not a failure, so polling rides them out —
 * but a bad key or a dead task id looks identical to a blip from here, so the
 * row speaks up once the failures stop looking transient.
 */
export const FAILURES_BEFORE_REPORTING = 3;

/**
 * A row's whole life. `checking` covers both of the questions an item can open
 * with — "is this video inside KIRI's limits" for a picked file, "is the result
 * already on disk" for a job resumed from storage — because to the queue they
 * are the same beat: the row cannot move until it has an answer.
 */
export type CapturePhase =
  | "checking"
  | "ready-to-upload"
  | "blocked"
  | "uploading"
  | "waiting"
  | "downloading"
  | "previewable"
  | "saving"
  | "saved"
  | "failed";

export interface VideoMeta {
  seconds: number;
  width: number;
  height: number;
}

/** Where a prefilled answer came from, which decides how much to trust it. */
export type Provenance = "video" | "file" | "none";

/**
 * Everything only the video can answer about itself, read while the File is in
 * hand: after a reload there is no File left, and the splat it belongs to is
 * still 30-90 minutes out.
 */
export interface CaptureDetails {
  /**
   * The instant, ISO 8601 — this is what is persisted and what reaches the
   * Place — beside the same instant as the wall-clock text a datetime-local
   * field shows. Both, because the field has to echo what is being typed
   * character by character and a half-typed date has no instant to convert to.
   */
  capturedAt: string | null;
  whenLocal: string;
  whenFrom: Provenance;
  location: { lat: number; lng: number } | null;
}

/** A downloaded capture plus the object URL the page minted for it. */
export interface SplatHandle {
  url: string;
  file: File;
  name: string;
}

export interface CaptureItem {
  /**
   * React's key, and the id every event addresses. Not the KIRI task id: a
   * freshly picked video has no task id until its upload lands, and two rows
   * would collide on `undefined` in the meantime.
   */
  id: string;
  name: string;
  phase: CapturePhase;
  /**
   * A picked video arrives with a File and no task id; a job resumed from
   * storage arrives with a task id and no File. Once an upload lands the File is
   * dropped — it is hundreds of megabytes that nothing downstream reads.
   */
  file: File | null;
  serialize: string | null;
  /** Remembered per item so a resumed job still knows the album it belongs to. */
  albumId: string | null;
  meta: VideoMeta | null;
  /** Which KIRI limit this video breaks, in words, or null if it breaks none. */
  problem: string | null;
  startedAt: number | null;
  uploadFraction: number;
  status: KiriStatus | null;
  pollFailures: number;
  error: string | null;
  /**
   * Where a retry picks up. A failed upload still holds its File; a failed
   * download already has a finished job at KIRI, and sending it back to
   * `waiting` would cost a whole poll interval before it tried again.
   */
  failedFrom: CapturePhase | null;
  /** KIRI rejected the walkthrough itself, so there is nothing to try again. */
  fatal: boolean;
  splat: SplatHandle | null;
  placeId: string | null;
  /** Pitch mode: the row was accepted without a KIRI job behind it. */
  demo: boolean;
  /**
   * Where and when this walkthrough was filmed. Read off the container, then
   * the user's to correct, until the upload spends them; a resumed row gets
   * them back off its job instead, long after the form is gone.
   */
  capturedAt: string | null;
  whenLocal: string;
  whenFrom: Provenance;
  location: { lat: number; lng: number } | null;
  locationName: string;
  /**
   * The walkthrough's own sound. `undefined` until the lift answers, null when
   * the video carried none this browser could read.
   */
  audio: ExtractedAudio | null | undefined;
  /**
   * Its length, kept apart from the track itself so a row resumed after a
   * reload — which holds no File and no samples — can still say what it carries.
   */
  audioSeconds: number | null;
  /**
   * A frame off the walkthrough, which becomes the Place's thumbnail.
   * `undefined` until the grab answers, null when the video was one this
   * browser could not decode.
   */
  poster: Blob | null | undefined;
}

export interface CaptureQueueState {
  items: CaptureItem[];
  /**
   * At most one row may be previewed: each viewer is a WebGL2 context, which is
   * expensive enough that this repo turns off StrictMode to avoid a second one.
   */
  previewId: string | null;
  /**
   * `?new=1` means the user asked for a blank form, so a capture that finishes
   * while they are there must not open itself over the top of it.
   */
  autoPreview: boolean;
}

export type CaptureEvent =
  | { type: "added"; items: CaptureItem[] }
  | { type: "removed"; id: string }
  | { type: "previewed"; id: string | null }
  | { type: "renamed"; id: string; name: string }
  | { type: "start-requested" }
  | {
      type: "meta-read";
      id: string;
      meta: VideoMeta | null;
      problem: string | null;
      details: CaptureDetails;
    }
  | {
      type: "when-edited";
      id: string;
      whenLocal: string;
      capturedAt: string | null;
    }
  | { type: "location-named"; id: string; locationName: string }
  | { type: "location-suggested"; id: string; locationName: string }
  | { type: "audio-lifted"; id: string; audio: ExtractedAudio | null }
  | { type: "poster-grabbed"; id: string; poster: Blob | null }
  | { type: "cache-checked"; id: string; splat: SplatHandle | null }
  | { type: "upload-progress"; id: string; fraction: number }
  | {
      type: "upload-succeeded";
      id: string;
      serialize: string;
      startedAt: number;
    }
  | { type: "upload-failed"; id: string; message: string }
  | { type: "demo-queued"; id: string; startedAt: number }
  | { type: "status-polled"; id: string; report: StatusReport; message: string }
  | { type: "poll-errored"; id: string; message: string }
  | { type: "download-succeeded"; id: string; splat: SplatHandle }
  | { type: "download-failed"; id: string; message: string }
  | { type: "save-succeeded"; id: string; placeId: string }
  | { type: "save-failed"; id: string; message: string }
  | { type: "save-requested"; id: string }
  | { type: "retried"; id: string };

export function createQueue(autoPreview = true): CaptureQueueState {
  return { items: [], previewId: null, autoPreview };
}

function blankItem(id: string, name: string): CaptureItem {
  return {
    id,
    name,
    phase: "checking",
    file: null,
    serialize: null,
    albumId: null,
    meta: null,
    problem: null,
    startedAt: null,
    uploadFraction: 0,
    status: null,
    pollFailures: 0,
    error: null,
    failedFrom: null,
    fatal: false,
    splat: null,
    placeId: null,
    demo: false,
    capturedAt: null,
    whenLocal: "",
    whenFrom: "none",
    location: null,
    locationName: "",
    audio: undefined,
    audioSeconds: null,
    poster: undefined,
  };
}

/**
 * The two constructors are the only way into the queue, which is what keeps
 * "has a File xor has a task id" true for every row without a guard on each
 * transition that leans on it.
 */
export function pickedItem(
  id: string,
  file: File,
  name: string,
  albumId: string | null = null,
): CaptureItem {
  return { ...blankItem(id, name), file, albumId };
}

export function resumedItem(id: string, job: CaptureJob): CaptureItem {
  return {
    ...blankItem(id, job.name),
    serialize: job.serialize,
    startedAt: job.startedAt,
    albumId: job.albumId ?? null,
    capturedAt: job.capturedAt ?? null,
    location: job.location ?? null,
    locationName: job.locationName ?? "",
    // The lift for this job ran when its video was picked, hours ago; its
    // samples are in Cache Storage under the same task id. Null rather than
    // undefined so nothing here reads as a lift still to come.
    audio: null,
    audioSeconds: job.audioSeconds ?? null,
    // As with the track: the grab ran when the video was picked, and what it
    // found is in Cache Storage under the same task id.
    poster: null,
    // whenLocal and whenFrom stay blank: they exist for the editor, and a row
    // resumed from storage has already spent its answers on the job.
  };
}

export function reduceQueue(
  state: CaptureQueueState,
  event: CaptureEvent,
): CaptureQueueState {
  switch (event.type) {
    case "added":
      return addItems(state, event.items);

    case "removed": {
      const items = state.items.filter((item) => item.id !== event.id);
      if (items.length === state.items.length) return state;
      return {
        ...state,
        items,
        previewId: state.previewId === event.id ? null : state.previewId,
      };
    }

    case "previewed": {
      if (event.id === null) {
        return state.previewId === null ? state : { ...state, previewId: null };
      }
      // Previewing a row with nothing to show would mount a viewer over a blank
      // URL, so the request is simply dropped.
      const target = state.items.find((item) => item.id === event.id);
      if (!target?.splat || state.previewId === event.id) return state;
      return { ...state, previewId: event.id };
    }

    case "start-requested": {
      let changed = false;
      const items = state.items.map((item) => {
        if (item.phase !== "ready-to-upload") return item;
        changed = true;
        return {
          ...item,
          phase: "uploading" as const,
          uploadFraction: 0,
          error: null,
        };
      });
      return changed ? { ...state, items } : state;
    }

    default:
      return updateItem(state, event.id, (item) => stepItem(item, event));
  }
}

function addItems(state: CaptureQueueState, incoming: CaptureItem[]) {
  const knownIds = new Set(state.items.map((item) => item.id));
  const knownJobs = new Set(
    state.items.map((item) => item.serialize).filter(Boolean),
  );
  // Storage replays every job it holds on each change, so the rows already on
  // screen have to be recognised by their task id and skipped.
  const fresh = incoming.filter(
    (item) =>
      !knownIds.has(item.id) &&
      !(item.serialize !== null && knownJobs.has(item.serialize)),
  );
  if (fresh.length === 0) return state;
  return { ...state, items: [...state.items, ...fresh] };
}

function updateItem(
  state: CaptureQueueState,
  id: string,
  step: (item: CaptureItem) => CaptureItem,
): CaptureQueueState {
  const index = state.items.findIndex((item) => item.id === id);
  // An event for a row the user already dropped: in-flight work cannot be
  // aborted, so its result lands here and is meant to go nowhere.
  if (index === -1) return state;

  const before = state.items[index];
  const after = step(before);
  if (after === before) return state;

  const items = state.items.slice();
  items[index] = after;
  // The first capture to arrive opens itself, whether it came off KIRI or
  // straight out of the cache — anything later waits to be asked for, so a
  // finishing job never yanks the viewer off what is on screen.
  const opens =
    state.autoPreview &&
    state.previewId === null &&
    before.splat === null &&
    after.splat !== null;
  return { ...state, items, previewId: opens ? after.id : state.previewId };
}

/**
 * Every transition is guarded by the phase it belongs to, so an event that
 * arrives late — a poll that resolves after its row was saved, an upload
 * callback firing past a failure — returns the item untouched instead of
 * dragging it backwards.
 */
function stepItem(item: CaptureItem, event: CaptureEvent): CaptureItem {
  switch (event.type) {
    case "renamed": {
      // Only until the name is committed: it goes to KIRI with the upload and
      // becomes the Place's name, and a row mid-flight has already spent it.
      if (!isNameable(item.phase) || event.name === item.name) return item;
      return { ...item, name: event.name };
    }

    case "meta-read": {
      if (item.phase !== "checking" || item.file === null) return item;
      return {
        ...item,
        meta: event.meta,
        problem: event.problem,
        phase: event.problem ? "blocked" : "ready-to-upload",
        capturedAt: event.details.capturedAt,
        whenLocal: event.details.whenLocal,
        whenFrom: event.details.whenFrom,
        location: event.details.location,
      };
    }

    case "when-edited": {
      if (!isDetailable(item.phase) || item.whenLocal === event.whenLocal) {
        return item;
      }
      // whenFrom is left alone on purpose: the badge says where the prefilled
      // answer came from, which is what makes a correction worth making, and
      // that stays true of the value being corrected.
      return {
        ...item,
        whenLocal: event.whenLocal,
        capturedAt: event.capturedAt,
      };
    }

    case "location-named": {
      if (
        !isDetailable(item.phase) ||
        item.locationName === event.locationName
      ) {
        return item;
      }
      return { ...item, locationName: event.locationName };
    }

    case "location-suggested": {
      // A name read back from the video's own coordinates. It fills the field
      // only while it is empty: whatever the user typed is the better answer,
      // and this lookup can land after they have started typing.
      if (!isDetailable(item.phase) || item.locationName.trim()) return item;
      return { ...item, locationName: event.locationName };
    }

    case "audio-lifted": {
      // Guarded on whether an answer is already in rather than on the phase: a
      // row can reach KIRI well before its sound is ready, and the track is
      // still the track this row was picked with.
      if (item.audio !== undefined) return item;
      return {
        ...item,
        audio: event.audio,
        audioSeconds: event.audio ? event.audio.seconds : null,
      };
    }

    case "poster-grabbed": {
      // Guarded on the answer rather than the phase, as the lift is: the grab
      // and the upload race, and the frame is the frame either way.
      if (item.poster !== undefined) return item;
      return { ...item, poster: event.poster };
    }

    case "cache-checked": {
      if (item.phase !== "checking" || item.serialize === null) return item;
      // A capture downloaded once needs neither the status check nor the
      // transfer; it renders straight off disk.
      if (event.splat)
        return { ...item, phase: "previewable", splat: event.splat };
      return { ...item, phase: "waiting" };
    }

    case "upload-progress": {
      if (
        item.phase !== "uploading" ||
        item.uploadFraction === event.fraction
      ) {
        return item;
      }
      return { ...item, uploadFraction: event.fraction };
    }

    case "upload-succeeded": {
      if (item.phase !== "uploading") return item;
      return {
        ...item,
        phase: "waiting",
        serialize: event.serialize,
        startedAt: event.startedAt,
        uploadFraction: 1,
        file: null,
        error: null,
      };
    }

    case "upload-failed": {
      if (item.phase !== "uploading") return item;
      return {
        ...item,
        phase: "failed",
        failedFrom: "uploading",
        error: event.message,
      };
    }

    case "demo-queued": {
      if (item.phase !== "uploading") return item;
      return {
        ...item,
        phase: "waiting",
        demo: true,
        startedAt: event.startedAt,
        uploadFraction: 1,
        file: null,
      };
    }

    case "status-polled": {
      // A demo row waits without a task id behind it, so there is no report that
      // could be about it — and letting one through would send it to download a
      // capture that was never made.
      if (item.phase !== "waiting" || item.serialize === null) return item;
      const settled: CaptureItem = {
        ...item,
        status: event.report.status,
        pollFailures: 0,
        error: null,
      };
      if (event.report.failed) {
        // KIRI could not reconstruct this walkthrough. Retrying the same task id
        // asks the same question and gets the same answer.
        return {
          ...settled,
          phase: "failed",
          failedFrom: "waiting",
          fatal: true,
          error: event.message,
        };
      }
      if (event.report.ready) return { ...settled, phase: "downloading" };
      return settled;
    }

    case "poll-errored": {
      if (item.phase !== "waiting") return item;
      const pollFailures = item.pollFailures + 1;
      return {
        ...item,
        pollFailures,
        error:
          pollFailures >= FAILURES_BEFORE_REPORTING
            ? event.message
            : item.error,
      };
    }

    case "download-succeeded": {
      if (item.phase !== "downloading") return item;
      return { ...item, phase: "previewable", splat: event.splat, error: null };
    }

    case "download-failed": {
      if (item.phase !== "downloading") return item;
      return {
        ...item,
        phase: "failed",
        failedFrom: "downloading",
        error: event.message,
      };
    }

    case "save-requested": {
      if (item.phase !== "previewable") return item;
      return { ...item, phase: "saving", error: null };
    }

    case "save-succeeded": {
      if (item.phase !== "saving") return item;
      // The splat stays: the row keeps its preview and its .ply link, and the
      // queue behind it keeps running rather than following the new Place.
      return { ...item, phase: "saved", placeId: event.placeId, error: null };
    }

    case "save-failed": {
      if (item.phase !== "saving") return item;
      // Back to previewable rather than failed — the capture is still in hand,
      // and only the write to Firebase came apart.
      return { ...item, phase: "previewable", error: event.message };
    }

    case "retried": {
      if (item.phase !== "failed" || item.fatal || item.failedFrom === null)
        return item;
      return {
        ...item,
        phase: item.failedFrom,
        failedFrom: null,
        error: null,
        pollFailures: 0,
        uploadFraction:
          item.failedFrom === "uploading" ? 0 : item.uploadFraction,
      };
    }

    default:
      return item;
  }
}

function isNameable(phase: CapturePhase) {
  return (
    phase === "checking" || phase === "ready-to-upload" || phase === "blocked"
  );
}

/**
 * Where and when can be corrected up to the moment the upload commits them to
 * the job. `checking` is deliberately not one of these: the read that fills the
 * fields in has not landed yet, and it would overwrite whatever was typed.
 */
export function isDetailable(phase: CapturePhase) {
  return phase === "ready-to-upload" || phase === "blocked";
}

/* Selectors. The page drives every side effect off these, so what a phase means
 * in practice is stated once, here, instead of in each effect's filter. */

/** Picked videos still to be measured, and resumed jobs still to be looked up. */
export function checkTargets(items: CaptureItem[]) {
  return items.filter((item) => item.phase === "checking");
}

export function uploadTargets(items: CaptureItem[]) {
  return items.filter(
    (item) => item.phase === "uploading" && item.file !== null,
  );
}

/**
 * Videos whose sound has not been lifted yet. A blocked row never appears here:
 * extractAudio reads the whole file into memory and decodes it, which on a
 * walkthrough already refused for being too long is gigabytes spent on nothing.
 */
export function audioTargets(items: CaptureItem[]) {
  return items.filter(
    (item) =>
      item.audio === undefined &&
      item.file !== null &&
      (item.phase === "ready-to-upload" || item.phase === "uploading"),
  );
}

/**
 * Rows holding a lifted track that now has a task id to be filed under. The
 * upload and the lift finish in either order, so this waits for both rather
 * than hanging off whichever one happens to land second.
 */
export function audioCacheTargets(items: CaptureItem[]) {
  return items.filter(
    (item) =>
      item.serialize !== null && item.startedAt !== null && item.audio != null,
  );
}

/**
 * Videos no frame has been taken off yet. Blocked rows are left out for the
 * same reason the lift leaves them out: they will never be uploaded, so
 * decoding one is work spent on a capture that is not going to happen.
 */
export function posterTargets(items: CaptureItem[]) {
  return items.filter(
    (item) =>
      item.poster === undefined &&
      item.file !== null &&
      (item.phase === "ready-to-upload" || item.phase === "uploading"),
  );
}

/** Rows holding a frame that now has a task id to file it under. */
export function posterCacheTargets(items: CaptureItem[]) {
  return items.filter(
    (item) =>
      item.serialize !== null && item.startedAt !== null && item.poster != null,
  );
}

/** Demo rows sit in `waiting` with no task id, so they are never asked after. */
export function pollTargets(items: CaptureItem[]) {
  return items.filter(
    (item) => item.phase === "waiting" && !item.demo && item.serialize !== null,
  );
}

export function downloadTargets(items: CaptureItem[]) {
  return items.filter(
    (item) => item.phase === "downloading" && item.serialize !== null,
  );
}

export function saveTargets(items: CaptureItem[]) {
  return items.filter((item) => item.phase === "saving" && item.splat !== null);
}

export function canStart(items: CaptureItem[]) {
  return items.some((item) => item.phase === "ready-to-upload");
}

/** Rows whose work would be lost by closing the tab, for the warning copy. */
export function activeCount(items: CaptureItem[]) {
  return items.filter(
    (item) =>
      item.phase === "uploading" ||
      item.phase === "downloading" ||
      item.phase === "saving",
  ).length;
}

export function isRetryable(item: CaptureItem) {
  return item.phase === "failed" && !item.fatal && item.failedFrom !== null;
}
