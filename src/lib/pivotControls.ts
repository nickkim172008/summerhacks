import * as THREE from "three";

/**
 * Turning about a fixed point, from any distance away from it including none.
 *
 * The camera's position is never accumulated, only ever derived:
 *
 *     position = pivot - forward(yaw, pitch) * distance
 *
 * which is what keeps the pivot still. Zooming moves `distance` alone, so the
 * point you turn about is the same before and after — the failure of a
 * controller that walks the camera along its line of sight, where the pivot
 * follows the camera and every zoom re-centres the place you were looking at.
 *
 * At distance zero the camera sits on the pivot and turns in place, so standing
 * in the middle of a capture and orbiting it from further out are the same
 * gesture at two ends of one range, rather than two modes to switch between.
 *
 * Roll is never applied, so the horizon stays level however far you turn.
 */

/** Radians per pixel dragged. A drag of ~360px turns you a quarter turn. */
const ROTATE_SPEED = 0.004;
/** Just shy of straight up/down, where yaw becomes meaningless. */
const PITCH_LIMIT = Math.PI / 2 - 0.01;
/** Fraction of the remaining distance covered per frame at 60fps. */
const SMOOTHING = 0.25;
/** How far out you may pull, as a fraction of the capture radius. */
const ZOOM_OUT_LIMIT = 1;
/** Zoom per wheel notch and per pixel of pinch, as fractions of that radius. */
const WHEEL_STEP = 0.0015;
const PINCH_STEP = 0.004;
/** Held-key rates: fraction of the radius per second, and radians per second. */
const KEY_ZOOM_SPEED = 0.6;
const KEY_TURN_SPEED = 1.5;

/** Negative zooms in, positive out. */
const ZOOM_KEYS: Record<string, number> = {
  KeyW: -1,
  ArrowUp: -1,
  KeyS: 1,
  ArrowDown: 1,
};
/** Positive turns left, matching a drag to the right. */
const TURN_KEYS: Record<string, number> = {
  KeyA: 1,
  ArrowLeft: 1,
  KeyD: -1,
  ArrowRight: -1,
};

/** Typing a caption should not also swing the camera around. */
function typingInAField() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (el as HTMLElement).isContentEditable
  );
}

export class PivotControls {
  /** Set false to hand the pointer to something else, e.g. a modal. */
  enabled = true;

