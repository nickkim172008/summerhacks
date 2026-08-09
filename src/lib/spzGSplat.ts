import * as pc from "playcanvas";
import type { GaussianCloud } from "@spz-loader/core";

/**
 * Turns a decoded SPZ into something PlayCanvas can draw.
 *
 * PlayCanvas reads PLY, SOG and its own octree format, and nothing else — so a
 * capture of ours has to be handed over as PLY-shaped data rather than as a
 * file. `@spz-loader/playcanvas` does own a converter, but it finishes by
 * calling `GSplatResource.instantiate()`, which engine 2.x no longer has: the
 * call returns undefined and the entity never exists. This is that conversion
 * against the current API, which also means only the wasm decoder in
 * `@spz-loader/core` is needed rather than the PlayCanvas binding on top of it.
 *
 * The arithmetic is PLY's conventions, undoing what SPZ stores decoded:
 * log-space scale, pre-sigmoid opacity, and colour as an offset from mid grey.
 */

/** PLY keeps opacity pre-sigmoid; SPZ hands back the value after it. */
function logit(alpha: number) {
  return Math.log(alpha / (1 - alpha));
}

export function gaussianCloudToResource(
  cloud: GaussianCloud,
  device: pc.GraphicsDevice,
): pc.GSplatResource {
  const count = cloud.numPoints;
  const column = () => new Float32Array(count);

  const x = column();
  const y = column();
  const z = column();
  const dcR = column();
  const dcG = column();
  const dcB = column();
  const opacity = column();
  const scale0 = column();
  const scale1 = column();
  const scale2 = column();
  const rot0 = column();
  const rot1 = column();
  const rot2 = column();
  const rot3 = column();

  for (let i = 0; i < count; i++) {
    const p = i * 3;
    const q = i * 4;

    x[i] = cloud.positions[p];
    y[i] = cloud.positions[p + 1];
    z[i] = cloud.positions[p + 2];

    // SPZ colours sit either side of mid grey; PLY's DC term is the offset.
    dcR[i] = cloud.colors[p] - 0.5;
    dcG[i] = cloud.colors[p + 1] - 0.5;
    dcB[i] = cloud.colors[p + 2] - 0.5;

    opacity[i] = logit(cloud.alphas[i]);

    scale0[i] = Math.log(cloud.scales[p]);
    scale1[i] = Math.log(cloud.scales[p + 1]);
    scale2[i] = Math.log(cloud.scales[p + 2]);

    // SPZ stores (w, x, y, z); PLY wants (x, y, z, w) — and the sign flip on
    // the first two axes is the handedness change between the two.
    rot0[i] = -cloud.rotations[q + 1];
    rot1[i] = -cloud.rotations[q + 2];
    rot2[i] = cloud.rotations[q + 3];
    rot3[i] = cloud.rotations[q];
  }

  const float = (name: string, storage: Float32Array) => ({
    name,
    type: "float",
    byteSize: Float32Array.BYTES_PER_ELEMENT,
    storage,
  });

  const data = new pc.GSplatData([
    {
      name: "vertex",
      count,
      properties: [
        float("x", x),
        float("y", y),
        float("z", z),
        float("f_dc_0", dcR),
        float("f_dc_1", dcG),
        float("f_dc_2", dcB),
        float("opacity", opacity),
        float("scale_0", scale0),
        float("scale_1", scale1),
        float("scale_2", scale2),
        float("rot_0", rot0),
        float("rot_1", rot1),
        float("rot_2", rot2),
        float("rot_3", rot3),
      ],
    },
  ] as unknown as ConstructorParameters<typeof pc.GSplatData>[0]);

  return new pc.GSplatResource(device, data);
}
