import * as THREE from "three";

type PinSource = {
  buffer: AudioBuffer;
  panner: PannerNode;
  gain: GainNode;
  node: AudioBufferSourceNode | null;
};

/**
 * Positional playback of pinned voice memories. Volume and direction follow the
 * listener's camera, which is the thing a flat video categorically cannot do.
 */
export class SpatialAudioEngine {
  private ctx: AudioContext;
  private sources = new Map<string, PinSource>();
  private loading = new Map<string, Promise<PinSource>>();
  private refDistance = 1;
  private forward = new THREE.Vector3();
  private up = new THREE.Vector3();

  constructor() {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new Ctor();
  }

  /** Autoplay policy starts the context suspended; call from a user gesture. */
  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  get running() {
    return this.ctx.state === "running";
  }

  /** Scales falloff to the capture, which may be room-sized or object-sized. */
  setSceneScale(radius: number) {
    this.refDistance = Math.max(radius * 0.15, 0.1);
    for (const { panner } of this.sources.values()) {
      panner.refDistance = this.refDistance;
      panner.maxDistance = this.refDistance * 40;
    }
  }

  async load(pinId: string, url: string, position: THREE.Vector3Like) {
    const existing = this.sources.get(pinId);
    if (existing) {
      setPannerPosition(existing.panner, position, this.ctx.currentTime);
      return existing;
    }
    const inFlight = this.loading.get(pinId);
    if (inFlight) return inFlight;

    const task = (async () => {
      const res = await fetch(url);
      const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());

      const panner = this.ctx.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = this.refDistance;
      panner.maxDistance = this.refDistance * 40;
      panner.rolloffFactor = 1;
      setPannerPosition(panner, position, this.ctx.currentTime);

      const gain = this.ctx.createGain();
      panner.connect(gain).connect(this.ctx.destination);

      const source: PinSource = { buffer, panner, gain, node: null };
      this.sources.set(pinId, source);
      this.loading.delete(pinId);
      return source;
    })();

    this.loading.set(pinId, task);
    return task;
  }

  async play(pinId: string, url: string, position: THREE.Vector3Like, onEnded?: () => void) {
    await this.resume();
    const source = await this.load(pinId, url, position);
    this.stop(pinId);

    const node = this.ctx.createBufferSource();
    node.buffer = source.buffer;
    node.connect(source.panner);
    node.onended = () => {
      if (source.node === node) source.node = null;
      onEnded?.();
    };
    source.node = node;
    node.start();
  }

  stop(pinId: string) {
    const source = this.sources.get(pinId);
    if (!source?.node) return;
    source.node.onended = null;
    source.node.stop();
    source.node.disconnect();
    source.node = null;
  }

  stopAll() {
    for (const pinId of this.sources.keys()) this.stop(pinId);
  }

  /** Called every frame so panning tracks navigation. */
  updateListener(camera: THREE.Camera) {
    const listener = this.ctx.listener;
    const t = this.ctx.currentTime;
    camera.getWorldDirection(this.forward);
    this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const p = camera.position;

    if (listener.positionX) {
      listener.positionX.setValueAtTime(p.x, t);
      listener.positionY.setValueAtTime(p.y, t);
      listener.positionZ.setValueAtTime(p.z, t);
      listener.forwardX.setValueAtTime(this.forward.x, t);
      listener.forwardY.setValueAtTime(this.forward.y, t);
      listener.forwardZ.setValueAtTime(this.forward.z, t);
      listener.upX.setValueAtTime(this.up.x, t);
      listener.upY.setValueAtTime(this.up.y, t);
      listener.upZ.setValueAtTime(this.up.z, t);
    } else {
      // Safari still ships the deprecated listener API.
      listener.setPosition(p.x, p.y, p.z);
      listener.setOrientation(
        this.forward.x, this.forward.y, this.forward.z,
        this.up.x, this.up.y, this.up.z,
      );
    }
  }

  dispose() {
    this.stopAll();
    this.sources.clear();
    this.loading.clear();
    void this.ctx.close();
  }
}

function setPannerPosition(
  panner: PannerNode,
  { x, y, z }: THREE.Vector3Like,
  time: number,
) {
  if (panner.positionX) {
    panner.positionX.setValueAtTime(x, time);
    panner.positionY.setValueAtTime(y, time);
    panner.positionZ.setValueAtTime(z, time);
  } else {
    panner.setPosition(x, y, z);
  }
}
