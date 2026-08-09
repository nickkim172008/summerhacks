"use client";

import { useEffect, useId, useRef, useState } from "react";
import * as pc from "playcanvas";
import { storedAssetUrl } from "@/lib/assetUrl";
import type { SplatViewerProps } from "@/components/splatViewerTypes";
import SplatLoadError from "@/components/SplatLoadError";

/**
 * The PlayCanvas renderer — the engine SuperSplat is built on, and the reason
 * a place here now looks like a place there.
 *
 * PlayCanvas cannot read SPZ on its own: the engine ships parsers for PLY, SOG
 * and its octree format and nothing else, so @spz-loader decodes our stored SPZ
 * into a GSplat resource. Keeping SPZ is what lets every capture already in
 * Storage carry over untouched; SOG is the engine's preferred runtime format
 * and the migration to make later, not a precondition for rendering.
 */

/**
 * SPZ stores a capture Y-down relative to PlayCanvas's Y-up world, so every
 * splat arrives upside down. Spark corrected the same thing with a 180° turn
 * about X on its mesh.
 */
const UPRIGHT_X_DEGREES = 180;

/** Matches the framing Spark used, so the swap does not change how wide a room reads. */
const FOV_DEGREES = 60;

/** How fast a drag turns the view, in radians per pixel. */
const LOOK_SPEED = 0.005;
/** Just under a right angle: level with the ceiling, never through it. */
const PITCH_LIMIT = Math.PI / 2 - 0.02;

