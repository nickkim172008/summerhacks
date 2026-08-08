"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import * as THREE from "three";
import { SpatialAudioEngine } from "@/lib/spatialAudio";
import { VoiceRecorder } from "@/lib/recorder";
import type { AudioPin, Place, Vec3 } from "@/lib/types";

const SplatViewer = dynamic(() => import("./SplatViewer"), { ssr: false });

const FADE_MS = 350;

export interface PlaceExperienceProps {
  place: Place;
  pins: AudioPin[];
  onSubmitPin: (
    point: Vec3,
    recording: { blob: Blob; duration: number },
    caption: string,
  ) => Promise<void>;
  onJump: (placeId: string) => void;
}

export default function PlaceExperience({
  place,
  pins,
  onSubmitPin,
  onJump,
}: PlaceExperienceProps) {
  const [entered, setEntered] = useState(false);
  const [placementMode, setPlacementMode] = useState(false);
  const [pending, setPending] = useState<Vec3 | null>(null);
  const [recording, setRecording] = useState(false);
  const [captured, setCaptured] = useState<{ blob: Blob; duration: number } | null>(null);
  const [caption, setCaption] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [jumping, setJumping] = useState(false);

  const engineRef = useRef<SpatialAudioEngine | null>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);

  useEffect(() => {
    const engine = new SpatialAudioEngine();
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Arriving somewhere new clears the previous place's UI state.
  const [renderedPlaceId, setRenderedPlaceId] = useState(place.id);
  if (renderedPlaceId !== place.id) {
    setRenderedPlaceId(place.id);
    setPlayingId(null);
    setJumping(false);
    setPending(null);
    setCaptured(null);
    setCaption("");
    setRecording(false);
    setPlacementMode(false);
  }

  // Voices belong to the place that was left behind, so silence them on arrival.
  useEffect(() => {
    engineRef.current?.stopAll();
    recorderRef.current?.cancel();
    recorderRef.current = null;
  }, [place.id]);

  const handleCameraFrame = useCallback((camera: THREE.PerspectiveCamera) => {
    engineRef.current?.updateListener(camera);
  }, []);

  const handleSceneReady = useCallback((radius: number) => {
    engineRef.current?.setSceneScale(radius);
  }, []);

  const handlePinClick = useCallback(
    (pinId: string) => {
      const pin = pins.find((p) => p.id === pinId);
      if (!pin?.audioUrl) return;
      setPlayingId(pinId);
      engineRef.current
        ?.play(pinId, pin.audioUrl, pin, () => setPlayingId(null))
        .catch(() => setError("Could not play that memory."));
    },
    [pins],
  );

  const handleHotspotClick = useCallback(
    (placeId: string) => {
      // Fade out first so the splat swap reads as travel, not a glitch.
      setJumping(true);
      engineRef.current?.stopAll();
      setTimeout(() => onJump(placeId), FADE_MS);
    },
    [onJump],
  );

  async function handleEnter() {
    // AudioContext stays suspended until a gesture; without this, spatial audio
    // silently never starts.
    await engineRef.current?.resume();
    setEntered(true);
  }

  async function startRecording() {
    setError(null);
    try {
      const recorder = new VoiceRecorder();
      await recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setError("Microphone access was denied.");
    }
  }

  async function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setCaptured(await recorder.stop());
    recorderRef.current = null;
    setRecording(false);
  }

  async function save() {
    if (!pending || !captured) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmitPin(pending, captured, caption.trim());
      resetDraft();
    } catch {
      setError("Could not save that memory. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function resetDraft() {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setPending(null);
    setCaptured(null);
    setCaption("");
    setRecording(false);
    setPlacementMode(false);
  }

  return (
    <div className="relative h-full w-full bg-black text-white">
      <SplatViewer
        splatUrl={place.splatUrl}
        pins={pins}
        hotspots={place.hotspots}
        entryPoint={place.entryPoint}
        placementMode={placementMode}
        onPlacePoint={(point) => {
          setPending(point);
          setPlacementMode(false);
        }}
        onPinClick={handlePinClick}
        onHotspotClick={handleHotspotClick}
        onCameraFrame={handleCameraFrame}
        onSceneReady={handleSceneReady}
        activePinIds={playingId ? [playingId] : []}
      />

      <div
        className="pointer-events-none absolute inset-0 z-30 bg-black transition-opacity"
        style={{
          opacity: jumping ? 1 : 0,
          transitionDuration: `${FADE_MS}ms`,
        }}
      />

      {!entered && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/85 backdrop-blur">
          <h1 className="text-2xl font-semibold">{place.name}</h1>
          <p className="max-w-sm text-center text-sm text-neutral-300">
            Move through the space and listen. Voices are pinned where they were
            left — they get louder as you approach.
          </p>
          <button
            onClick={handleEnter}
            className="rounded-full bg-white px-6 py-2 font-medium text-black"
          >
            Enter
          </button>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-4">
        <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-2xl bg-neutral-900/90 p-4 backdrop-blur">
          {error && <p className="text-sm text-red-400">{error}</p>}

          {!pending && (
            <button
              onClick={() => setPlacementMode((v) => !v)}
              className="rounded-full bg-sky-500 px-5 py-2 text-sm font-medium"
            >
              {placementMode ? "Cancel" : "Leave a memory here"}
            </button>
          )}

          {pending && (
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-neutral-300">
                {captured
                  ? `Recorded ${captured.duration.toFixed(1)}s`
                  : recording
                    ? "Recording…"
                    : "Spot chosen. Record your voice."}
              </p>

              {!captured && (
                <button
                  onClick={recording ? stopRecording : startRecording}
                  className={`rounded-full px-5 py-2 text-sm font-medium ${
                    recording ? "bg-red-500" : "bg-white text-black"
                  }`}
                >
                  {recording ? "Stop" : "Record"}
                </button>
              )}

              {captured && (
                <>
                  <input
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    placeholder="Add a caption (optional)"
                    className="w-64 rounded bg-neutral-800 px-3 py-2 text-sm outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={save}
                      disabled={saving}
                      className="rounded-full bg-sky-500 px-5 py-2 text-sm font-medium disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Leave it here"}
                    </button>
                    <button
                      onClick={resetDraft}
                      className="rounded-full bg-neutral-700 px-4 py-2 text-sm"
                    >
                      Discard
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <p className="text-xs text-neutral-500">
            {pins.length} {pins.length === 1 ? "voice" : "voices"} here
          </p>
        </div>
      </div>
    </div>
  );
}
