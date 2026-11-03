import type { GestureEstimate, GesturePoint } from "./types";

const TAP_RADIUS_PX = 24;
const HOLD_DURATION_MS = 600;
const TASKS_VISION_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const HAND_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const FOREHEAD_BOUNDS = { minX: 0.35, maxX: 0.65, minY: 0.05, maxY: 0.3 };
const REQUIRED_CONSECUTIVE_FRAMES = 4;
const FIRE_COOLDOWN_MS = 1500;

interface NormalizedLandmark {
  x: number;
  y: number;
}

interface HandLandmarkerResult {
  landmarks: NormalizedLandmark[][];
}

interface HandLandmarkerInstance {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): HandLandmarkerResult;
}

interface TasksVisionApi {
  FilesetResolver: {
    forVisionTasks(wasmFilesetPath: string): Promise<unknown>;
  };
  HandLandmarker: {
    createFromOptions(
      fileset: unknown,
      options: {
        baseOptions: { modelAssetPath: string };
        runningMode: "VIDEO";
        numHands: 1;
      },
    ): Promise<HandLandmarkerInstance>;
  };
}

export interface GestureTriggerOptions {
  video: HTMLVideoElement;
  onFire: () => void;
  onProgress?: (consecutiveFrames: number) => void;
}

/** Classify a pointer path conservatively as a tap, hold, or swipe. */
export function estimatePointerGesture(
  start: GesturePoint,
  end: GesturePoint,
): GestureEstimate {
  const coordinates = [start.x, start.y, start.timeMs, end.x, end.y, end.timeMs];
  if (!coordinates.every(Number.isFinite)) {
    return {
      kind: "tap",
      deltaX: 0,
      deltaY: 0,
      durationMs: 0,
      confidence: 0,
    };
  }

  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const durationMs = Math.max(0, end.timeMs - start.timeMs);
  const distance = Math.hypot(deltaX, deltaY);
  const kind =
    distance >= TAP_RADIUS_PX
      ? "swipe"
      : durationMs >= HOLD_DURATION_MS
        ? "hold"
        : "tap";
  const rawConfidence =
    kind === "swipe"
      ? distance / (TAP_RADIUS_PX * 2)
      : kind === "hold"
        ? durationMs / (HOLD_DURATION_MS * 2)
        : 1 - distance / TAP_RADIUS_PX;

  return {
    kind,
    deltaX,
    deltaY,
    durationMs,
    confidence: Math.min(1, Math.max(0, rawConfidence)),
  };
}

export async function createTapTrigger(
  options: GestureTriggerOptions,
): Promise<{ start(): void; stop(): void }> {
  let landmarker: HandLandmarkerInstance;

  try {
    // @ts-ignore -- TypeScript does not resolve browser-native HTTPS module specifiers.
    const tasksVision = (await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14")) as unknown as TasksVisionApi;
    const fileset = await tasksVision.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
    );
    landmarker = await tasksVision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: HAND_LANDMARKER_MODEL_URL },
      runningMode: "VIDEO",
      numHands: 1,
    });
  } catch (error: unknown) {
    console.error("Unable to initialize the MediaPipe hand landmarker.", error);
    return { start(): void {}, stop(): void {} };
  }

  let running = false;
  let animationFrameId: number | null = null;
  let consecutiveFrames = 0;
  let cooldownUntil = 0;

  const isInsideForeheadBounds = (point: NormalizedLandmark): boolean =>
    point.x >= FOREHEAD_BOUNDS.minX &&
    point.x <= FOREHEAD_BOUNDS.maxX &&
    point.y >= FOREHEAD_BOUNDS.minY &&
    point.y <= FOREHEAD_BOUNDS.maxY;

  const processFrame = (): void => {
    if (!running) return;

    const timestamp = performance.now();
    if (timestamp >= cooldownUntil) {
      const result = landmarker.detectForVideo(options.video, timestamp);
      const landmarks = result.landmarks[0];
      const fingertip = landmarks?.[8];
      const palmPoints = [0, 5, 9, 13, 17].map((index) => landmarks?.[index]);
      const palmCenter = palmPoints.every((point) => point !== undefined)
        ? {
            x: palmPoints.reduce((sum, point) => sum + (point?.x ?? 0), 0) / 5,
            y: palmPoints.reduce((sum, point) => sum + (point?.y ?? 0), 0) / 5,
          }
        : undefined;
      const isTapPosition =
        fingertip !== undefined &&
        palmCenter !== undefined &&
        (isInsideForeheadBounds(fingertip) || isInsideForeheadBounds(palmCenter));

      consecutiveFrames = isTapPosition ? consecutiveFrames + 1 : 0;
      if (consecutiveFrames >= REQUIRED_CONSECUTIVE_FRAMES) {
        consecutiveFrames = 0;
        cooldownUntil = timestamp + FIRE_COOLDOWN_MS;
        options.onFire();
      }
    }

    options.onProgress?.(consecutiveFrames);
    if (running) animationFrameId = requestAnimationFrame(processFrame);
  };

  return {
    start(): void {
      if (running) return;
      running = true;
      animationFrameId = requestAnimationFrame(processFrame);
    },
    stop(): void {
      running = false;
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
      consecutiveFrames = 0;
    },
  };
}
