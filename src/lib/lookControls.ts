import * as THREE from "three";

/**
 * Standing look-around, for a camera that is inside the place rather than
 * outside it.
 *
 * OrbitControls turns the camera about a target some distance away, which is the
 * right feel for holding an object and the wrong one for standing in a room: to
 * stand at the middle of a capture you would have to put the target somewhere
 * off-centre, and every drag then swings you around that off-centre point. Here
 * the camera turns about itself, so the pivot and the middle of the capture are
 * the same place, and a drag reads as turning your head.
 *
 * Roll is never applied, so the horizon stays level however far you turn.
 */

/** Radians per pixel dragged. A drag of ~360px turns you a quarter turn. */
const ROTATE_SPEED = 0.004;
/** Just shy of straight up/down, where yaw becomes meaningless. */
const PITCH_LIMIT = Math.PI / 2 - 0.01;
/** Fraction of the remaining angle covered per frame at 60fps. */
const SMOOTHING = 0.25;
/** Walking pace and wheel step, as fractions of the capture radius. */
const WALK_SPEED = 0.6;
const WHEEL_STEP = 0.0015;
const PINCH_STEP = 0.004;

const MOVE_KEYS: Record<string, [forward: number, right: number]> = {
  KeyW: [1, 0],
  ArrowUp: [1, 0],
  KeyS: [-1, 0],
  ArrowDown: [-1, 0],
  KeyA: [0, -1],
  ArrowLeft: [0, -1],
  KeyD: [0, 1],
  ArrowRight: [0, 1],
};

/** Typing a caption should not also walk you across the room. */
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

export class LookControls {
  /** Set false to hand the pointer to something else, e.g. a modal. */
  enabled = true;

  private yaw = 0;
  private pitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  private radius = 1;
  private box: THREE.Box3 | null = null;
  private pointers = new Map<number, THREE.Vector2>();
  private pinchDistance = 0;
  private held = new Set<string>();
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
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

  /** Stand at `position` facing `forward`, with no roll and no easing. */
  setPose(position: THREE.Vector3, forward: THREE.Vector3) {
    this.camera.position.copy(position);
    const dir = forward.clone().normalize();
    this.targetPitch = THREE.MathUtils.clamp(
      Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)),
      -PITCH_LIMIT,
      PITCH_LIMIT,
    );
    this.targetYaw = Math.atan2(-dir.x, -dir.z);
    this.yaw = this.targetYaw;
    this.pitch = this.targetPitch;
    this.applyRotation();
  }

  /** Walking pace follows the size of the capture, and stops at its edges. */
  setBounds(box: THREE.Box3, radius: number) {
    this.box = box;
    this.radius = radius;
  }

  update(deltaTime: number) {
    // Frame-rate independent approach to the target angle.
    const t = 1 - Math.pow(1 - SMOOTHING, Math.min(deltaTime, 0.1) * 60);
    this.yaw += (this.targetYaw - this.yaw) * t;
    this.pitch += (this.targetPitch - this.pitch) * t;

    let forward = 0;
    let right = 0;
    for (const code of this.held) {
      const move = MOVE_KEYS[code];
      if (move) {
        forward += move[0];
        right += move[1];
      }
    }
    if (forward !== 0 || right !== 0) {
      const step = this.radius * WALK_SPEED * Math.min(deltaTime, 0.1);
      this.walk(forward * step, right * step);
    }

    this.applyRotation();
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

  private applyRotation() {
    // YXZ with a zero Z term is what keeps the horizon level.
    this.euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this.euler);
  }

  /** Move across the floor, not along the line of sight: looking up is not climbing. */
  private walk(forward: number, right: number) {
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    this.camera.position.x += -sin * forward + cos * right;
    this.camera.position.z += -cos * forward - sin * right;
    // Staying within the capture keeps a stray scroll from stranding you in the void.
    if (this.box) this.camera.position.clamp(this.box.min, this.box.max);
  }

  private onPointerDown = (event: PointerEvent) => {
    if (!this.enabled || !event.isPrimary) {
      if (this.enabled) {
        this.pointers.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));
      }
      return;
    }
    this.pointers.set(event.pointerId, new THREE.Vector2(event.clientX, event.clientY));
    this.domElement.setPointerCapture?.(event.pointerId);
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
    // Drag left and the world swings left, as though you turned to look at it.
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

  /** Two fingers spreading walks you forward, the touch equivalent of the wheel. */
  private pinch() {
    const [a, b] = [...this.pointers.values()];
    const distance = a.distanceTo(b);
    if (this.pinchDistance !== 0) {
      this.walk((distance - this.pinchDistance) * this.radius * PINCH_STEP, 0);
    }
    this.pinchDistance = distance;
  }

  private onWheel = (event: WheelEvent) => {
    if (!this.enabled) return;
    event.preventDefault();
    this.walk(-event.deltaY * this.radius * WHEEL_STEP, 0);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.enabled || typingInAField() || !MOVE_KEYS[event.code]) return;
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
