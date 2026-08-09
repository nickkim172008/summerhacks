import assert from "node:assert/strict";
import test from "node:test";

// A .mts file cannot statically import a .ts one under this tsconfig: the
// extension fails tsc and the .js rewrite fails Node. The computed specifier
// satisfies both, and is the pattern captureTimeline.test.mts already uses.
const modulePath = new URL("../src/lib/tourHop.ts", import.meta.url).href;
const { distanceKm, fitZoom, planHop, NEIGHBOUR_KM } = (await import(
  modulePath
)) as typeof import("@/lib/tourHop");

const VIEW = { width: 1200, height: 800 };
const CLOSE = 18;

// The three real spots in the library, 9.72 km end to end.
const HIGH_PARK = { lat: 43.6465, lng: -79.4637 };
const DOWNTOWN = { lat: 43.6486, lng: -79.3802 };
const NEXT_DOOR = { lat: 43.6487, lng: -79.3803 };

test("measures the real spread of the library", () => {
  const km = distanceKm(HIGH_PARK, DOWNTOWN);
  assert.ok(km > 6 && km < 8, `expected roughly 7 km, got ${km}`);
});

test("two captures in the same building are neighbours", () => {
  assert.ok(distanceKm(DOWNTOWN, NEXT_DOOR) < NEIGHBOUR_KM);
});

test("a neighbour hop is one pan, with no pull-back stage", () => {
  const plan = planHop(DOWNTOWN, NEXT_DOOR, {
    closeZoom: CLOSE,
    viewport: VIEW,
  });
  assert.equal(plan.stages.length, 1);
  assert.equal(plan.stages[0].zoom, CLOSE);
});

test("a cross-town hop pulls back first, then arrives", () => {
  const plan = planHop(HIGH_PARK, DOWNTOWN, {
    closeZoom: CLOSE,
    viewport: VIEW,
  });
  assert.equal(plan.stages.length, 2);
  assert.ok(
    plan.stages[0].zoom < CLOSE - 1,
    `expected a real pull-back, got ${plan.stages[0].zoom}`,
  );
  assert.equal(plan.stages[1].zoom, CLOSE);
  // It pulls back over the ground between them, not over either end.
  assert.ok(plan.stages[0].lng > HIGH_PARK.lng);
  assert.ok(plan.stages[0].lng < DOWNTOWN.lng);
});

test("the pull-back is proportional: further apart, further out", () => {
  const near = planHop(
    HIGH_PARK,
    { lat: 43.6465, lng: -79.44 },
    { closeZoom: CLOSE, viewport: VIEW },
  );
  const far = planHop(
    HIGH_PARK,
    { lat: 45.5019, lng: -73.5674 },
    { closeZoom: CLOSE, viewport: VIEW },
  );
  assert.ok(
    far.outZoom < near.outZoom,
    `Montreal (${far.outZoom}) should pull back further than across town (${near.outZoom})`,
  );
});

test("even a continent away it stops short of the whole globe", () => {
  const plan = planHop(
    { lat: 43.65, lng: -79.38 },
    { lat: -33.8688, lng: 151.2093 },
    { closeZoom: CLOSE, viewport: VIEW },
  );
  assert.ok(plan.outZoom >= 3, `got ${plan.outZoom}`);
});

test("identical coordinates do not divide by zero", () => {
  assert.equal(fitZoom(DOWNTOWN, DOWNTOWN, VIEW), Infinity);
  const plan = planHop(DOWNTOWN, { ...DOWNTOWN }, {
    closeZoom: CLOSE,
    viewport: VIEW,
  });
  assert.equal(plan.stages.length, 1);
  assert.equal(plan.distanceKm, 0);
});

test("a capture with no coordinates yields no flight to make", () => {
  assert.deepEqual(
    planHop(null, DOWNTOWN, { closeZoom: CLOSE, viewport: VIEW }).stages,
    [],
  );
  assert.deepEqual(
    planHop(DOWNTOWN, null, { closeZoom: CLOSE, viewport: VIEW }).stages,
    [],
  );
});
