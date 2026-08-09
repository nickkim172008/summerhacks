import * as THREE from "three";

/**
 * Turning about a fixed point, from any distance away from it including none.
 *
 * The camera's position is never accumulated, only ever derived:
 *
 *     position = pivot - forward(yaw, pitch) * distance
 *
 * which is what keeps the pivot still. A capture opens at distance zero, so the
 * camera stands on the pivot and turns in place.
 *
 * `distance` is fixed once set. Nothing the visitor does changes it: there is no
 * wheel, no pinch and no key that moves the camera along its line of sight. A
 * capture is a room you stand in and look around, and pulling back out of it
 * showed the reconstruction as an object — the floaters, the missing ceiling,
 * the walls thinning at the edges — rather than the place it is meant to be.
 * Only an authored entry point sets a distance other than zero.
 *
 * Roll is never applied, so the horizon stays level however far you turn.
 */

/** Radians per pixel dragged. A drag of ~360px turns you a quarter turn. */
const ROTATE_SPEED = 0.004;
/** Just shy of straight up/down, where yaw becomes meaningless. */
const PITCH_LIMIT = Math.PI / 2 - 0.01;
/** Fraction of the remaining distance covered per frame at 60fps. */
const SMOOTHING = 0.25;
/** Radians per second while a turn key is held. */
const KEY_TURN_SPEED = 1.5;

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
  private box: THREE.Box3 | null = null;
  private pointers = new Map<number, THREE.Vector2>();
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
   * The extent an authored entry point is held inside, so a distance further
   * back than the capture cannot put the camera outside its walls.
   */
  setBounds(box: THREE.Box3, radius: number) {
    this.box = box;
    this.radius = radius;
  }

  update(deltaTime: number) {
    const dt = Math.min(deltaTime, 0.1);

    let turn = 0;
    for (const code of this.held) turn += TURN_KEYS[code] ?? 0;
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
    // the screen, which is the one thing that has to stay true. The set distance
    // is left alone, so turning back toward open space gives it back.
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
    this.domElement.releasePointerCapture?.(event.pointerId);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.enabled || typingInAField()) return;
    if (!(event.code in TURN_KEYS)) return;
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
