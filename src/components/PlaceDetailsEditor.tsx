"use client";

import { useState } from "react";
import { geocodeName } from "@/lib/geocode";
import { updatePlaceDetails } from "@/lib/places";
import type { Place } from "@/lib/types";

/**
 * Everything about where a capture is, in one sheet: what it is called, where
 * it says it was, and the point the heatmap actually plots.
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
  const [busy, setBusy] = useState<"saving" | "looking" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const coords = readCoords(lat, lng);
  const coordsBroken = (lat.trim() || lng.trim()) && !coords;

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
      await updatePlaceDetails(place.id, {
        name,
        locationName,
        location: coords,
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
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-[#1d1d1f] shadow-2xl">
        <h2 className="text-[22px] font-semibold tracking-tight">
          Edit environment
        </h2>

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
          <button
            onClick={lookUp}
            disabled={!locationName.trim() || busy !== null}
            className="shrink-0 text-[13px] font-medium text-[#0071e3] disabled:opacity-40"
          >
            {busy === "looking" ? "Looking up…" : "Use the name"}
          </button>
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
