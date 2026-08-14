"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import {
  backfillPlaceMedia,
  createPlace,
  repinPlace,
  subscribeToPlacesByUploader,
  subscribeToTrashedPlaces,
} from "@/lib/places";
import { addPlacesToAlbum, createAlbum } from "@/lib/albums";
import type { Place } from "@/lib/types";
import { isFirebaseConfigured } from "@/lib/firebase";
import type { WorldLabsCapture } from "@/lib/captureStatus";
import { extractAudio } from "@/lib/audioTrack";
import { grabPoster } from "@/lib/videoFrame";
import { anonymisedLocation, locationToStore } from "@/lib/privacy";
import { reverseGeocode } from "@/lib/geocode";
import { readVideoCapture } from "@/lib/videoMeta";

/**
 * Brings worlds generated outside the app into a library.
 *
 * The four in scripts/worldlabs-runs.json were made by the standalone script
 * while the pipeline was still being evaluated, so nothing about them ever
 * reached Firestore. This is the one-way door that fixes that: it reads the
 * manifest, pulls each splat, writes a place, and files the lot under one
 * journey.
 *
 * It has to run in the browser, signed in. Firestore's rules require a uid that
 * matches the document being written, and there is no server-side credential in
 * this project to stand in for one — a script could not do this without being
 * handed an account, which is exactly the thing the rules exist to prevent.
 *
 * The splat comes through /api/capture/model rather than straight off World
 * Labs' CDN: same origin, so no CORS question, and it reuses the resolution
 * choice the capture path already makes.
 */

interface ManifestRun {
  world_id: string;
  display_name: string | null;
  model: string | null;
  marble_url: string | null;
  caption: string | null;
  source_video?: string;
  credits?: number;
  semantics_metadata: {
    metric_scale_factor?: number;
    ground_plane_offset?: number;
  } | null;
  collider_mesh_url: string | null;
}

type RowState = "pending" | "working" | "done" | "skipped" | "failed";

interface Row {
  run: ManifestRun;
  state: RowState;
  detail?: string;
  placeId?: string;
}

const JOURNEY_NAME = "World Labs captures";

