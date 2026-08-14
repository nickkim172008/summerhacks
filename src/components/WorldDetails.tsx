"use client";

import type { Place } from "@/lib/types";

/**
 * What the reconstruction knows about a capture beyond its picture.
 *
 * Shown only to whoever captured it: it is provenance and cost, not something a
 * visitor to a public journey needs. Absent entirely on places captured before
 * the move to World Labs, which is most of them — so this renders nothing
 * rather than a panel full of dashes.
 */
export default function WorldDetails({ place }: { place: Place }) {
  const world = place.world;
  if (!world) return null;

  const scale = world.metricScaleFactor;
  const ground = world.groundPlaneOffset;

  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-white/45">
        Reconstruction
      </h2>

      {world.caption && (
        <p className="mb-4 text-[14px] leading-relaxed text-white/70">
          {world.caption}
        </p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
        <Row label="Model" value={world.model} />
        <Row
          label="Scale"
          value={scale ? `×${scale.toFixed(3)} to metres` : undefined}
        />
        <Row
          label="Ground"
          value={ground !== undefined ? `y − ${ground.toFixed(3)}` : undefined}
        />
        <Row label="World" value={world.worldId} mono />
      </dl>

      {(world.marbleUrl || world.colliderMeshUrl) && (
        <p className="mt-4 flex gap-4 text-[13px]">
          {world.marbleUrl && (
            <a
              href={world.marbleUrl}
              target="_blank"
              rel="noreferrer"
              className="text-white/70 underline underline-offset-2 hover:text-white"
            >
              Open in Marble
            </a>
          )}
          {world.colliderMeshUrl && (
            <a
              href={world.colliderMeshUrl}
              target="_blank"
              rel="noreferrer"
              className="text-white/70 underline underline-offset-2 hover:text-white"
            >
              Collider mesh
            </a>
          )}
        </p>
      )}
    </section>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <>
      <dt className="text-white/45">{label}</dt>
      <dd
        className={`text-white/80 ${mono ? "break-all font-mono text-[12px]" : ""}`}
      >
        {value}
      </dd>
    </>
  );
}
