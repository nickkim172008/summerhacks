"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Place } from "@/lib/types";
import { storedAssetUrl } from "@/lib/assetUrl";
import Avatar from "./Avatar";
import TourChrome, { type TourChromeProps } from "./TourChrome";

const SplatViewer = dynamic(() => import("./SplatViewer"), { ssr: false });

/** Long enough for the room's sound to fall away rather than be cut off. */
export const FADE_MS = 350;
/** Slow enough that the room's sound arrives rather than switches on. */
const AUDIO_FADE_IN_MS = 2000;

/** Smoked glass, so chrome reads over a bright window and a dark corner alike. */
const GLASS =
  "border border-[rgba(255,255,255,0.16)] bg-[rgba(14,16,19,0.5)] backdrop-blur-[14px]";
const GLASS_HOVER =
  "transition-colors duration-150 ease-[ease] hover:bg-[rgba(14,16,19,0.68)]";

/**
 * The transport's shape. Decorative: this screen has no waveform for the track
 * and is not going to analyse one for a scrubber. The bars carry one true
 * thing — how far into the recording you are — and nothing else.
 */
const METER_BARS = [
  38, 64, 92, 50, 76, 34, 58, 44, 70, 52, 86, 40, 62, 30, 74, 48,
];

export interface PlaceExperienceProps {
  place: Place;
  /** Who captured this, when their profile could be resolved. */
  uploader?: { username: string; displayName: string } | null;
  onExit?: () => void;
  /**
   * Where leaving lands, said out loud on the button. Nothing here goes looking
   * for it: whoever renders the viewer already knows which way is out.
   */
  backLabel?: string;
  /** Offered to whoever captured this, to correct its name or where it sits. */
  onEdit?: () => void;
  /**
   * Present only while a guided walkthrough is driving playback. The tour owns
   * its own clock and its own idea of where it is; this only draws it.
   */
  tour?: TourChromeProps;
  /**
   * Pressed and released inside the capture. A walkthrough holds its countdown
   * between the two: moving on while someone is mid-look is the single way this
   * feels broken.
   */
  onLookingChange?: (looking: boolean) => void;
}