export default function ImportWorldsPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [albumId, setAlbumId] = useState<string | null>(null);
  /**
   * Worlds already in the library, by world id. An import that ran before the
   * audio was being carried across left silent places behind, and making a
   * second journey full of second copies is not the repair — these are the ones
   * to fill in rather than create.
   */
  const [existing, setExisting] = useState<Map<string, Place>>(new Map());
  /** Every place of the viewer's, for the re-pin below — not only imported ones. */
  const [mine, setMine] = useState<Place[]>([]);
  /**
   * The trash holds captures too, and a place in it is still a document the
   * rules let anyone read — deleting is reversible here, so nothing has left.
   * Eight of them carry the coordinates their video was filmed at, one of them
   * in another country. Leaving them out would be scattering the pins somebody
   * can see while keeping the ones they can also see.
   */
  const [trashed, setTrashed] = useState<Place[]>([]);
  const [repinning, setRepinning] = useState<string | null>(null);
  const [repinFailures, setRepinFailures] = useState<string[]>([]);

  useEffect(() => {
    if (!user) return;
    return subscribeToPlacesByUploader(user.uid, (places) => {
      setMine(places);
      setExisting(
        new Map(
          places
            .filter((place) => place.world?.worldId)
            .map((place) => [place.world!.worldId, place]),
        ),
      );
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return subscribeToTrashedPlaces(user.uid, setTrashed);
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dev/worlds")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? "unreadable");
        return res.json();
      })
      .then((body: { runs: ManifestRun[] }) => {
        if (cancelled) return;
        setRows(body.runs.map((run) => ({ run, state: "pending" })));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setManifestError(
            error instanceof Error ? error.message : "Could not read manifest",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = useCallback((worldId: string, next: Partial<Row>) => {
    setRows((current) =>
      current.map((row) =>
        row.run.world_id === worldId ? { ...row, ...next } : row,
      ),
    );
  }, []);

  const run = useCallback(async () => {
    if (!user) return;
    setRunning(true);
    try {
      // Only worth a new journey if anything is actually new. A run that only
      // repairs what is already filed leaves the journeys alone.
      const missing = rows.filter(
        ({ run: entry }) => !existing.has(entry.world_id),
      );
      const album = missing.length
        ? await createAlbum(JOURNEY_NAME, user.uid)
        : null;
      if (album) setAlbumId(album);

      // One at a time on purpose: each pulls several megabytes and then uploads
      // them again, and running four of those at once on a phone tether is how
      // the whole batch fails together.
      for (const { run: entry } of rows) {
        patch(entry.world_id, { state: "working", detail: "reading…" });
        try {
          const already = existing.get(entry.world_id);

          // The walkthrough itself, when it is still beside the checkout. The
          // audio in this app is never reconstructed — it is lifted off the
          // video in the browser — so a world imported from its id alone is
          // silent, and silence is the one way an imported capture would be
          // worse than a captured one. Where it came from and when it was
          // filmed come off the same file, since those are read from the
          // container too.
          patch(entry.world_id, { detail: "reading the walkthrough…" });
          const source = await loadSourceVideo(entry.source_video);
          const audio = source ? await extractAudio(source, "walkthrough").catch(() => null) : null;
          const poster = source ? await grabPoster(source).catch(() => null) : null;
          const filmed = source
            ? await readVideoCapture(source).catch(() => null)
            : null;

          // Already in the library: give it the sound and the still it was
          // saved without, and leave everything else as it is.
          if (already) {
            if (!source) {
              patch(entry.world_id, {
                state: "skipped",
                detail: "already saved · source video not here",
                placeId: already.id,
              });
              continue;
            }
            const filled = await backfillPlaceMedia(already.id, {
              audioFile: audio?.file ?? null,
              audioSeconds: audio?.seconds,
              thumbnail: poster,
            });
            // Re-pinned here as well. A place written before captures were
            // pinned away from where they were filmed still holds the real
            // coordinates, and adding sound to it does not change that — so
            // repairing one without the other leaves the thing that matters.
            const moved = await repinToronto(already);
            patch(entry.world_id, {
              state: "done",
              detail: [
                filled.audio
                  ? "sound added"
                  : already.audioUrl
                    ? "already had sound"
                    : "no audio on that video",
                moved ? "re-pinned" : null,
              ]
                .filter(Boolean)
                .join(" · "),
              placeId: already.id,
            });
            continue;
          }

          patch(entry.world_id, { detail: "downloading the splat…" });
          const res = await fetch(
            `/api/capture/model?world=${encodeURIComponent(entry.world_id)}`,
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error ?? `download failed (${res.status})`);
          }
          const blob = await res.blob();
          if (blob.size === 0) throw new Error("this world has no splat");

          patch(entry.world_id, { detail: "uploading…" });
          const name =
            entry.display_name?.trim() ||
            entry.source_video?.replace(/\.[^.]+$/, "") ||
            "Untitled world";

          const world: WorldLabsCapture = {
            worldId: entry.world_id,
            caption: entry.caption ?? undefined,
            metricScaleFactor: entry.semantics_metadata?.metric_scale_factor,
            groundPlaneOffset: entry.semantics_metadata?.ground_plane_offset,
            colliderMeshUrl: entry.collider_mesh_url ?? undefined,
            marbleUrl: entry.marble_url ?? undefined,
            model: entry.model ?? undefined,
          };

          const placeId = await createPlace(
            name,
            new File([blob], `${entry.world_id}.spz`, {
              type: "application/octet-stream",
            }),
            user.uid,
            {
              world,
              audioFile: audio?.file ?? null,
              audioSeconds: audio?.seconds,
              thumbnail: poster,
              capturedAt: filmed?.capturedAt ?? undefined,
              // The walkthroughs these were made from carry real GPS, and a
              // home office is somebody's home. Seeded on the world id so the
              // pin is the same every time this runs.
              location: locationToStore(entry.world_id, filmed?.location),
            },
          );
          if (album) await addPlacesToAlbum(album, [placeId]);
          patch(entry.world_id, {
            state: "done",
            detail: `${(blob.size / 1e6).toFixed(1)} MB${audio ? " · with sound" : " · silent"}`,
            placeId,
          });
        } catch (error) {
          patch(entry.world_id, {
            state: "failed",
            detail: error instanceof Error ? error.message : "failed",
          });
        }
      }
    } catch (error) {
      setManifestError(
        error instanceof Error ? error.message : "Could not create the journey",
      );
    } finally {
      setRunning(false);
    }
  }, [rows, user, patch, existing]);

  const everyPlace = [...mine, ...trashed];
  const repin = useRepin(everyPlace, setRepinning, setRepinFailures);
  // Anything outside the box the decoys are drawn from still holds what the
  // video said. Not proof — a real coordinate could fall inside Toronto, which
  // is exactly the case for anything genuinely filmed here — but it is what can
  // be told from the outside, and it errs toward offering the sweep again.
  const realCount = everyPlace.filter(inToronto.notYet).length;

  const newCount = rows.filter(
    ({ run: entry }) => !existing.has(entry.world_id),
  ).length;

  if (!isFirebaseConfigured) {
    return (
      <Shell>
        <p className="text-[15px] text-[#4A4F57]">
          This needs Firebase. Fill in the NEXT_PUBLIC_FIREBASE_* values in
          .env.local and reload.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      {manifestError && (
        <p className="mb-4 rounded-xl border border-[rgba(161,18,18,0.2)] bg-[#FDECEC] px-4 py-3 text-[14px] text-[#A11212]">
          {manifestError}
        </p>
      )}

      <ol className="mb-6 space-y-2">
        {rows.map(({ run: entry, state, detail, placeId }) => (
          <li
            key={entry.world_id}
            className="rounded-xl border border-[rgba(20,22,26,0.1)] bg-white px-4 py-3"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[15px] font-medium text-[#14161A]">
                {entry.display_name ?? entry.world_id}
              </span>
              <span className="shrink-0 text-[13px] text-[#6B7178]">
                {state === "done" && placeId ? (
                  <Link
                    href={`/place/${placeId}`}
                    className="text-[#0A7B34] underline underline-offset-2"
                  >
                    saved · {detail}
                  </Link>
                ) : (
                  (detail ?? state)
                )}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-[#8A9098]">
              {entry.model ?? "—"} · {entry.source_video ?? "—"}
              {entry.semantics_metadata?.metric_scale_factor
                ? ` · scale ×${entry.semantics_metadata.metric_scale_factor.toFixed(2)}`
                : " · no scale metadata"}
              {entry.credits ? ` · ${entry.credits} credits` : ""}
            </p>
          </li>
        ))}
      </ol>

      {!loading && !user && (
        <p className="text-[15px] text-[#4A4F57]">
          <Link href="/signin?next=/dev/import" className="underline">
            Sign in
          </Link>{" "}
          to write these into your library — the rules need your own account.
        </p>
      )}

      {user && (
        <button
          onClick={run}
          disabled={running || rows.length === 0}
          className="rounded-full bg-[#14161A] px-5 py-2.5 text-[14px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {running
            ? "Working…"
            : newCount === 0
              ? `Add sound to ${rows.length} already-saved world${rows.length === 1 ? "" : "s"}`
              : newCount === rows.length
                ? `Import ${rows.length} world${rows.length === 1 ? "" : "s"} into “${JOURNEY_NAME}”`
                : `Import ${newCount} new, repair ${rows.length - newCount} already saved`}
        </button>
      )}

      {user && (
        <section className="mt-8 rounded-2xl border border-[rgba(180,120,20,0.28)] bg-[#FFF6E5] p-5">
          <h2 className="text-[15px] font-semibold text-[#7A4E00]">
            Where your captures say they are
          </h2>
          {realCount > 0 ? (
            <>
              <p className="mt-1 text-[14px] leading-relaxed text-[#6B5320]">
                {realCount} of your {everyPlace.length} places (the trash
                included) still carry the
                coordinates their video was filmed at. A phone writes GPS into
                the container, and an indoor capture is usually somebody&rsquo;s
                home — this moves each to a point in Toronto derived from its
                own id, and renames it to match.
              </p>
              <button
                onClick={repin}
                disabled={repinning !== null}
                className="mt-4 rounded-full bg-[#B4780F] px-5 py-2.5 text-[14px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {repinning
                  ? `Re-pinning ${repinning}…`
                  : `Scatter ${realCount} place${realCount === 1 ? "" : "s"} across Toronto`}
              </button>
              {repinFailures.length > 0 && (
                <ul className="mt-3 space-y-1 text-[12px] text-[#A11212]">
                  {repinFailures.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              <ul className="mt-4 space-y-1 text-[12px] text-[#8A7340]">
                {everyPlace
                  .filter(inToronto.notYet)
                  .map((place) => (
                    <li key={place.id} className="font-mono">
                      {place.name} — {place.location!.lat.toFixed(4)},{" "}
                      {place.location!.lng.toFixed(4)}
                    </li>
                  ))}
              </ul>
            </>
          ) : (
            <p className="mt-1 text-[14px] text-[#6B5320]">
              Every place with a location is pinned inside Toronto. Nothing here
              is where it was filmed.
            </p>
          )}
        </section>
      )}

      {albumId && !running && (
        <p className="mt-4 text-[15px]">
          <Link
            href={`/album/${albumId}`}
            className="text-[#0A7B34] underline underline-offset-2"
          >
            Open the journey →
          </Link>
        </p>
      )}
    </Shell>
  );
}

/**
 * The walkthrough a world was made from, if it is still in the project
 * directory. Absent is ordinary — the videos are gitignored, so nobody else's
 * clone has them — and an import without one simply saves a silent place.
 */
async function loadSourceVideo(name?: string): Promise<File | null> {
  if (!name) return null;
  try {
    const res = await fetch(
      `/api/dev/worlds/video?name=${encodeURIComponent(name)}`,
    );
    if (!res.ok) return null;
    const blob = await res.blob();
    return new File([blob], name, { type: blob.type || "video/quicktime" });
  } catch {
    return null;
  }
}

/**
 * Re-pins every place that already carries a location.
 *
 * Captures saved before this stored the coordinates their video was filmed at,
 * which for anything shot indoors is somebody's address. Nothing about the
 * capture changes but where the map says it is, and the label with it.
 */
/**
 * Moves one place to a Toronto point derived from its own id, and renames it
 * from there. Returns false for a place that never had a location: giving one
 * to a capture that carried none invents a fact rather than hiding one.
 */
/**
 * Whether a place still carries the coordinates its video was filmed at.
 *
 * The test is that the stored point is not the decoy its own id derives — not
 * that it falls outside Toronto. A bounding box cannot answer this: captures
 * filmed in Toronto land inside it while being entirely real, which is most of
 * this library, and reading that as "already anonymised" reports the job done
 * while every address is still published.
 *
 * The decoy is a pure function of the id, so recomputing it is free and exact.
 */
const inToronto = {
  notYet: (place: Place) => {
    const at = place.location;
    if (!at) return false;
    const decoy = anonymisedLocation(place.id);
    return (
      Math.abs(at.lat - decoy.lat) > 1e-6 || Math.abs(at.lng - decoy.lng) > 1e-6
    );
  },
};

async function repinToronto(place: Place): Promise<boolean> {
  if (!place.location) return false;
  const location = anonymisedLocation(place.id);
  // Named from the decoy so the label agrees with the pin — labels like
  // "Nick's Basement" identify an address on their own, with or without
  // coordinates. Given at most a couple of seconds: the naming is a courtesy
  // and the move is the point, and a geocoder that hangs must not be able to
  // stop the sweep partway and leave the rest published. A lookup that does not
  // answer clears the name instead, which is the safe direction to fail.
  const name = await Promise.race([
    reverseGeocode(location).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
  ]);
  return repinPlace(place.id, location, name);
}

function useRepin(
  mine: Place[],
  setRepinning: (value: string | null) => void,
  onFailures: (failures: string[]) => void,
) {
  return async () => {
    const pinned = mine.filter((place) => place.location);
    const failures: string[] = [];
    let done = 0;
    for (const place of pinned) {
      setRepinning(`${done}/${pinned.length}`);
      try {
        await repinToronto(place);
      } catch (error) {
        // Named rather than swallowed. A silent catch here is how a run
        // finishes looking complete while places stay where they were filmed —
        // which is what a previous sweep did, stopping at 8 of 22 with nothing
        // on screen to say so.
        failures.push(
          `${place.name}: ${error instanceof Error ? error.message : "refused"}`,
        );
      }
      done += 1;
    }
    onFailures(failures);
    setRepinning(null);
  };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#FAF9F7] px-6 py-12 text-[#14161A]">
      <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-[26px] font-semibold text-[#14161A]">
        Import World Labs captures
      </h1>
      <p className="mb-6 text-[14px] leading-relaxed text-[#6B7178]">
        Worlds generated by scripts/worldlabs.mjs before the app pointed at
        World Labs. Anything already in your library is repaired in place —
        given the sound and the still frame it was saved without — rather than
        imported a second time.
      </p>
      {children}
      </div>
    </main>
  );
}
