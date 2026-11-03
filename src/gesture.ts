import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const FOREHEAD = { xMin: 0.35, xMax: 0.65, yMin: 0.05, yMax: 0.3 };
const FRAMES_TO_FIRE = 4;
const COOLDOWN_MS = 1500;

export interface GestureTriggerOptions {
  video: HTMLVideoElement;
  onFire: () => void;
  onProgress?: (consecutiveFrames: number) => void;
}

export interface GestureTrigger {
  start(): Promise<void>;
  stop(): void;
}

function insideForehead(x: number, y: number): boolean {
  return x >= FOREHEAD.xMin && x <= FOREHEAD.xMax && y >= FOREHEAD.yMin && y <= FOREHEAD.yMax;
}

export async function createTapTrigger(options: GestureTriggerOptions): Promise<GestureTrigger> {
  let landmarker: HandLandmarker | null = null;
  let running = false;
  let rafId = 0;
  let consecutive = 0;
  let cooldownUntil = 0;
  let lastTimestamp = -1;

  async function ensureLandmarker(): Promise<HandLandmarker | null> {
    if (landmarker) return landmarker;
    try {
      const fileset = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
      );
      landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL },
        runningMode: "VIDEO",
        numHands: 1,
      });
      return landmarker;
    } catch (error) {
      console.error("HandLandmarker failed to load", error);
      return null;
    }
  }

  function report(count: number): void {
    if (!options.onProgress) return;
    try {
      options.onProgress(count);
    } catch (error) {
      console.error("onProgress handler threw", error);
    }
  }

  function tick(timestamp: number): void {
    if (!running || !landmarker) return;
    rafId = requestAnimationFrame(tick);
    if (timestamp < cooldownUntil) return;
    if (timestamp <= lastTimestamp) return;
    lastTimestamp = timestamp;

    let handInRegion = false;
    try {
      const result = landmarker.detectForVideo(options.video, timestamp);
      const hand = result.landmarks?.[0];
      if (hand && hand.length >= 21) {
        const tip = hand[8];
        const palmIds = [0, 5, 9, 13, 17];
        let px = 0;
        let py = 0;
        for (const id of palmIds) {
          px += hand[id].x;
          py += hand[id].y;
        }
        px /= palmIds.length;
        py /= palmIds.length;
        handInRegion = insideForehead(tip.x, tip.y) || insideForehead(px, py);
      }
    } catch (error) {
      console.error("Hand detection failed", error);
      return;
    }

    consecutive = handInRegion ? consecutive + 1 : 0;
    report(consecutive);
    if (consecutive >= FRAMES_TO_FIRE) {
      consecutive = 0;
      cooldownUntil = timestamp + COOLDOWN_MS;
      report(0);
      try {
        options.onFire();
      } catch (error) {
        console.error("onFire handler threw", error);
      }
    }
  }

  return {
    async start(): Promise<void> {
      if (running) return;
      const instance = await ensureLandmarker();
      if (!instance) return;
      running = true;
      rafId = requestAnimationFrame(tick);
    },
    stop(): void {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    },
  };
}
