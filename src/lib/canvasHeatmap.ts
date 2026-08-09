import type { HeatPoint } from "./maps";

/**
 * Canvas heatmap via OverlayView — native HeatmapLayer was removed in Maps JS 3.65.
 *
 * Density is binned into cells and normalized against the busiest cell, so a lone
 * point stays cool and only real clusters reach red.
 */
export function createCanvasHeatmap(
  OverlayView: typeof google.maps.OverlayView,
): {
  setMap: (map: google.maps.Map | null) => void;
  setData: (points: HeatPoint[]) => void;
} {
  let points: HeatPoint[] = [];
  let canvas: HTMLCanvasElement | null = null;
  let brush: HTMLCanvasElement | null = null;
  let brushRadius = 0;
  const palette = buildPalette();

  class CanvasHeatmapOverlay extends OverlayView {
    onAdd() {
      canvas = document.createElement("canvas");
      canvas.style.position = "absolute";
      canvas.style.pointerEvents = "none";
      this.getPanes()?.overlayLayer.appendChild(canvas);
    }

    draw() {
      const map = this.getMap() as google.maps.Map | null;
      const projection = this.getProjection();
      if (!map || !projection || !canvas) return;

      const bounds = map.getBounds();
      if (!bounds) return;

      const ne = projection.fromLatLngToDivPixel(bounds.getNorthEast());
      const sw = projection.fromLatLngToDivPixel(bounds.getSouthWest());
      if (!ne || !sw) return;

      const left = Math.min(ne.x, sw.x);
      const top = Math.min(ne.y, sw.y);
      const width = Math.max(1, Math.floor(Math.abs(ne.x - sw.x)));
      const height = Math.max(1, Math.floor(Math.abs(ne.y - sw.y)));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.style.left = `${left}px`;
      canvas.style.top = `${top}px`;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (points.length === 0) return;

      const zoom = map.getZoom() ?? 13;
      const radius = Math.max(26, Math.min(70, 6 + zoom * 3.2));
      if (!brush || brushRadius !== radius) {
        brush = makeBrush(radius);
        brushRadius = radius;
      }

      // Bin nearby points so density — not marker count — drives the colour.
      const cellSize = Math.max(8, radius / 2);
      const cells = new Map<string, { x: number; y: number; value: number }>();
      let maxValue = 0;

      for (const point of points) {
        const pixel = projection.fromLatLngToDivPixel(
          new google.maps.LatLng(point.lat, point.lng),
        );
        if (!pixel) continue;

        const x = pixel.x - left;
        const y = pixel.y - top;
        if (
          x < -radius ||
          y < -radius ||
          x > width + radius ||
          y > height + radius
        ) {
          continue;
        }

        const col = Math.floor(x / cellSize);
        const row = Math.floor(y / cellSize);
        const key = `${col}:${row}`;
        const cell = cells.get(key);
        if (cell) {
          const total = cell.value + point.weight;
          cell.x = (cell.x * cell.value + x * point.weight) / total;
          cell.y = (cell.y * cell.value + y * point.weight) / total;
          cell.value = total;
        } else {
          cells.set(key, { x, y, value: point.weight });
        }
      }

      if (cells.size === 0) return;
      for (const cell of cells.values()) {
        if (cell.value > maxValue) maxValue = cell.value;
      }

      // Floor the divisor so a single isolated capture reads cool, not red.
      const normalizer = Math.max(maxValue, DENSITY_FLOOR);

      ctx.globalCompositeOperation = "source-over";
      for (const cell of cells.values()) {
        // The floor keeps a lone capture from vanishing, but a point the
        // timeline is fading in has to be able to start at nothing, so the
        // floor scales with weight below one. At full weight it is unchanged.
        const floor = MIN_ALPHA * Math.min(1, cell.value);
        ctx.globalAlpha = clamp(cell.value / normalizer, floor, 1);
        ctx.drawImage(brush, cell.x - radius, cell.y - radius);
      }
      ctx.globalAlpha = 1;

      // Accumulated alpha is the intensity field — recolour it through the ramp.
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = image.data;
      for (let i = 0; i < data.length; i += 4) {
        const raw = data[i + 3]!;
        if (raw === 0) continue;

        const intensity = raw / 255;
        // Lift the ramp so mid densities land on cyan/green instead of deep blue.
        const shade = Math.min(255, Math.round(intensity ** COLOR_GAMMA * 255));
        const offset = shade * 4;
        data[i] = palette[offset]!;
        data[i + 1] = palette[offset + 1]!;
        data[i + 2] = palette[offset + 2]!;
        // Faint tails stay soft, but sparse areas are still clearly visible.
        data[i + 3] = Math.round(
          255 * Math.min(LAYER_OPACITY, intensity ** ALPHA_GAMMA * 0.95),
        );
      }
      ctx.putImageData(image, 0, 0);
    }

    onRemove() {
      canvas?.remove();
      canvas = null;
    }
  }

  const overlay = new CanvasHeatmapOverlay();

  return {
    setMap(map) {
      overlay.setMap(map);
    },
    setData(next) {
      points = next;
      overlay.draw();
    },
  };
}

/** Cell weight that counts as "fully hot" when nothing busier is on screen. */
const DENSITY_FLOOR = 2;
/** A lone spot should still read mid-ramp rather than disappear into blue. */
const MIN_ALPHA = 0.36;
const LAYER_OPACITY = 0.8;
const COLOR_GAMMA = 0.7;
const ALPHA_GAMMA = 0.78;

/** Soft-edged dot; alpha falls off toward the rim so blobs merge smoothly. */
function makeBrush(radius: number) {
  const size = Math.ceil(radius * 2);
  const brush = document.createElement("canvas");
  brush.width = size;
  brush.height = size;

  const ctx = brush.getContext("2d");
  if (!ctx) return brush;

  const gradient = ctx.createRadialGradient(
    radius,
    radius,
    0,
    radius,
    radius,
    radius,
  );
  gradient.addColorStop(0, "rgba(0,0,0,1)");
  gradient.addColorStop(0.35, "rgba(0,0,0,0.6)");
  gradient.addColorStop(0.7, "rgba(0,0,0,0.2)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return brush;
}

/** 256-entry RGB lookup: blue → cyan → green → yellow → red. */
function buildPalette() {
  const ramp = document.createElement("canvas");
  ramp.width = 1;
  ramp.height = 256;

  const ctx = ramp.getContext("2d");
  if (!ctx) return new Uint8ClampedArray(256 * 4);

  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, "#3b4cc0");
  gradient.addColorStop(0.2, "#00a6ff");
  gradient.addColorStop(0.4, "#22d67c");
  gradient.addColorStop(0.6, "#f2e34c");
  gradient.addColorStop(0.8, "#f79337");
  gradient.addColorStop(1, "#e8332a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1, 256);

  return ctx.getImageData(0, 0, 1, 256).data;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
