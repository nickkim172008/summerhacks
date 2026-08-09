/**
 * node --experimental-strip-types scripts/captureTimeline.test.mts
 *
 * Fixtures are the real library's shape: an evening spanning 18:10 to 01:03
 * with four captures inside ten minutes of it, because that clump is what the
 * clustering and the pacing exist for.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { Place } from "../src/lib/types";

/**
 * Node needs the ".ts" on the specifier to strip the module's types, and
 * TypeScript rejects that extension unless allowImportingTsExtensions is set —
 * which is a tsconfig change this test does not get to make. A computed
 * specifier satisfies Node, and the cast restores the types tsc would have
 * inferred from a static import.
 */
const timeline = (await import(
  new URL("../src/lib/captureTimeline.ts", import.meta.url).href
)) as typeof import("@/lib/captureTimeline");

const {
  toTimelineEntries,
  spanOf,
  positionOf,
  clusterTicks,
  paceEntries,
  visibleAt,
} = timeline;

type CreatedAt = Place["createdAt"];

/**
 * Firestore's Timestamp carries a great deal more than this, but toMillis is
 * all the axis reads, and pulling firebase into a node test would buy nothing.
 */
function stamp(ms: number): CreatedAt {
  return { toMillis: () => ms } as unknown as CreatedAt;
}

interface Fixture {
  id: string;
  name?: string;
  capturedAt?: string;
  /** Absent models the real gap: createdAt is null until the server resolves it. */
  createdAtMs?: number;
  location?: { lat: number; lng: number };
  locationName?: string;
}

function place(fixture: Fixture): Place {
  return {
    id: fixture.id,
    name: fixture.name ?? fixture.id,
    uploaderId: "uploader",
    createdAt:
      fixture.createdAtMs === undefined
        ? (null as unknown as CreatedAt)
        : stamp(fixture.createdAtMs),
    splatUrl: "",
    thumbnailUrl: "",
    ...(fixture.capturedAt ? { capturedAt: fixture.capturedAt } : {}),
    ...(fixture.location ? { location: fixture.location } : {}),
    ...(fixture.locationName ? { locationName: fixture.locationName } : {}),
  };
}

const iso = (text: string) => Date.parse(text);

const FILMED = {
  dusk: "2026-08-07T18:10:00-04:00",
  clump: "2026-08-07T21:35:00-04:00",
  clumpLater: "2026-08-07T21:40:00-04:00",
  clumpLast: "2026-08-07T21:45:00-04:00",
  night: "2026-08-07T23:50:00-04:00",
  after: "2026-08-08T01:03:00-04:00",
};

/** The whole measured library: seven on the axis, one that cannot be. */
function evening(): Place[] {
  return [
    place({ id: "p-night", capturedAt: FILMED.night }),
    place({ id: "p-clump-b", capturedAt: FILMED.clump }),
    place({ id: "p-dusk", capturedAt: FILMED.dusk }),
    place({ id: "p-after", capturedAt: FILMED.after }),
    place({ id: "p-clump-c", capturedAt: FILMED.clumpLater }),
    place({ id: "p-clump-a", capturedAt: FILMED.clump }),
    place({ id: "p-clump-d", capturedAt: FILMED.clumpLast }),
  ];
}

const PACING = { totalMs: 15000, maxStepMs: 3000, minStepMs: 900 };

test("orders by filmed time, falling back to upload time", () => {
  const entries = toTimelineEntries([
    place({ id: "uploaded-late", createdAtMs: iso(FILMED.after) }),
    place({
      id: "filmed-first",
      capturedAt: FILMED.dusk,
      createdAtMs: iso(FILMED.night),
    }),
    place({ id: "uploaded-early", createdAtMs: iso(FILMED.clump) }),
  ]);

  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["filmed-first", "uploaded-early", "uploaded-late"],
  );
  assert.deepEqual(
    entries.map((entry) => entry.source),
    ["filmed", "uploaded", "uploaded"],
  );
  // Filming and upload are hours apart, so both stay on the entry.
  assert.equal(entries[0].at, iso(FILMED.dusk));
  assert.equal(entries[0].filmedAt, iso(FILMED.dusk));
  assert.equal(entries[0].uploadedAt, iso(FILMED.night));
  assert.equal(entries[1].filmedAt, null);
});