export default function PlaceExperience({
  place,
  uploader,
  onExit,
  backLabel = "Library",
  onEdit,
  tour,
  onLookingChange,
}: PlaceExperienceProps) {
  const [leaving, setLeaving] = useState(false);
  const exitTimerRef = useRef<number | null>(null);

  // Whether a pointer is down on the capture. A ref rather than state: nothing
  // on this screen looks different mid-drag, and re-rendering around the viewer
  // while someone is turning is the one thing worth not doing here.
  const lookingRef = useRef(false);
  const onLookingChangeRef = useRef(onLookingChange);
  useEffect(() => {
    onLookingChangeRef.current = onLookingChange;
  });

  const beginLook = useCallback(() => {
    if (lookingRef.current) return;
    lookingRef.current = true;
    onLookingChangeRef.current?.(true);
  }, []);

  // Release is watched on the window rather than the canvas: a drag that ends
  // off the canvas, or off the page entirely — released over the tab strip —
  // would otherwise leave a walkthrough paused for good.
  useEffect(() => {
    const release = () => {
      if (!lookingRef.current) return;
      lookingRef.current = false;
      onLookingChangeRef.current?.(false);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
      release();
    };
  }, []);

  // Arriving somewhere new clears the previous place's UI state.
  const [renderedPlaceId, setRenderedPlaceId] = useState(place.id);
  if (renderedPlaceId !== place.id) {
    setRenderedPlaceId(place.id);
    setLeaving(false);
  }

  // An exit still in flight has to be called off if the place changes or the
  // component goes away first, or it fires against a screen nobody is on.
  useEffect(() => {
    return () => {
      if (exitTimerRef.current === null) return;
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    };
  }, [renderedPlaceId]);

  function exit() {
    if (!onExit || exitTimerRef.current !== null) return;
    // Marked as leaving first so the room's sound fades rather than stopping
    // mid-note when the element goes.
    setLeaving(true);
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      onExit();
    }, FADE_MS);
  }

  const showPlayer = Boolean(place.audioUrl);
  useEffect(() => {
    console.info("[place]", place.id, {
      splatUrl: place.splatUrl,
      audioUrl: place.audioUrl ?? "(none saved)",
    });
  }, [place.id, place.splatUrl, place.audioUrl]);
  const captured = describeCapture(place);
  // A walkthrough's step between captures fades exactly as a hotspot jump does,
  // sound included — it is the same journey, taken for you.
  const dimming = leaving || Boolean(tour?.fading);

  return (
    <div className="relative h-full w-full bg-black text-white">
      {/* The pointer listener sits here rather than on the root so that a press
          on the chrome — Next, Exit — is never mistaken for a look around. */}
      <div className="h-full w-full" onPointerDown={beginLook}>
        <SplatViewer
          splatUrl={place.splatUrl}
          entryPoint={place.entryPoint}
          world={place.world}
        />
      </div>

      {/* Two scrims, one at each end, so white chrome holds against a bright
          window or a pale wall. Never in the way of a drag. */}
      <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.42)_0%,transparent_22%)]" />
      <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(to_top,rgba(0,0,0,0.55)_0%,transparent_42%)]" />

      <div
        className="pointer-events-none absolute inset-0 z-30 bg-black transition-opacity"
        style={{
          opacity: dimming ? 1 : 0,
          transitionDuration: `${FADE_MS}ms`,
        }}
      />

      {tour && <TourChrome {...tour} />}

      {onExit && (
        <button
          onClick={exit}
          className={`absolute left-6 top-5 z-50 flex h-[38px] items-center gap-2 rounded-full px-[18px] text-[14px] font-medium text-white ${GLASS} ${GLASS_HOVER}`}
        >
          <ChevronLeftGlyph />
          {backLabel}
        </button>
      )}

      {(tour || onEdit) && (
        <div className="absolute right-6 top-5 z-50 flex items-center gap-2.5">
          {tour && (
            <span
              className={`flex h-[38px] items-center rounded-full px-4 text-[13px] tabular-nums text-[rgba(255,255,255,0.78)] ${GLASS}`}
            >
              {tour.index + 1} of {tour.total}
              {/* Said out loud, because a ring that has stopped filling looks
                  identical to one that is simply slow. */}
              {tour.paused && " · paused"}
            </span>
          )}

          {onEdit && (
            <button
              onClick={onEdit}
              aria-label="Edit"
              className={`flex h-[38px] w-[38px] items-center justify-center rounded-full text-white ${GLASS} ${GLASS_HOVER}`}
            >
              <PencilGlyph />
            </button>
          )}
        </div>
      )}

      {/* Everything known about the capture, out of the way in the corner —
          the scene is the point, and a title card in front of it was a door to
          open before anyone could look. */}
      <div className="pointer-events-none absolute bottom-6 left-6 z-20 w-[420px] max-w-[calc(100%-3rem)]">
        <div className="pointer-events-auto rounded-[18px] border border-[rgba(255,255,255,0.1)] bg-[rgba(14,16,19,0.62)] p-5 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.9)] backdrop-blur-[20px]">
          {captured.when && (
            // Rendered in the visitor's locale and time zone, neither of
            // which the server shares, so the two passes legitimately differ.
            <p
              suppressHydrationWarning
              className="text-[11px] font-semibold uppercase leading-[12px] tracking-[0.12em] text-[rgba(255,255,255,0.42)]"
            >
              {captured.when}
            </p>
          )}

          <h1 className="font-display mt-2 text-[32px] font-normal leading-[1.05] tracking-[-0.02em] text-white">
            {place.name}
          </h1>

          {(uploader || captured.where) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-[rgba(255,255,255,0.6)]">
              {uploader && (
                <>
                  <Avatar
                    profile={uploader}
                    className="h-5 w-5"
                    textClassName="text-[9px]"
                  />
                  <Link
                    href={`/u/${uploader.username}`}
                    className="text-white transition-colors duration-150 ease-[ease] hover:text-[rgba(255,255,255,0.72)]"
                  >
                    @{uploader.username}
                  </Link>
                </>
              )}
              {uploader && captured.where && <span aria-hidden>·</span>}
              {captured.where && <span>{captured.where}</span>}
            </div>
          )}

          {showPlayer && place.audioUrl && (
            <div className="mt-[18px] border-t border-[rgba(255,255,255,0.1)] pt-4">
              <AmbientPlayer
                key={place.id}
                url={storedAssetUrl(place.audioUrl)}
                seconds={place.audioSeconds}
                leaving={dimming}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The walkthrough's own audio, played back under the place it was filmed in.
 * There is no entry gesture to wait behind any more, so playback is attempted
 * on arrival and picked up again on the first pointer press if the browser
 * refused it.
 */
function AmbientPlayer({
  url,
  seconds,
  leaving,
}: {
  url: string;
  seconds?: number;
  leaving: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(seconds ?? 0);
  const [failed, setFailed] = useState(false);

  /**
   * The fade rides a GainNode rather than the element's own volume, which iOS
   * Safari exposes as read-only and drops writes to without complaining — the
   * sound would arrive there at full level under copy promising a fade.
   */
  const fadeTo = useCallback((target: number, ms: number) => {
    const context = contextRef.current;
    const gain = gainRef.current;
    if (!context || !gain) return;
    const now = context.currentTime;
    // Read the level before cancelling: cancelScheduledValues on its own snaps
    // back to where the running ramp started instead of holding where it got to.
    const current = gain.gain.value;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(current, now);
    gain.gain.linearRampToValueAtTime(target, now + ms / 1000);
  }, []);

  // Deliberately runs once per mounted element: an element can be given a
  // MediaElementAudioSourceNode only once, and a second attempt throws. Each
  // place mounts its own player, so a changing url arrives as a new element.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const context = createAudioContext();
    let source: MediaElementAudioSourceNode | undefined;
    let gain: GainNode | undefined;
    let resumeOnGesture: (() => void) | undefined;
    if (context) {
      gain = context.createGain();
      gain.gain.value = 0;
      // Routing an element through Web Audio replaces its own output, so the
      // graph has to carry on to the destination or the place plays silent.
      source = context.createMediaElementSource(audio);
      source.connect(gain).connect(context.destination);
      contextRef.current = context;
      gainRef.current = gain;
      // This runs a beat after the press that opened the place rather than
      // inside it, which Safari may not accept, and a context left suspended
      // plays nothing now that the element feeds it. Dragging to look around
      // is the next gesture going, so it doubles as the second attempt.
      resumeOnGesture = () => {
        context.resume().catch(() => {});
      };
      resumeOnGesture();
      window.addEventListener("pointerdown", resumeOnGesture);
    }

    startPlayback(audio);
    fadeTo(1, AUDIO_FADE_IN_MS);

    return () => {
      contextRef.current = null;
      gainRef.current = null;
      audio.pause();
      // A media element that keeps its source goes on streaming after React
      // detaches it, which would leave this place audible under the next one.
      audio.removeAttribute("src");
      audio.load();
      if (resumeOnGesture) {
        window.removeEventListener("pointerdown", resumeOnGesture);
      }
      source?.disconnect();
      gain?.disconnect();
      context?.close().catch(() => {});
    };
  }, [fadeTo]);

  // The jump fades the picture to black over FADE_MS; take the sound with it.
  useEffect(() => {
    if (leaving) fadeTo(0, FADE_MS);
  }, [leaving, fadeTo]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      // A press is a gesture of its own, so it is the second chance to open a
      // context iOS left suspended when the place did not count as one.
      contextRef.current?.resume().catch(() => {});
      startPlayback(audio);
    } else audio.pause();
  }

  if (failed) {
    return (
      <p className="text-[13px] text-[rgba(255,255,255,0.6)]">
        The sound recorded here could not be loaded.
      </p>
    );
  }

  // How much of the meter is behind you. The bars are drawn, not measured, so
  // this is the only thing about them that has to be true.
  const heard =
    duration > 0
      ? Math.round(
          (Math.min(position, duration) / duration) * METER_BARS.length,
        )
      : 0;

  return (
    <div className="flex w-full min-w-0 items-center gap-3.5">
      <audio
        ref={audioRef}
        src={url}
        loop={loop}
        preload="auto"
        // Storage serves these from another origin, and Web Audio reads a
        // cross-origin element as silence unless it was fetched with CORS.
        crossOrigin="anonymous"
        onError={() => setFailed(true)}
        onLoadedMetadata={(e) => {
          // A source served without a length answers Infinity; the duration
          // measured when the track was lifted off the video covers that.
          const known = e.currentTarget.duration;
          setDuration(Number.isFinite(known) ? known : (seconds ?? 0));
        }}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />

      <button
        onClick={togglePlay}
        aria-label={playing ? "Pause" : "Play"}
        className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-white text-[#14161A] transition-colors duration-150 ease-[ease] hover:bg-[rgba(255,255,255,0.86)]"
      >
        {playing ? <PauseGlyph /> : <PlayGlyph />}
      </button>

      {/* The meter is a picture; the range over it is the control. It stays a
          real range so the keyboard, the screen reader and a plain click all
          land on the same thing they always did. */}
      {/* The range itself is invisible, so the ring it would have shown on
          focus is borrowed by the meter it sits over. */}
      <div className="relative min-w-0 flex-1 focus-within:[outline:2px_solid_#FFFFFF] focus-within:[outline-offset:4px]">
        <div aria-hidden className="flex h-[22px] items-end gap-[2px]">
          {METER_BARS.map((height, bar) => (
            <div
              key={bar}
              style={{ height: `${height}%` }}
              className={`flex-1 rounded-[1px] ${
                bar < heard
                  ? "bg-[rgba(255,255,255,0.9)]"
                  : "bg-[rgba(255,255,255,0.28)]"
              }`}
            />
          ))}
        </div>

        <input
          type="range"
          aria-label="Playback position"
          min={0}
          max={duration}
          step={0.01}
          value={Math.min(position, duration)}
          onChange={(e) => {
            // Seeking moves the official playback position at once, so the next
            // timeupdate agrees with the thumb rather than dragging it back.
            const next = Number(e.target.value);
            setPosition(next);
            if (audioRef.current) audioRef.current.currentTime = next;
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>

      <span className="shrink-0 text-[11px] tabular-nums text-[rgba(255,255,255,0.45)]">
        {formatTime(position)} / {formatTime(duration)}
      </span>

      <button
        onClick={() => setLoop((v) => !v)}
        aria-pressed={loop}
        className={`shrink-0 rounded-full px-[11px] py-[5px] text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors duration-150 ease-[ease] ${
          loop
            ? "bg-white text-[#14161A]"
            : "border border-[rgba(255,255,255,0.16)] bg-[rgba(14,16,19,0.5)] text-[rgba(255,255,255,0.7)]"
        }`}
      >
        Loop
      </button>
    </div>
  );
}

/* The glyphs the chrome needs, drawn here rather than pulled in — six paths do
   not want a dependency. */

function ChevronLeftGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

function PencilGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="currentColor"
      aria-hidden
    >
      <path d="M7 4.5l12 7.5-12 7.5z" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="currentColor"
      aria-hidden
    >
      <path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" />
    </svg>
  );
}

/**
 * A refused play() is not worth reporting: the transport shows paused and the
 * visitor can start it by hand. Mobile Safari refuses in low power mode even
 * behind a gesture.
 */
function startPlayback(audio: HTMLAudioElement) {
  audio.play().catch(() => {});
}

/**
 * Safari shipped this prefixed for years. Null covers the browser that has
 * neither, where the track still plays — straight out of the element, at full
 * level, without the fade.
 */
function createAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

function formatTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * When and where the walkthrough was filmed, as far as it is known. Kept apart
 * rather than joined: the card gives the date its own line above the title and
 * the place its own line below it.
 */
function describeCapture(place: Place): {
  when: string | null;
  where: string | null;
} {
  let when: string | null = null;
  if (place.capturedAt) {
    const at = new Date(place.capturedAt);
    // Dates typed in by hand reach here unparsed, so a bad one is shown as-is
    // rather than as "Invalid Date".
    when = Number.isNaN(at.getTime())
      ? place.capturedAt
      : at.toLocaleString(undefined, {
          dateStyle: "long",
          timeStyle: "short",
        });
  }

  let where: string | null = null;
  if (place.locationName) where = place.locationName;
  else if (place.location) {
    where = `${place.location.lat.toFixed(4)}, ${place.location.lng.toFixed(4)}`;
  }

  return { when, where };
}
