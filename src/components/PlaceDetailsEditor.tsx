"use client";

import { useEffect, useRef, useState } from "react";
import { geocodeName, reverseGeocode } from "@/lib/geocode";
import { prepareImage, THUMBNAIL_EDGE } from "@/lib/imageFile";
import { updatePlaceDetails } from "@/lib/places";
import { uploadThumbnail } from "@/lib/splatStore";
import PlaceThumb from "@/components/PlaceThumb";
import type { Place } from "@/lib/types";

/**
 * Everything about where a capture is, in one sheet: what it is called, where
 * it says it was, the point the heatmap actually plots, and the tile it shows
 * in a grid.
 *
 * Coordinates are kept as text while editing so a half-typed "-79." is not
 * rounded off or rejected mid-keystroke; they are parsed on save.
 */
export default function PlaceDetailsEditor({
  place,
  onClose,
  onSaved,
}: {
  place: Place;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [name, setName] = useState(place.name);
  const [locationName, setLocationName] = useState(place.locationName ?? "");
  const [lat, setLat] = useState(place.location?.lat?.toString() ?? "");
  const [lng, setLng] = useState(place.location?.lng?.toString() ?? "");
  const [busy, setBusy] = useState<"saving" | "looking" | "naming" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // The picture is staged rather than uploaded on pick, so Cancel means cancel
  // here as it does for every other field in the sheet.
  const imageRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const coords = readCoords(lat, lng);
  const coordsBroken = (lat.trim() || lng.trim()) && !coords;
  const hasThumbnail =
    Boolean(preview) || (!cleared && Boolean(place.thumbnailUrl));

  async function pickImage(file: File | undefined) {
    if (!file || busy) return;
    setError(null);
    try {
      const image = await prepareImage(file, { maxEdge: THUMBNAIL_EDGE });
      setPicked(image);
      setPreview(URL.createObjectURL(image));
      setCleared(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not read that image.",
      );
    } finally {
      // Without this, picking the same file again fires no change event.
      if (imageRef.current) imageRef.current.value = "";
    }
  }

  function clearImage() {
    setPicked(null);
    setPreview(null);
    setCleared(true);
  }

  async function lookUp() {
    if (!locationName.trim()) return;
    setBusy("looking");
    setError(null);
    const found = await geocodeName(locationName);
    setBusy(null);
    if (!found) {
      setError(`Could not find "${locationName.trim()}" on the map.`);
      return;
    }
    setLat(found.lat.toFixed(6));
    setLng(found.lng.toFixed(6));
  }

  async function nameFromCoords() {
    if (!coords) return;
    setBusy("naming");
    setError(null);
    const found = await reverseGeocode(coords);
    setBusy(null);
    if (!found) {
      setError("No place name came back for those coordinates.");
      return;
    }
    setLocationName(found);
  }

  async function save() {
    if (!name.trim()) {
      setError("A capture needs a name.");
      return;
    }
    if (coordsBroken) {
      setError(
        "Latitude and longitude both need to be numbers, or both empty.",
      );
      return;
    }
    setBusy("saving");
    setError(null);
    try {
      // Only now does anything leave the browser. A refused upload has to stop
      // the save rather than pass quietly, the way it does at capture time —
      // this one was asked for, so its failure is worth hearing about.
      await updatePlaceDetails(place.id, {
        name,
        locationName,
        location: coords,
        thumbnailUrl: picked
          ? await uploadThumbnail(place.id, picked)
          : cleared
            ? ""
            : undefined,
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save those changes.",
      );
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-[#1d1d1f] shadow-2xl">
        <h2 className="text-[22px] font-semibold tracking-tight">
          Edit environment
        </h2>

        <div className="mt-5 flex items-center gap-4">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-neutral-100 ring-1 ring-black/5">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <PlaceThumb
                place={cleared ? { ...place, thumbnailUrl: "" } : place}
              />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-medium">Thumbnail</p>
            <p className="mt-0.5 text-[12px] leading-snug text-neutral-500">
              What this shows in album grids. Taken off the walkthrough unless
              you pick something else.
            </p>
            <input
              ref={imageRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="hidden"
              onChange={(e) => void pickImage(e.target.files?.[0])}
            />
            <div className="mt-2 flex items-center gap-4 text-[13px] font-medium">
              <button
                type="button"
                onClick={() => imageRef.current?.click()}
                disabled={busy !== null}
                className="text-[#0071e3] transition hover:opacity-70 disabled:opacity-40"
              >
                Choose image
              </button>
              {hasThumbnail && (
                <button
                  type="button"
                  onClick={clearImage}
                  disabled={busy !== null}
                  className="text-neutral-500 transition hover:text-neutral-800 disabled:opacity-40"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>

        <label className="mt-5 block text-[13px] font-medium">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-xl border border-black/10 bg-neutral-50 px-4 py-2.5 text-[15px] font-normal outline-none focus:border-[#0071e3]"
          />
        </label>

        <label className="mt-4 block text-[13px] font-medium">
          Location
          <input
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            placeholder="Toronto, or High Park, or a room"
            className="mt-1 w-full rounded-xl border border-black/10 bg-neutral-50 px-4 py-2.5 text-[15px] font-normal outline-none focus:border-[#0071e3]"
          />
        </label>

        <div className="mt-4 flex items-start gap-3">
          <label className="flex-1 text-[13px] font-medium">
            Latitude
            <input
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              inputMode="decimal"
              placeholder="43.652"
              className="mt-1 w-full rounded-xl border border-black/10 bg-neutral-50 px-4 py-2.5 font-mono text-[14px] font-normal outline-none focus:border-[#0071e3]"
            />
          </label>
          <label className="flex-1 text-[13px] font-medium">
            Longitude
            <input
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              inputMode="decimal"
              placeholder="-79.405"
              className="mt-1 w-full rounded-xl border border-black/10 bg-neutral-50 px-4 py-2.5 font-mono text-[14px] font-normal outline-none focus:border-[#0071e3]"
            />
          </label>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[12px] text-neutral-500">
            {coords
              ? "Plotted exactly here."
              : locationName.trim()
                ? "Plotted from the name, which lands city-centre."
                : "Not on the map until it has a location."}
          </p>
          <div className="flex shrink-0 items-center gap-3">
            <button
              onClick={nameFromCoords}
              disabled={!coords || busy !== null}
              className="text-[13px] font-medium text-[#0071e3] disabled:opacity-40"
            >
              {busy === "naming" ? "Naming…" : "Name the point"}
            </button>
            <button
              onClick={lookUp}
              disabled={!locationName.trim() || busy !== null}
              className="text-[13px] font-medium text-[#0071e3] disabled:opacity-40"
            >
              {busy === "looking" ? "Looking up…" : "Use the name"}
            </button>
          </div>
        </div>

        {error && <p className="mt-4 text-[13px] text-red-600">{error}</p>}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={busy === "saving"}
            className="rounded-full border border-black/10 px-5 py-2 text-[15px] transition hover:bg-neutral-50 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy !== null}
            className="rounded-full bg-[#0071e3] px-5 py-2 text-[15px] font-medium text-white transition hover:bg-[#0077ed] disabled:opacity-40"
          >
            {busy === "saving" ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Both or neither: half a coordinate cannot be plotted. */
function readCoords(lat: string, lng: string) {
  if (!lat.trim() || !lng.trim()) return null;
  const latitude = Number(lat);
  const longitude = Number(lng);
  const valid =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180;
  return valid ? { lat: latitude, lng: longitude } : null;
}