test("drops a place with no usable timestamp, keeps a hand-typed one's upload", () => {
  const places = [
    place({ id: "keeps", capturedAt: FILMED.dusk }),
    place({
      id: "typed-by-hand",
      capturedAt: "last summer sometime",
      createdAtMs: iso(FILMED.night),
    }),
    place({ id: "no-axis", capturedAt: "not a date" }),
  ];
  const entries = toTimelineEntries(places);

  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["keeps", "typed-by-hand"],
  );
  assert.equal(entries[1].source, "uploaded");
  assert.equal(entries[1].filmedAt, null);
  // The caller reports the exclusion by comparing lengths.
  assert.equal(places.length - entries.length, 1);
});

test("reports whether the map could ever place an entry", () => {
  const entries = toTimelineEntries([
    place({
      id: "geotagged",
      capturedAt: FILMED.dusk,
      location: { lat: 43.6, lng: -79.4 },
    }),
    place({ id: "named", capturedAt: FILMED.clump, locationName: "High Park" }),
    place({ id: "nowhere", capturedAt: FILMED.night }),
  ]);

  assert.deepEqual(
    entries.map((entry) => entry.hasLocation),
    [true, true, false],
  );
});

test("breaks ties by id, whatever order the snapshot arrived in", () => {
  const shared = ["p-a", "p-b", "p-c", "p-d"].map((id) =>
    place({ id, capturedAt: FILMED.clump }),
  );
  const expected = ["p-a", "p-b", "p-c", "p-d"];

  assert.deepEqual(
    toTimelineEntries(shared).map((entry) => entry.id),
    expected,
  );
  assert.deepEqual(
    toTimelineEntries([...shared].reverse()).map((entry) => entry.id),
    expected,
  );
  assert.deepEqual(
    toTimelineEntries([shared[2], shared[0], shared[3], shared[1]]).map(
      (entry) => entry.id,
    ),
    expected,
  );
});

test("a single capture has a zero-width span and no division by zero", () => {
  const entries = toTimelineEntries([
    place({ id: "only", capturedAt: FILMED.clump }),
  ]);
  const span = spanOf(entries);

  assert.ok(span);
  assert.equal(span.start, span.end);
  assert.equal(positionOf(entries[0].at, span), 0);
  assert.deepEqual(
    clusterTicks(entries, span, { widthPx: 360, minGapPx: 12 }),
    [{ at: entries[0].at, position: 0, entries: [entries[0]] }],
  );

  const steps = paceEntries(entries, PACING);
  assert.equal(steps.length, 1);
  assert.ok(Number.isFinite(steps[0].holdMs));
  // Nothing to be proportional to, so the whole run goes to the one capture —
  // up to the cap, which wins.
  assert.equal(steps[0].holdMs, PACING.maxStepMs);
});

test("an empty album yields nothing rather than a fallback", () => {
  assert.deepEqual(toTimelineEntries([]), []);
  assert.equal(spanOf([]), null);
  assert.deepEqual(
    clusterTicks([], { start: 0, end: 0 }, { widthPx: 360, minGapPx: 12 }),
    [],
  );
  assert.deepEqual(paceEntries([], PACING), []);
  assert.deepEqual(visibleAt([], Date.now()), []);
});

test("positions run 0..1 and clamp outside the span", () => {
  const span = { start: iso(FILMED.dusk), end: iso(FILMED.after) };
  assert.equal(positionOf(span.start, span), 0);
  assert.equal(positionOf(span.end, span), 1);
  assert.ok(
    Math.abs(positionOf((span.start + span.end) / 2, span) - 0.5) < 1e-9,
  );
  assert.equal(positionOf(span.start - 60_000, span), 0);
  assert.equal(positionOf(span.end + 60_000, span), 1);
});

test("four captures inside ten minutes collapse into one tick", () => {
  const entries = toTimelineEntries(evening());
  const span = spanOf(entries);
  assert.ok(span);

  const clusters = clusterTicks(entries, span, { widthPx: 360, minGapPx: 12 });

  assert.equal(clusters.length, 4);
  assert.deepEqual(
    clusters.map((cluster) => cluster.entries.length),
    [1, 4, 1, 1],
  );
  assert.deepEqual(
    clusters[1].entries.map((entry) => entry.id),
    ["p-clump-a", "p-clump-b", "p-clump-c", "p-clump-d"],
  );
  // The cluster is drawn at its earliest member.
  assert.equal(clusters[1].at, iso(FILMED.clump));
  assert.equal(clusters[1].position, positionOf(iso(FILMED.clump), span));

  // Every drawn tick keeps its distance from the one before it.
  for (let i = 1; i < clusters.length; i += 1) {
    const gapPx = (clusters[i].position - clusters[i - 1].position) * 360;
    assert.ok(gapPx >= 12, `ticks ${i - 1} and ${i} are ${gapPx}px apart`);
  }
});

