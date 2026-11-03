const VISION_MODULE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const VISION_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const HAND_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

interface NormalizedLandmark {
  x: number;
  y: number;
}

interface HandLandmarkerResult {
  landmarks: NormalizedLandmark[][];
}

interface HandLandmarker {
  detectForVideo(video: HTMLVideoElement, timestamp: number): HandLandmarkerResult;
  close(): void;
}

interface VisionTasksModule {
  FilesetResolver: {
    forVisionTasks(path: string): Promise<unknown>;
  };
  HandLandmarker: {
    createFromOptions(fileset: unknown, options: {
      baseOptions: { modelAssetPath: string };
      runningMode: "VIDEO";
      numHands: number;
    }): Promise<HandLandmarker>;
  };
}

function isInsideForehead(point: NormalizedLandmark): boolean {
  return point.x >= 0.35 && point.x <= 0.65 && point.y >= 0.05 && point.y <= 0.30;
}

export async function createTapTrigger(opts: {
  video: HTMLVideoElement;
  onFire: () => void;
  onProgress?: (n: number) => void;
}): Promise<{ start(): void; stop(): void }> {
  let landmarker: HandLandmarker | null = null;
  try {
    const module = await import(/* @vite-ignore */ VISION_MODULE_URL) as VisionTasksModule;
    const fileset = await module.FilesetResolver.forVisionTasks(VISION_WASM_URL);
    landmarker = await module.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: HAND_MODEL_URL },
      runningMode: "VIDEO",
      numHands: 1,
    });
  } catch (error) {
    console.error("Unable to load the hand landmarker:", error);
  }

  let running = false;
  let frameId = 0;
  let count = 0;
  let cooldownUntil = 0;
  let previousTimestamp = -1;

  const frame = (): void => {
    if (!running) return;
    frameId = requestAnimationFrame(frame);
    if (!landmarker || opts.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const now = performance.now();
    if (now < cooldownUntil) return;
    const timestamp = Math.max(now, previousTimestamp + 1);
    previousTimestamp = timestamp;
    try {
      const result = landmarker.detectForVideo(opts.video, timestamp);
      const hand = result.landmarks[0];
      if (hand && hand.length > 17) {
        const fingertip = hand[8];
        const palmPoints = [hand[0], hand[5], hand[9], hand[13], hand[17]];
        if (fingertip && palmPoints.every((point): point is NormalizedLandmark => Boolean(point))) {
          const palmCentre: NormalizedLandmark = {
            x: palmPoints.reduce((sum, point) => sum + point.x, 0) / palmPoints.length,
            y: palmPoints.reduce((sum, point) => sum + point.y, 0) / palmPoints.length,
          };
          count = isInsideForehead(fingertip) && isInsideForehead(palmCentre) ? count + 1 : 0;
        } else {
          count = 0;
        }
      } else {
        count = 0;
      }
      opts.onProgress?.(count);
      if (count >= 4) {
        opts.onFire();
        count = 0;
        opts.onProgress?.(count);
        cooldownUntil = performance.now() + 1500;
      }
    } catch (error) {
      console.error("Hand landmark detection failed:", error);
      count = 0;
      opts.onProgress?.(count);
    }
  };

  return {
    start(): void {
      if (!landmarker || running) return;
      running = true;
      frameId = requestAnimationFrame(frame);
    },
    stop(): void {
      running = false;
      cancelAnimationFrame(frameId);
      landmarker?.close();
      landmarker = null;
    },
  };
}
