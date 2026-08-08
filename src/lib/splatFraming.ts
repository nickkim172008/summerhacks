import * as THREE from "three";
import type { SplatMesh } from "@sparkjsdev/spark";

/**
 * Works out where to stand when a capture opens.
 *
 * A walkthrough is a place you are inside of, so the opening shot should be the
 * middle of the room at standing height — not the whole reconstruction held at
 * arm's length, which is what framing the bounding box gives you. KIRI returns
 * geometry and nothing else: no camera track, no metric scale, no floor plane, so
 * everything here is derived from the splat centers themselves.
 *
 * The bounding box is no use for that on its own. Reconstruction scatters
 * floaters — haze over a window, a smear of sky — hundreds of units from anything
 * real, and one of them alone doubles the box and drags its center off. Every
 * measurement below is a percentile rather than a min or a max for that reason.
 *
 * Note this always frames a capture from the inside. Nothing in the geometry
 * distinguishes a room from an object: a 3DGS object is a hollow shell of splats
 * and so is a room, both empty in the middle, and which side you belong on is a
 * fact about how it was filmed rather than about the splats. A capture that wants
 * to open from outside says so with an explicit `entryPoint`.
 */

/**
 * The middle is the midpoint of the trimmed extent rather than the median of the
 * splats. The median tracks where the mass is, so a wall you filmed up close
 * drags it off the middle of the space — and once the camera turns about itself,
 * any such error is visible as a capture that pivots off its own centre.
 */

/** Splats sampled per capture: enough for a stable percentile, cheap to sort. */
const MAX_SAMPLES = 150_000;
/** Below this, a splat is reconstruction haze rather than a real surface. */
const MIN_OPACITY = 0.15;
/** Fraction ignored at each end of each axis. Floaters live out there. */
const TRIM = 0.02;
/** Fewer usable samples than this and none of the percentiles mean anything. */
const MIN_SAMPLES = 32;

export interface Framing {
  /** Extent of the capture with floaters trimmed off. */
  box: THREE.Box3;
  /** Where the camera goes, and what it turns about: the middle of the place. */
  center: THREE.Vector3;
  radius: number;
  floorY: number;
  /** Unit direction the camera looks from `center`. */
  forward: THREE.Vector3;
}

function percentile(sorted: Float32Array, q: number) {
  const index = Math.round(q * (sorted.length - 1));
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))];
}

export function frameCapture(mesh: SplatMesh): Framing | null {
  const total = mesh.splats?.getNumSplats() ?? 0;
  if (total === 0) return null;

  // onLoad can land before the render loop has refreshed the world matrix, and
  // that matrix carries the Y-flip putting the capture the right way up.
  mesh.updateMatrixWorld(true);
  const toWorld = mesh.matrixWorld;

  // One pass, decimated to a fixed budget, so a two-million-splat capture costs
  // what a two-hundred-thousand-splat one does.
  const stride = Math.ceil(total / MAX_SAMPLES);
  const capacity = Math.ceil(total / stride);
  const xs = new Float32Array(capacity);
  const ys = new Float32Array(capacity);
  const zs = new Float32Array(capacity);
  let count = 0;

  const world = new THREE.Vector3();
  mesh.forEachSplat((index, center, _scales, _quaternion, opacity) => {
    if (index % stride !== 0 || opacity < MIN_OPACITY || count === capacity) {
      return;
    }
    world.copy(center).applyMatrix4(toWorld);
    // A non-finite center would sort to the end and poison every percentile.
    if (
      !Number.isFinite(world.x) ||
      !Number.isFinite(world.y) ||
      !Number.isFinite(world.z)
    ) {
      return;
    }
    xs[count] = world.x;
    ys[count] = world.y;
    zs[count] = world.z;
    count += 1;
  });
  if (count < MIN_SAMPLES) return null;

  const sortedX = xs.slice(0, count).sort();
  const sortedY = ys.slice(0, count).sort();
  const sortedZ = zs.slice(0, count).sort();

  const box = new THREE.Box3(
    new THREE.Vector3(
      percentile(sortedX, TRIM),
      percentile(sortedY, TRIM),
      percentile(sortedZ, TRIM),
    ),
    new THREE.Vector3(
      percentile(sortedX, 1 - TRIM),
      percentile(sortedY, 1 - TRIM),
      percentile(sortedZ, 1 - TRIM),
    ),
  );
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = size.length() / 2;

  // Face down the longer horizontal axis: that is the view with the most depth
  // in it, rather than a wall up close. Standing dead centre the two ends are
  // equidistant, so the sign is arbitrary and +axis is as good as any.
  const forward =
    size.x >= size.z
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 0, 1);

  return { box, center, radius, floorY: box.min.y, forward };
}