test("three well-spread captures stay three ticks", () => {
  const entries = toTimelineEntries([
    place({ id: "p-dusk", capturedAt: FILMED.dusk }),
    place({ id: "p-clump", capturedAt: FILMED.clump }),
    place({ id: "p-after", capturedAt: FILMED.after }),
  ]);
  const span = spanOf(entries);
  assert.ok(span);

  const clusters = clusterTicks(entries, span, { widthPx: 360, minGapPx: 12 });
  assert.equal(clusters.length, 3);
  assert.deepEqual(
    clusters.map((cluster) => cluster.entries.length),
    [1, 1, 1],
  );
});

test("a zero-width span puts every tick in one cluster", () => {
  const entries = toTimelineEntries(
    ["p-a", "p-b", "p-c"].map((id) => place({ id, capturedAt: FILMED.clump })),
  );
  const span = spanOf(entries);
  assert.ok(span);

  const clusters = clusterTicks(entries, span, { widthPx: 360, minGapPx: 12 });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].entries.length, 3);
});

test("pacing fills roughly totalMs without breaking either cap", () => {
  const entries = toTimelineEntries(evening());
  const steps = paceEntries(entries, PACING);

  assert.equal(steps.length, entries.length);
  assert.deepEqual(
    steps.map((step) => step.index),
    [0, 1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    steps.map((step) => step.entry.id),
    entries.map((entry) => entry.id),
  );

  const total = steps.reduce((sum, step) => sum + step.holdMs, 0);
  assert.ok(
    Math.abs(total - PACING.totalMs) < 50,
    `run lasts ${total}ms, wanted ${PACING.totalMs}ms`,
  );
  for (const step of steps) {
    assert.ok(
      step.holdMs <= PACING.maxStepMs,
      `${step.entry.id} held ${step.holdMs}ms`,
    );
    assert.ok(
      step.holdMs >= PACING.minStepMs,
      `${step.entry.id} held ${step.holdMs}ms`,
    );
  }

  // The three-hour opening gap is capped; a shared timestamp gets the floor.
  assert.equal(steps[0].holdMs, PACING.maxStepMs);
  assert.equal(steps[1].holdMs, PACING.minStepMs);
  // Nothing follows the last capture, so it holds the floor too.
  assert.equal(steps[steps.length - 1].holdMs, PACING.minStepMs);
});

test("captures sharing a timestamp still read as separate arrivals", () => {
  const entries = toTimelineEntries(
    ["p-a", "p-b", "p-c", "p-d"].map((id) =>
      place({ id, capturedAt: FILMED.clump }),
    ),
  );
  const steps = paceEntries(entries, PACING);

  assert.equal(steps.length, 4);
  for (const step of steps) {
    assert.ok(Number.isFinite(step.holdMs));
    assert.ok(step.holdMs >= PACING.minStepMs);
    assert.ok(step.holdMs <= PACING.maxStepMs);
  }
  // An even split of totalMs, then the cap: 3750ms each becomes 3000ms each.
  assert.deepEqual(
    steps.map((step) => step.holdMs),
    [3000, 3000, 3000, 3000],
  );
});

test("the floor wins over totalMs when there are too many captures", () => {
  const entries = toTimelineEntries(evening());
  const steps = paceEntries(entries, { ...PACING, totalMs: 100 });

  assert.deepEqual(
    steps.map((step) => step.holdMs),
    entries.map(() => PACING.minStepMs),
  );
});

test("visibleAt includes whatever sits exactly on the playhead", () => {
  const entries = toTimelineEntries(evening());

  assert.deepEqual(visibleAt(entries, iso(FILMED.dusk) - 1), []);
  assert.deepEqual(
    visibleAt(entries, iso(FILMED.dusk)).map((entry) => entry.id),
    ["p-dusk"],
  );
  assert.deepEqual(
    visibleAt(entries, iso(FILMED.clump)).map((entry) => entry.id),
    ["p-dusk", "p-clump-a", "p-clump-b"],
  );
  assert.deepEqual(
    visibleAt(entries, iso(FILMED.clump) - 1).map((entry) => entry.id),
    ["p-dusk"],
  );
  assert.equal(visibleAt(entries, iso(FILMED.after)).length, entries.length);
  assert.equal(visibleAt(entries, Date.now() + 1).length, entries.length);
});
