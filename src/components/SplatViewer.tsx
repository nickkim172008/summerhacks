"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { PivotControls } from "@/lib/pivotControls";
import { frameCapture } from "@/lib/splatFraming";
import { storedAssetUrl } from "@/lib/assetUrl";
import type { EntryPoint } from "@/lib/types";

export interface SplatViewerProps {
  splatUrl: string;
  entryPoint?: EntryPoint;
}

export default function SplatViewer({
  splatUrl,
  entryPoint,
}: SplatViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // A latest-value ref so the load callback never closes over a stale prop.
  const entryPointRef = useRef(entryPoint);
  useEffect(() => {
    entryPointRef.current = entryPoint;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let mounted = true;
    setLoadError(null);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.01,
      1000,
    );
    camera.position.set(0, 1.2, 3);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const spark = new SparkRenderer({ renderer });
    scene.add(spark);

    const controls = new PivotControls(camera, renderer.domElement);

    // Spark decodes in a worker created from a blob: URL, whose own location is
    // that blob rather than the page. A root-relative splatUrl resolves against
    // it into something unreachable, and the failure arrives as an uncaught
    // "Failed to fetch" — a black canvas with nothing said. Absolute from here
    // means a missing file at least fails as the 404 it is.
    const resolvedUrl = new URL(storedAssetUrl(splatUrl), window.location.href)
      .href;
    // The one fact that separates "this record predates Firebase storage" from
    // "Storage refused the read", and it is invisible without saying it out loud.
    console.info("[splat] loading", resolvedUrl);
    const splat = new SplatMesh({
      url: resolvedUrl,
      onLoad: (mesh) => {
        // Captures arrive at arbitrary scale and centering, so work out where the
        // place actually is before standing the camera in it and setting the
        // floor that placed points land on.
        const framing = frameCapture(mesh);
        if (!framing) return;
        const { center, radius } = framing;

        const entry = entryPointRef.current;
        if (entry) {
          // An authored entry point names the pivot outright: it is the thing
          // the camera was pointed at, however far back the author stood.
          const toTarget = new THREE.Vector3().subVectors(
            entry.target,
            entry.position,
          );
          controls.setPivot(
            new THREE.Vector3().copy(entry.target),
            toTarget,
            toTarget.length(),
          );
        } else {
          controls.setPivot(center, framing.forward, 0);
        }
        controls.setBounds(framing.box, radius);
        camera.near = Math.max(radius / 1000, 0.001);
        camera.far = radius * 100;
        camera.updateProjectionMatrix();
      },
    });
    // Splat captures (SPZ/PLY) come in Y-down relative to three.js convention.
    splat.quaternion.set(1, 0, 0, 0);
    splat.updateMatrixWorld(true);
    scene.add(splat);

    // The only handle on a load that never arrives: SplatMesh takes no onError.
    void splat.initialized.catch((error: unknown) => {
      console.error("[splat] failed", resolvedUrl, error);
      if (!mounted) return;
      setLoadError(
        error instanceof Error && error.message
          ? error.message
          : "This place could not be loaded.",
      );
    });

    const resizeObserver = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = container;
      if (!clientWidth || !clientHeight) return;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight);
    });
    resizeObserver.observe(container);

    if (process.env.NODE_ENV === "development") {
      (window as unknown as Record<string, unknown>).__dbg = {
        scene,
        camera,
        renderer,
        splat,
        controls,
      };
    }

    let lastFrame = performance.now();
    renderer.setAnimationLoop((time) => {
      const deltaTime = (time - lastFrame) / 1000;
      lastFrame = time;
      controls.update(deltaTime);
      renderer.render(scene, camera);
    });

    return () => {
      mounted = false;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      controls.dispose();
      splat.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      cameraRef.current = null;
    };
  }, [splatUrl]);

  if (loadError) {
    // A relative url means the record predates Firebase storage and its bytes
    // were only ever on one machine. An absolute one that will not load is a
    // live file the browser was refused — almost always the bucket's CORS,
    // since a missing object answers 404 rather than failing outright.
    const onDisk = !/^https?:/i.test(splatUrl);
    return (
      // Dark chrome, so the viewer's white-alpha scale rather than the ink
      // scale the rest of the app is on.
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#0A0B0D] px-6 text-center">
        <p className="text-[15px] font-medium text-white">
          {onDisk
            ? "This place's file is missing."
            : "This place could not be loaded."}
        </p>
        <p className="max-w-sm text-[15px] leading-6 text-[rgba(255,255,255,0.6)]">
          {onDisk
            ? "Its splat was saved to a machine rather than to storage, so the bytes are not here. Capturing it again is the only way back."
            : "The file is in storage, but the browser was refused it. The bucket most likely has no CORS rule; see cors.json in the repo. Nothing is lost."}
        </p>
        <p className="mt-1 text-[13px] text-[rgba(255,255,255,0.45)]">
          {loadError}
        </p>
        <p className="mt-2 max-w-md break-all text-[11px] text-[rgba(255,255,255,0.32)]">
          {splatUrl}
        </p>
      </div>
    );
  }

    // touch-none: with no pinch of our own to handle, an unclaimed one falls
  // through to the browser and zooms the page over the canvas. Dragging would
  // scroll the page behind it for the same reason.
  return (
    <div ref={containerRef} className="h-full w-full cursor-grab touch-none" />
  );
}
