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

/**
 * Evaluation only, and off unless NEXT_PUBLIC_DEV_FREE_LOOK is set.
 *
 * A capture is deliberately something you stand inside and turn around in —
 * pivotControls.ts sets out why at length, and it comes down to a KIRI
 * reconstruction reading as an object rather than a place the moment you back
 * out of it: the floaters show, the ceiling is missing, the walls thin at the
 * edges. Nothing here changes that for anyone visiting the app.
 *
 * It exists because that finding was made against one reconstruction backend. A
 * Marble world ships a collider mesh and claims to be walkable, and there is no
 * way to judge the claim in a viewer that cannot move. So: a way to try, behind
 * a flag, kept out of the product until the answer is in.
 */
const FREE_LOOK = process.env.NEXT_PUBLIC_DEV_FREE_LOOK === "true";

/** Scene radii per second while a key is held — captures arrive at any scale. */
const MOVE_SPEED = 0.5;

/** Strafe, rise and forward, in that order. A/D stay unbound: they turn. */
const MOVE_KEYS: Record<string, readonly [number, number, number]> = {
  KeyW: [0, 0, 1],
  KeyS: [0, 0, -1],
  KeyQ: [-1, 0, 0],
  KeyE: [1, 0, 0],
  Space: [0, 1, 0],
  ShiftLeft: [0, -1, 0],
  ShiftRight: [0, -1, 0],
};

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
    /** Set once the splat's bounds are known; scales how fast a key moves. */
    let sceneRadius = 0;

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

    // Everything from here to the matching cleanup is the evaluation path, and
    // never runs with the flag off.
    const held = new Set<string>();

    function onKeyDown(event: KeyboardEvent) {
      if (!(event.code in MOVE_KEYS)) return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      event.preventDefault(); // Space would scroll the page behind the canvas.
      held.add(event.code);
    }
    function onKeyUp(event: KeyboardEvent) {
      held.delete(event.code);
    }
    /** A key still down when the tab loses focus never reports its keyup. */
    function onBlur() {
      held.clear();
    }

    function step(dt: number) {
      if (held.size === 0 || sceneRadius <= 0) return;

      let strafe = 0;
      let rise = 0;
      let forward = 0;
      for (const code of held) {
        const move = MOVE_KEYS[code];
        if (!move) continue;
        strafe += move[0];
        rise += move[1];
        forward += move[2];
      }
      if (!strafe && !rise && !forward) return;

      // Along the heading the camera actually has, pitch included — flying
      // rather than walking, because the point is to reach anywhere in the
      // scene and look back at it, not to simulate a person.
      const q = new pc.Quat().setFromEulerAngles(pitch, yaw, 0);
      const ahead = q.transformVector(new pc.Vec3(0, 0, -1));
      const right = q.transformVector(new pc.Vec3(1, 0, 0));
      const speed = sceneRadius * MOVE_SPEED * dt;

      pivot.x += (ahead.x * forward + right.x * strafe) * speed;
      pivot.y += (ahead.y * forward + right.y * strafe + rise) * speed;
      pivot.z += (ahead.z * forward + right.z * strafe) * speed;
      place();
    }

    if (FREE_LOOK) {
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      window.addEventListener("blur", onBlur);
      app.on("update", step);
    }

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
      // Read before the entry-point branch returns: it is what scales movement
      // speed, and a capture opened from an authored entry point still has to
      // be walkable under the evaluation flag.
      const bounds = entity.gsplat?.instance?.meshInstance?.aabb;
      if (bounds) sceneRadius = bounds.halfExtents.length();

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
      sceneRadius = radius;
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
      if (FREE_LOOK) {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("blur", onBlur);
        // The feed mounts and unmounts these constantly; a listener left on the
        // window would go on moving a pivot whose app is already destroyed.
        app.off("update", step);
      }
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
