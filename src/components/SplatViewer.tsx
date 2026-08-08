"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { PivotControls } from "@/lib/pivotControls";
import { frameCapture } from "@/lib/splatFraming";
import type { EntryPoint, Hotspot, Vec3 } from "@/lib/types";

export interface SplatViewerProps {
  splatUrl: string;
  hotspots?: Hotspot[];
  entryPoint?: EntryPoint;
  placementMode: boolean;
  onPlacePoint: (point: Vec3) => void;
  onHotspotClick?: (linksToPlaceId: string) => void;
  onCameraFrame?: (camera: THREE.PerspectiveCamera) => void;
  onSceneReady?: (radius: number) => void;
}

const FALLBACK_PLACE_DISTANCE = 3;
const FLOOR_NORMAL = new THREE.Vector3(0, 1, 0);

function clearGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    const marker = child as THREE.Mesh;
    marker.geometry.dispose();
    (marker.material as THREE.Material).dispose();
  }
}

export default function SplatViewer({
  splatUrl,
  hotspots = [],
  entryPoint,
  placementMode,
  onPlacePoint,
  onHotspotClick,
  onCameraFrame,
  onSceneReady,
}: SplatViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hotspotGroupRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const [sceneRadius, setSceneRadius] = useState(1);

  // Latest-value refs so the animation loop and listeners never close over stale props.
  const placementModeRef = useRef(placementMode);
  const onPlacePointRef = useRef(onPlacePoint);
  const onHotspotClickRef = useRef(onHotspotClick);
  const onCameraFrameRef = useRef(onCameraFrame);
  const onSceneReadyRef = useRef(onSceneReady);
  const entryPointRef = useRef(entryPoint);
  useEffect(() => {
    placementModeRef.current = placementMode;
    onPlacePointRef.current = onPlacePoint;
    onHotspotClickRef.current = onHotspotClick;
    onCameraFrameRef.current = onCameraFrame;
    onSceneReadyRef.current = onSceneReady;
    entryPointRef.current = entryPoint;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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

    const splat = new SplatMesh({
      url: splatUrl,
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

        floorPlane.set(FLOOR_NORMAL, -framing.floorY);
        bounds = { box: framing.box, center, radius };
        setSceneRadius(radius);
        onSceneReadyRef.current?.(radius);
      },
    });
    // Splat captures (SPZ/PLY) come in Y-down relative to three.js convention.
    splat.quaternion.set(1, 0, 0, 0);
    splat.updateMatrixWorld(true);
    scene.add(splat);

    // Raycasting directly against splat point data is unreliable (rays catch stray
    // floating particles), so placed points land on this infinite floor plane
    // instead. A finite proxy mesh would be missed entirely at shallow viewing
    // angles.
    const floorPlane = new THREE.Plane(FLOOR_NORMAL, 0);
    let bounds: {
      box: THREE.Box3;
      center: THREE.Vector3;
      radius: number;
    } | null = null;

    const hotspotGroup = new THREE.Group();
    scene.add(hotspotGroup);
    hotspotGroupRef.current = hotspotGroup;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downPos: { x: number; y: number } | null = null;

    function toPointer(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function handlePointerDown(event: PointerEvent) {
      downPos = { x: event.clientX, y: event.clientY };
    }

    function handlePointerUp(event: PointerEvent) {
      // Ignore clicks that were actually orbit drags.
      if (!downPos) return;
      const dragged =
        Math.hypot(event.clientX - downPos.x, event.clientY - downPos.y) > 5;
      downPos = null;
      if (dragged) return;

      toPointer(event);
      raycaster.setFromCamera(pointer, camera);

      if (!placementModeRef.current) {
        const hit = raycaster.intersectObjects(hotspotGroup.children, false)[0];
        const { linksToPlaceId } = hit?.object.userData ?? {};
        if (linksToPlaceId) onHotspotClickRef.current?.(linksToPlaceId);
        return;
      }

      const point = new THREE.Vector3();
      const hitFloor = raycaster.ray.intersectPlane(floorPlane, point);

      // A ray angled above the horizon never meets the floor, and one that grazes
      // it lands absurdly far away — both cases fall back to a point in front of
      // the camera so the marker still lands somewhere inside the place.
      const tooFar =
        bounds && point.distanceTo(bounds.center) > bounds.radius * 3;
      if (!hitFloor || tooFar) {
        raycaster.ray.at(
          bounds ? bounds.radius : FALLBACK_PLACE_DISTANCE,
          point,
        );
      }
      if (bounds) point.clamp(bounds.box.min, bounds.box.max);

      onPlacePointRef.current({ x: point.x, y: point.y, z: point.z });
    }

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);

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
      onCameraFrameRef.current?.(camera);
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      controls.dispose();
      splat.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      hotspotGroupRef.current = null;
      cameraRef.current = null;
    };
  }, [splatUrl]);

  useEffect(() => {
    const hotspotGroup = hotspotGroupRef.current;
    if (!hotspotGroup) return;
    clearGroup(hotspotGroup);

    for (const hotspot of hotspots) {
      const marker = new THREE.Mesh(
        new THREE.OctahedronGeometry(sceneRadius * 0.05),
        new THREE.MeshBasicMaterial({
          color: 0xb388ff,
          transparent: true,
          opacity: 0.85,
        }),
      );
      marker.position.set(hotspot.x, hotspot.y, hotspot.z);
      marker.userData.linksToPlaceId = hotspot.linksToPlaceId;
      hotspotGroup.add(marker);
    }
  }, [hotspots, sceneRadius]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ cursor: placementMode ? "crosshair" : "grab" }}
    />
  );
}
