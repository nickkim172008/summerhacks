"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { createPlace } from "@/lib/places";
import { addPlacesToAlbum, createAlbum } from "@/lib/albums";
import { isFirebaseConfigured } from "@/lib/firebase";
import type { WorldLabsCapture } from "@/lib/captureStatus";

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
      const album = await createAlbum(JOURNEY_NAME, user.uid);
      setAlbumId(album);

      // One at a time on purpose: each pulls several megabytes and then uploads
      // them again, and running four of those at once on a phone tether is how
      // the whole batch fails together.
      for (const { run: entry } of rows) {
        patch(entry.world_id, { state: "working", detail: "downloading…" });
        try {
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
            { world },
          );
          await addPlacesToAlbum(album, [placeId]);
          patch(entry.world_id, {
            state: "done",
            detail: `${(blob.size / 1e6).toFixed(1)} MB`,
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
  }, [rows, user, patch]);

  if (!isFirebaseConfigured) {
    return (
      <Shell>
        <p className="text-[15px] text-white/70">
          This needs Firebase. Fill in the NEXT_PUBLIC_FIREBASE_* values in
          .env.local and reload.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      {manifestError && (
        <p className="mb-4 rounded-xl bg-red-500/10 px-4 py-3 text-[14px] text-red-200">
          {manifestError}
        </p>
      )}

      <ol className="mb-6 space-y-2">
        {rows.map(({ run: entry, state, detail, placeId }) => (
          <li
            key={entry.world_id}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[15px] font-medium text-white">
                {entry.display_name ?? entry.world_id}
              </span>
              <span className="shrink-0 text-[13px] text-white/50">
                {state === "done" && placeId ? (
                  <Link
                    href={`/place/${placeId}`}
                    className="text-emerald-300 underline underline-offset-2"
                  >
                    saved · {detail}
                  </Link>
                ) : (
                  (detail ?? state)
                )}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-white/45">
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
        <p className="text-[15px] text-white/70">
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
          className="rounded-full bg-white px-5 py-2.5 text-[14px] font-medium text-[#14161A] disabled:opacity-40"
        >
          {running
            ? "Importing…"
            : `Import ${rows.length} world${rows.length === 1 ? "" : "s"} into “${JOURNEY_NAME}”`}
        </button>
      )}

      {albumId && !running && (
        <p className="mt-4 text-[15px]">
          <Link
            href={`/album/${albumId}`}
            className="text-emerald-300 underline underline-offset-2"
          >
            Open the journey →
          </Link>
        </p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-1 text-[26px] font-semibold text-white">
        Import World Labs captures
      </h1>
      <p className="mb-6 text-[14px] text-white/55">
        Worlds generated by scripts/worldlabs.mjs before the app pointed at
        World Labs. Running this twice makes a second journey holding second
        copies — there is no dedupe.
      </p>
      {children}
    </main>
  );
}