  private pivot = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private distance = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  private targetDistance = 0;
  private radius = 1;
  private maxDistance = Infinity;
  private box: THREE.Box3 | null = null;
  private pointers = new Map<number, THREE.Vector2>();
  private pinchDistance = 0;
  private held = new Set<string>();
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly forward = new THREE.Vector3();
  private camera: THREE.PerspectiveCamera;
  private domElement: HTMLElement;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.domElement = domElement;
    domElement.addEventListener("pointerdown", this.onPointerDown);
    domElement.addEventListener("pointermove", this.onPointerMove);
    domElement.addEventListener("pointerup", this.onPointerUp);
    domElement.addEventListener("pointercancel", this.onPointerUp);
    domElement.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  /**
   * Turn about `pivot`, looking along `facing`, from `distance` away. A distance
   * of zero stands the camera on the pivot itself.
   */
  setPivot(pivot: THREE.Vector3, facing: THREE.Vector3, distance = 0) {
    this.pivot.copy(pivot);
    // A degenerate direction would give a NaN yaw and lose the camera entirely.
    const dir =
      facing.lengthSq() > 1e-12
        ? facing.clone().normalize()
        : new THREE.Vector3(0, 0, -1);
    this.targetPitch = THREE.MathUtils.clamp(
      Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)),
      -PITCH_LIMIT,
      PITCH_LIMIT,
    );
    this.targetYaw = Math.atan2(-dir.x, -dir.z);
    this.targetDistance = Math.max(distance, 0);
    this.yaw = this.targetYaw;
    this.pitch = this.targetPitch;
    this.distance = this.targetDistance;
    this.apply();
  }

  /**
   * Zoom rate and the limit on pulling back follow the size of the capture, and
   * the camera stays within its extent. An opening shot further out than the
   * limit sets the limit rather than being yanked inside it.
   */
  setBounds(box: THREE.Box3, radius: number) {
    this.box = box;
    this.radius = radius;
    this.maxDistance = Math.max(radius * ZOOM_OUT_LIMIT, this.targetDistance);
  }

  update(deltaTime: number) {
    const dt = Math.min(deltaTime, 0.1);

    let zoom = 0;
    let turn = 0;
    for (const code of this.held) {
      zoom += ZOOM_KEYS[code] ?? 0;
      turn += TURN_KEYS[code] ?? 0;
    }
    if (zoom !== 0) this.zoomBy(zoom * this.radius * KEY_ZOOM_SPEED * dt);
    if (turn !== 0) this.targetYaw += turn * KEY_TURN_SPEED * dt;

    // Frame-rate independent approach to the target.
    const t = 1 - Math.pow(1 - SMOOTHING, dt * 60);
    this.yaw += (this.targetYaw - this.yaw) * t;
    this.pitch += (this.targetPitch - this.pitch) * t;
    this.distance += (this.targetDistance - this.distance) * t;

    this.apply();
  }

  dispose() {
    const el = this.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointercancel", this.onPointerUp);
    el.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.pointers.clear();
    this.held.clear();
  }

  private apply() {
    // YXZ with a zero Z term is what keeps the horizon level.
    this.euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this.euler);

    const cosPitch = Math.cos(this.pitch);
    this.forward.set(
      -Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cosPitch,
    );

    // Stop short of the wall rather than clamping the position to the box:
    // nudging the camera off this line would take the pivot off the centre of
    // the screen, which is the one thing that has to stay true. The requested
    // zoom is kept as it was, so turning back toward open space gives it back.
    const distance = Math.min(this.distance, this.exitDistance());
    this.camera.position
      .copy(this.pivot)
      .addScaledVector(this.forward, -distance);
  }

  /** How far back the camera can go along this heading before leaving the capture. */
  private exitDistance() {
    const box = this.box;
    if (!box || !box.containsPoint(this.pivot)) return Infinity;
    let limit = Infinity;
    for (const axis of ["x", "y", "z"] as const) {
      // The camera travels along -forward as the distance grows.
      const step = -this.forward[axis];
      if (Math.abs(step) < 1e-9) continue;
      limit = Math.min(
        limit,
        Math.max(
          (box.min[axis] - this.pivot[axis]) / step,
          (box.max[axis] - this.pivot[axis]) / step,
        ),
      );
    }
    return Math.max(limit, 0);
  }

  /** Zooming in is unbounded down to the pivot; zooming out stops at the limit. */
  private zoomBy(amount: number) {
    this.targetDistance = THREE.MathUtils.clamp(
      this.targetDistance + amount,
      0,
      this.maxDistance,
    );
  }

  private onPointerDown = (event: PointerEvent) => {
    if (!this.enabled) return;
    this.pointers.set(
      event.pointerId,
      new THREE.Vector2(event.clientX, event.clientY),
    );
    if (event.isPrimary) this.domElement.setPointerCapture?.(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent) => {
    const last = this.pointers.get(event.pointerId);
    if (!this.enabled || !last) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    last.set(event.clientX, event.clientY);

    if (this.pointers.size >= 2) {
      this.pinch();
      return;
    }
    // The scene follows your finger: drag right and you turn left to meet it.
    this.targetYaw += dx * ROTATE_SPEED;
    this.targetPitch = THREE.MathUtils.clamp(
      this.targetPitch + dy * ROTATE_SPEED,
      -PITCH_LIMIT,
      PITCH_LIMIT,
    );
  };

  private onPointerUp = (event: PointerEvent) => {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinchDistance = 0;
    this.domElement.releasePointerCapture?.(event.pointerId);
  };

  /** Two fingers spreading zooms in, the touch equivalent of the wheel. */
  private pinch() {
    const [a, b] = [...this.pointers.values()];
    const spread = a.distanceTo(b);
    if (this.pinchDistance !== 0) {
      this.zoomBy(-(spread - this.pinchDistance) * this.radius * PINCH_STEP);
    }
    this.pinchDistance = spread;
  }

  private onWheel = (event: WheelEvent) => {
    if (!this.enabled) return;
    event.preventDefault();
    this.zoomBy(event.deltaY * this.radius * WHEEL_STEP);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.enabled || typingInAField()) return;
    if (!(event.code in ZOOM_KEYS) && !(event.code in TURN_KEYS)) return;
    event.preventDefault(); // Otherwise the arrow keys scroll the page behind us.
    this.held.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.held.delete(event.code);
  };

  /** A key held while the tab loses focus never reports its keyup. */
  private onBlur = () => {
    this.held.clear();
    this.pointers.clear();
  };
}
