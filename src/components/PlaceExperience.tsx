"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Place, Vec3 } from "@/lib/types";

const SplatViewer = dynamic(() => import("./SplatViewer"), { ssr: false });

const FADE_MS = 350;
/** Slow enough that the room's sound arrives rather than switches on. */
const AUDIO_FADE_IN_MS = 2000;

export interface PlaceExperienceProps {
  place: Place;
  /** Other places this one can link to, for authoring hotspots. */
  linkTargets?: { id: string; name: string }[];
  onAddHotspot?: (point: Vec3, linksToPlaceId: string) => Promise<void>;
  onJump: (placeId: string) => void;
  onExit?: () => void;
}

export default function PlaceExperience({
  place,
  linkTargets = [],
  onAddHotspot,
  onJump,
  onExit,
}: PlaceExperienceProps) {
  const [entered, setEntered] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [pending, setPending] = useState<Vec3 | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jumping, setJumping] = useState(false);
  const jumpTimerRef = useRef<number | null>(null);

  // Arriving somewhere new clears the previous place's UI state.
  const [renderedPlaceId, setRenderedPlaceId] = useState(place.id);
  if (renderedPlaceId !== place.id) {
    setRenderedPlaceId(place.id);
    setJumping(false);
    setPending(null);
    setPlacing(false);
    setError(null);
  }

  const cancelJump = useCallback(() => {
    if (jumpTimerRef.current === null) return;
    clearTimeout(jumpTimerRef.current);
    jumpTimerRef.current = null;
  }, []);

  const handleHotspotClick = useCallback(
    (placeId: string) => {
      // Fade out first so the splat swap reads as travel, not a glitch.
      setJumping(true);
      jumpTimerRef.current = window.setTimeout(() => {
        jumpTimerRef.current = null;
        onJump(placeId);
      }, FADE_MS);
    },
    [onJump],
  );

  // A jump still in flight has to be called off when the visitor leaves during
  // the fade, or it lands afterwards and pulls them into the place they turned
  // down. Both the place changing under us and unmounting count as leaving.
  useEffect(() => cancelJump, [renderedPlaceId, cancelJump]);

  async function saveHotspot(linksToPlaceId: string) {
    if (!pending || !onAddHotspot) return;
    setSaving(true);
    setError(null);
    try {
      await onAddHotspot(pending, linksToPlaceId);
      resetDraft();
    } catch {
      setError("Could not save that link. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function resetDraft() {
    setPending(null);
    setPlacing(false);
  }

  const canAuthor = Boolean(onAddHotspot) && linkTargets.length > 0;
  const showPlayer = entered && Boolean(place.audioUrl);
  const captured = describeCapture(place);

  return (
    <div className="relative h-full w-full bg-black text-white">
      <SplatViewer
        splatUrl={place.splatUrl}
        hotspots={place.hotspots}
        entryPoint={place.entryPoint}
        placementMode={placing}
        onPlacePoint={(point) => {
          setPending(point);
          setPlacing(false);
        }}
        onHotspotClick={handleHotspotClick}
      />

      <div
        className="pointer-events-none absolute inset-0 z-30 bg-black transition-opacity"
        style={{
          opacity: jumping ? 1 : 0,
          transitionDuration: `${FADE_MS}ms`,
        }}
      />

      {onExit && (
        <button
          onClick={() => {
            // Leaving can take longer than the fade, so waiting for the
            // unmount to call off a pending jump would be too late.
            cancelJump();
            onExit();
          }}
          className="absolute left-4 top-4 z-50 flex items-center gap-1 rounded-full bg-white/90 px-4 py-2 text-[15px] text-[#0071e3] shadow-sm backdrop-blur transition hover:bg-white"
        >
          <span aria-hidden className="text-xl leading-none">
            ‹
          </span>
          Back
        </button>
      )}

      {!entered && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/85 px-6 backdrop-blur">
          <h1 className="text-2xl font-semibold">{place.name}</h1>
          {captured && (
            // Rendered in the visitor's locale and time zone, neither of which
            // the server shares, so the two passes legitimately differ.
            <p
              suppressHydrationWarning
              className="text-center text-sm text-neutral-500"
            >
              {captured}
            </p>
          )}
          <p className="max-w-sm text-center text-sm text-neutral-300">
            Drag to look around.
            {place.audioUrl
              ? " The sound recorded while this place was filmed fades in as you arrive."
              : ""}
          </p>
          <button
            onClick={() => setEntered(true)}
            className="rounded-full bg-white px-6 py-2 font-medium text-black"
          >
            Enter
          </button>
        </div>
      )}

      {(showPlayer || canAuthor || error) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-4">
          <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-2xl bg-neutral-900/90 p-4 backdrop-blur">
            {error && <p className="text-sm text-red-400">{error}</p>}

            {showPlayer && place.audioUrl && (
              <AmbientPlayer
                key={place.id}
                url={place.audioUrl}
                seconds={place.audioSeconds}
                leaving={jumping}
              />
            )}

            {canAuthor && !pending && (
              <>
                {/* Arming placement changes only the cursor, which nobody
                    notices — without this the button looks like it did
                    nothing. */}
                {placing && (
                  <p className="text-sm text-neutral-300">
                    Now click the spot where the way out should stand.
                  </p>
                )}
                <button
                  onClick={() => setPlacing((v) => !v)}
                  className="rounded-full bg-[#0071e3] px-5 py-2 text-sm font-medium transition hover:bg-[#0077ed]"
                >
                  {placing ? "Cancel" : "Add a way out"}
                </button>
              </>
            )}

            {pending && (
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm text-neutral-300">
                  Where does this lead?
                </p>
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                  {linkTargets.map((target) => (
                    <button
                      key={target.id}
                      disabled={saving}
                      onClick={() => saveHotspot(target.id)}
                      className="rounded bg-neutral-800 px-4 py-2 text-sm disabled:opacity-50"
                    >
                      {target.name}
                    </button>
                  ))}
                </div>
                <button
                  onClick={resetDraft}
                  className="rounded-full bg-neutral-700 px-4 py-1.5 text-xs"
                >
                  Discard
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The walkthrough's own audio, played back under the place it was filmed in.
 * Mounted only once the visitor has pressed Enter, which is the gesture the
 * autoplay policy waits for.
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
      <p className="text-sm text-neutral-400">
        The sound recorded here could not be loaded.
      </p>
    );
  }

  return (
    <div className="flex w-72 items-center gap-3 sm:w-96">
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
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-xs text-black"
      >
        {playing ? "❚❚" : "▶"}
      </button>

      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-neutral-400">
        {formatTime(position)}
      </span>

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
        className="flex-1 cursor-pointer accent-white"
      />

      <span className="w-9 shrink-0 text-xs tabular-nums text-neutral-400">
        {formatTime(duration)}
      </span>

      <button
        onClick={() => setLoop((v) => !v)}
        aria-pressed={loop}
        className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
          loop ? "bg-white text-black" : "bg-neutral-800 text-neutral-300"
        }`}
      >
        Loop
      </button>
    </div>
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

/** When and where the walkthrough was filmed, as far as it is known. */
function describeCapture(place: Place) {
  const parts: string[] = [];

  if (place.capturedAt) {
    const when = new Date(place.capturedAt);
    // Dates typed in by hand reach here unparsed, so a bad one is shown as-is
    // rather than as "Invalid Date".
    parts.push(
      Number.isNaN(when.getTime())
        ? place.capturedAt
        : when.toLocaleString(undefined, {
            dateStyle: "long",
            timeStyle: "short",
          }),
    );
  }

  if (place.locationName) parts.push(place.locationName);
  else if (place.location) {
    parts.push(
      `${place.location.lat.toFixed(4)}, ${place.location.lng.toFixed(4)}`,
    );
  }

  return parts.join(" · ");
}