export default function PlayCanvasSplatViewer({
  splatUrl,
  entryPoint,
  onReady,
}: SplatViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Each viewer needs a canvas id of its own: PlayCanvas registers every app
  // under `_applications[canvas.id]`, and @spz-loader looks the app back up by
  // that id. Sharing one would hand a decoded splat to whichever viewer mounted
  // last — which, in a scrolling feed, is routinely not the one that asked.
  const canvasId = `splat-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  // Latest-value refs so the load callbacks never close over stale props.
  const entryPointRef = useRef(entryPoint);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    entryPointRef.current = entryPoint;
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    setLoadError(null);

    const canvas = document.createElement("canvas");
    canvas.id = canvasId;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);

    const app = new pc.Application(canvas, {
      graphicsDeviceOptions: { antialias: false, alpha: false },
    });
    app.setCanvasFillMode(pc.FILLMODE_NONE);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);

    const camera = new pc.Entity("camera");
    camera.addComponent("camera", {
      clearColor: new pc.Color(0, 0, 0, 1),
      fov: FOV_DEGREES,
      nearClip: 0.01,
      farClip: 1000,
    });
    app.root.addChild(camera);
    app.start();

    // Where the view turns about, and how far back it sits. Distance 0 means
    // pivot and eye coincide: standing in a room and looking around, rather
    // than orbiting it from outside. Same rule PivotControls followed.
    const pivot = new pc.Vec3(0, 0, 0);
    let yaw = 0;
    let pitch = 0;
    let distance = 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    function place() {
      const q = new pc.Quat().setFromEulerAngles(pitch, yaw, 0);
      const offset = q.transformVector(new pc.Vec3(0, 0, distance));
      camera.setPosition(
        pivot.x + offset.x,
        pivot.y + offset.y,
        pivot.z + offset.z,
      );
      camera.setEulerAngles(pitch, yaw, 0);
    }
    place();

    function onPointerDown(event: PointerEvent) {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    }
    function onPointerMove(event: PointerEvent) {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      // Degrees, because that is what setEulerAngles reads.
      yaw -= dx * LOOK_SPEED * (180 / Math.PI);
      pitch -= dy * LOOK_SPEED * (180 / Math.PI);
      const limit = PITCH_LIMIT * (180 / Math.PI);
      pitch = Math.max(-limit, Math.min(limit, pitch));
      place();
    }
    function onPointerUp(event: PointerEvent) {
      dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    }
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    const resizeObserver = new ResizeObserver(() => {
      if (disposed) return;
      app.resizeCanvas(container.clientWidth, container.clientHeight);
    });
    resizeObserver.observe(container);

    // The one fact that separates "this record predates Firebase storage" from
    // "Storage refused the read", and it is invisible without saying it out loud.
    const resolvedUrl = new URL(storedAssetUrl(splatUrl), window.location.href)
      .href;
    console.info("[splat] loading", resolvedUrl);

    let splat: pc.Entity | null = null;

    async function load() {
      // Imported here rather than at module scope so the SPZ decoder's wasm is
      // only fetched by a page that actually shows a capture.
      const [{ loadSpz }, { gaussianCloudToResource }] = await Promise.all([
        import("@spz-loader/core"),
        import("@/lib/spzGSplat"),
      ]);
      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(`Could not read this place (${response.status})`);
      }
      const buffer = await response.arrayBuffer();
      if (disposed) return;

      const cloud = await loadSpz(new Uint8Array(buffer), {
        colorScaleFactor: 1,
      });
      // The app can be torn down while the decoder is still working, and
      // touching a destroyed graphics device throws rather than no-opping.
      if (disposed) return;

      const resource = gaussianCloudToResource(cloud, app.graphicsDevice);
      const entity = new pc.Entity("place");
      entity.addComponent("gsplat");
      entity.setLocalEulerAngles(UPRIGHT_X_DEGREES, 0, 0);
      // Added before the resource is handed over: the component only builds its
      // instance if it is enabled, and it is not until it is in the hierarchy.
      app.root.addChild(entity);
      if (entity.gsplat) entity.gsplat.resource = resource;
      splat = entity;

      frame(entity);
      // A frame has to have been drawn before a poster fades off it, or the
      // fade reveals an empty canvas.
      app.once("frameend", () => {
        if (!disposed) onReadyRef.current?.();
      });
    }

    /**
     * Where to stand. An authored entry point names the pivot outright: it is
     * the thing the camera was pointed at, however far back the author stood.
     * Otherwise the middle of the capture, which is what SuperSplat uses too —
     * its focal point is the splat's bound centre.
     */
    function frame(entity: pc.Entity) {
      const entry = entryPointRef.current;
      if (entry) {
        pivot.set(entry.target.x, entry.target.y, entry.target.z);
        const dx = entry.target.x - entry.position.x;
        const dy = entry.target.y - entry.position.y;
        const dz = entry.target.z - entry.position.z;
        distance = Math.hypot(dx, dy, dz);
        yaw = Math.atan2(-dx, -dz) * (180 / Math.PI);
        const flat = Math.hypot(dx, dz);
        pitch = Math.atan2(dy, flat) * (180 / Math.PI);
        place();
        return;
      }

      const aabb = entity.gsplat?.instance?.meshInstance?.aabb;
      if (!aabb) return;
      pivot.copy(aabb.center);
      distance = 0;
      yaw = 0;
      pitch = 0;
      place();

      const radius = aabb.halfExtents.length();
      if (camera.camera && radius > 0) {
        camera.camera.nearClip = Math.max(radius / 1000, 0.001);
        camera.camera.farClip = radius * 100;
      }
    }

    void load().catch((error: unknown) => {
      console.error("[splat] failed", resolvedUrl, error);
      if (disposed) return;
      setLoadError(
        error instanceof Error && error.message
          ? error.message
          : "This place could not be loaded.",
      );
    });

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      splat?.destroy();
      // Takes the graphics device and the render loop with it. The feed mounts
      // and unmounts these constantly, and a leaked context is a hard cap on
      // how far anyone can scroll.
      app.destroy();
      canvas.remove();
    };
  }, [splatUrl, canvasId]);

  if (loadError) {
    return <SplatLoadError splatUrl={splatUrl} loadError={loadError} />;
  }

  // touch-none: with no pinch of our own to handle, an unclaimed one falls
  // through to the browser and zooms the page over the canvas. Dragging would
  // scroll the page behind it for the same reason.
  return (
    <div ref={containerRef} className="h-full w-full cursor-grab touch-none" />
  );
}
