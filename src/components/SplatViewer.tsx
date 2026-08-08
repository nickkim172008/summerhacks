"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import type { AudioPin } from "@/lib/types";

export interface SplatViewerProps {
  splatUrl: string;
  pins: AudioPin[];
  placementMode: boolean;
  onPlacePoint: (point: { x: number; y: number; z: number }) => void;
  onPinClick?: (pinId: string) => void;
  onCameraFrame?: (camera: THREE.PerspectiveCamera) => void;
  activePinIds?: string[];
}

const FALLBACK_PLACE_DISTANCE = 3;
const FLOOR_NORMAL = new THREE.Vector3(0, 1, 0);

export default function SplatViewer({
  splatUrl,
  pins,
  placementMode,
  onPlacePoint,
  onPinClick,
  onCameraFrame,
  activePinIds = [],
}: SplatViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pinGroupRef = useRef<THREE.Group | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const [sceneRadius, setSceneRadius] = useState(1);

  // Latest-value refs so the animation loop and listeners never close over stale props.
  const placementModeRef = useRef(placementMode);
  const onPlacePointRef = useRef(onPlacePoint);
  const onPinClickRef = useRef(onPinClick);
  const onCameraFrameRef = useRef(onCameraFrame);
  useEffect(() => {
    placementModeRef.current = placementMode;
    onPlacePointRef.current = onPlacePoint;
    onPinClickRef.current = onPinClick;
    onCameraFrameRef.current = onCameraFrame;
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

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 1, 0);

    const splat = new SplatMesh({
      url: splatUrl,
      onLoad: (mesh) => {
        // Captures arrive at arbitrary scale and centering, so frame the camera
        // and drop the pin-placement proxy at the scene's floor.
        const box = mesh.getBoundingBox(true).applyMatrix4(mesh.matrixWorld);
        if (box.isEmpty()) return;
        const center = box.getCenter(new THREE.Vector3());
        const radius = box.getSize(new THREE.Vector3()).length() / 2;

        controls.target.copy(center);
        camera.position.copy(center).add(new THREE.Vector3(0, radius * 0.3, radius * 2));
        camera.near = Math.max(radius / 1000, 0.001);
        camera.far = radius * 100;
        camera.updateProjectionMatrix();
        controls.update();

        floorPlane.set(FLOOR_NORMAL, -box.min.y);
        bounds = { box, center, radius };
        setSceneRadius(radius);
      },
    });
    // Splat captures (SPZ/PLY) come in Y-down relative to three.js convention.
    splat.quaternion.set(1, 0, 0, 0);
    splat.updateMatrixWorld(true);
    scene.add(splat);

    // Raycasting directly against splat point data is unreliable (rays catch stray
    // floating particles), so pins land on this infinite floor plane instead. A
    // finite proxy mesh would be missed entirely at shallow viewing angles.
    const floorPlane = new THREE.Plane(FLOOR_NORMAL, 0);
    let bounds: {
      box: THREE.Box3;
      center: THREE.Vector3;
      radius: number;
    } | null = null;

    const pinGroup = new THREE.Group();
    scene.add(pinGroup);
    pinGroupRef.current = pinGroup;

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
        const hit = raycaster.intersectObjects(pinGroup.children, false)[0];
        const pinId = hit?.object.userData.pinId;
        if (pinId) onPinClickRef.current?.(pinId);
        return;
      }

      const point = new THREE.Vector3();
      const hitFloor = raycaster.ray.intersectPlane(floorPlane, point);

      // A ray angled above the horizon never meets the floor, and one that grazes
      // it lands absurdly far away — both cases fall back to a point in front of
      // the camera so the pin still lands somewhere inside the place.
      const tooFar =
        bounds && point.distanceTo(bounds.center) > bounds.radius * 3;
      if (!hitFloor || tooFar) {
        raycaster.ray.at(bounds ? bounds.radius : FALLBACK_PLACE_DISTANCE, point);
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
      (window as unknown as Record<string, unknown>).__dbg = { scene, camera, renderer, splat, controls };
    }

    renderer.setAnimationLoop(() => {
      controls.update();
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
      pinGroupRef.current = null;
      cameraRef.current = null;
    };
  }, [splatUrl]);

  useEffect(() => {
    const pinGroup = pinGroupRef.current;
    if (!pinGroup) return;

    for (const child of [...pinGroup.children]) {
      pinGroup.remove(child);
      const marker = child as THREE.Mesh;
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
    }

    for (const pin of pins) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(sceneRadius * 0.03, 16, 12),
        new THREE.MeshBasicMaterial({
          color: activePinIds.includes(pin.id) ? 0xffd166 : 0x4cc9f0,
          transparent: true,
          opacity: 0.9,
        }),
      );
      marker.position.set(pin.x, pin.y, pin.z);
      marker.userData.pinId = pin.id;
      pinGroup.add(marker);
    }
  }, [pins, activePinIds, sceneRadius]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ cursor: placementMode ? "crosshair" : "grab" }}
    />
  );
}
