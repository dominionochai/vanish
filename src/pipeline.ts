import type { FrameSnapshot } from "./types";

/** Capture the current decoded video frame, returning null when it is unavailable. */
export function captureVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): FrameSnapshot | null {
  if (
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    video.videoWidth === 0 ||
    video.videoHeight === 0
  ) {
    return null;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return {
      image: context.getImageData(0, 0, canvas.width, canvas.height),
      capturedAt: performance.now(),
    };
  } catch {
    // A frame can become unavailable between the readiness check and the read.
    return null;
  }
}

const VISION_MODULE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";
const VISION_WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const SELFIE_MULTICLASS_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";

interface VisionMask {
  width: number;
  height: number;
  getAsFloat32Array(): Float32Array;
  close?: () => void;
}

interface VisionResult {
  confidenceMasks?: VisionMask[];
}

interface VisionSegmenter {
  segmentForVideo(image: HTMLCanvasElement, timestampMs: number): VisionResult;
}

interface VisionModule {
  FilesetResolver: {
    forVisionTasks(wasmRoot: string): Promise<unknown>;
  };
  ImageSegmenter: {
    createFromOptions(
      fileset: unknown,
      options: Record<string, unknown>,
    ): Promise<VisionSegmenter>;
  };
}

export interface LivePipeline {
  /** Resume rendering after stop(). The pipeline also starts automatically on initialization. */
  start(): void;
  /** Pause the animation-frame loop. start() can be used to resume it. */
  stop(): void;
}

/**
 * Start live person segmentation and background replacement. If model loading fails,
 * the live video continues to render and the supplied state element displays an error.
 */
export async function initializeLivePipeline(
  video: HTMLVideoElement,
  outputCanvas: HTMLCanvasElement,
  getPlate: () => CanvasImageSource | null,
  stateElement: HTMLElement,
): Promise<LivePipeline> {
  const inputCanvas = document.createElement("canvas");
  const foregroundCanvas = document.createElement("canvas");
  const maskCanvas = document.createElement("canvas");
  const softenedMaskCanvas = document.createElement("canvas");
  const inputContext = inputCanvas.getContext("2d", { willReadFrequently: true });
  const foregroundContext = foregroundCanvas.getContext("2d");
  const maskContext = maskCanvas.getContext("2d");
  const softenedMaskContext = softenedMaskCanvas.getContext("2d");
  const outputContext = outputCanvas.getContext("2d");

  if (
    !inputContext ||
    !foregroundContext ||
    !maskContext ||
    !softenedMaskContext ||
    !outputContext
  ) {
    throw new Error("This browser could not create the canvases needed for the live pipeline.");
  }

  let segmenter: VisionSegmenter | null = null;
  let modelError: string | null = null;
  let running = true;
  let animationFrame = 0;
  let lastState = "";

  const setState = (text: string) => {
    if (lastState !== text) {
      stateElement.textContent = text;
      lastState = text;
    }
  };

  const resizeCanvases = (width: number, height: number) => {
    for (const canvas of [
      inputCanvas,
      foregroundCanvas,
      maskCanvas,
      softenedMaskCanvas,
      outputCanvas,
    ]) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }
  };

  const render = (timestampMs: number) => {
    if (!running) return;

    try {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        width === 0 ||
        height === 0
      ) {
        if (modelError) setState(modelError);
        else setState("Waiting for live video…");
      } else {
        resizeCanvases(width, height);
        inputContext.drawImage(video, 0, 0, width, height);

        // Keep a raw live image visible first; any segmentation issue leaves this fallback intact.
        outputContext.clearRect(0, 0, width, height);
        outputContext.drawImage(inputCanvas, 0, 0);

        let plate: CanvasImageSource | null = null;
        try {
          plate = getPlate();
        } catch {
          plate = null;
        }

        if (modelError) {
          setState(modelError);
        } else if (!plate) {
          setState("Capture a plate to begin.");
        } else if (segmenter) {
          let result: VisionResult | undefined;
          try {
            result = segmenter.segmentForVideo(inputCanvas, timestampMs);
            const masks = result.confidenceMasks;
            const classMasks = masks?.slice(1, 5);
            const firstMask = classMasks?.[0];

            // Selfie Multiclass indices 1–4 are foreground classes; index 0 is background.
            if (firstMask && classMasks?.length === 4) {
              const maskWidth = firstMask.width;
              const maskHeight = firstMask.height;
              const classData = classMasks.map((mask) => mask.getAsFloat32Array());
              const maskPixels = maskContext.createImageData(width, height);

              // Sample confidence values directly into a native-sized alpha buffer instead of
              // enlarging the model mask through a canvas drawImage operation.
              for (let y = 0; y < height; y += 1) {
                const sourceY = Math.max(
                  0,
                  Math.min(maskHeight - 1, ((y + 0.5) * maskHeight) / height - 0.5),
                );
                const y0 = Math.floor(sourceY);
                const y1 = Math.min(maskHeight - 1, y0 + 1);
                const fy = sourceY - y0;

                for (let x = 0; x < width; x += 1) {
                  const sourceX = Math.max(
                    0,
                    Math.min(maskWidth - 1, ((x + 0.5) * maskWidth) / width - 0.5),
                  );
                  const x0 = Math.floor(sourceX);
                  const x1 = Math.min(maskWidth - 1, x0 + 1);
                  const fx = sourceX - x0;
                  let foreground = 0;

                  for (const data of classData) {
                    const top = data[y0 * maskWidth + x0] * (1 - fx) +
                      data[y0 * maskWidth + x1] * fx;
                    const bottom = data[y1 * maskWidth + x0] * (1 - fx) +
                      data[y1 * maskWidth + x1] * fx;
                    foreground += top * (1 - fy) + bottom * fy;
                  }

                  const offset = (y * width + x) * 4;
                  const alpha = Math.round(Math.max(0, Math.min(1, foreground)) * 255);
                  maskPixels.data[offset] = 255;
                  maskPixels.data[offset + 1] = 255;
                  maskPixels.data[offset + 2] = 255;
                  maskPixels.data[offset + 3] = alpha;
                }
              }

              maskContext.putImageData(maskPixels, 0, 0);
              softenedMaskContext.clearRect(0, 0, width, height);
              softenedMaskContext.filter = "blur(2px)";
              softenedMaskContext.drawImage(maskCanvas, 0, 0);
              softenedMaskContext.filter = "none";

              foregroundContext.clearRect(0, 0, width, height);
              foregroundContext.drawImage(inputCanvas, 0, 0);
              foregroundContext.globalCompositeOperation = "destination-in";
              foregroundContext.drawImage(softenedMaskCanvas, 0, 0);
              foregroundContext.globalCompositeOperation = "source-over";

              outputContext.clearRect(0, 0, width, height);
              outputContext.drawImage(plate, 0, 0, width, height);
              outputContext.drawImage(foregroundCanvas, 0, 0);
              setState("Live background replacement active.");
            } else {
              setState("Person mask unavailable; live video is still running.");
            }
          } catch {
            foregroundContext.globalCompositeOperation = "source-over";
            setState("Segmentation failed for this frame; live video is still running.");
          } finally {
            result?.confidenceMasks?.forEach((mask) => mask.close?.());
          }
        } else {
          setState("Loading person segmentation model…");
        }
      }
    } catch {
      setState(modelError ?? "Live video is still running, but this frame could not be processed.");
    }

    if (running) animationFrame = requestAnimationFrame(render);
  };

  const start = () => {
    if (running) return;
    running = true;
    animationFrame = requestAnimationFrame(render);
  };

  const stop = () => {
    running = false;
    cancelAnimationFrame(animationFrame);
  };

  // Start rendering immediately so video remains visible while the model downloads.
  animationFrame = requestAnimationFrame(render);

  try {
    // @vite-ignore keeps this pinned browser ESM import external to the app bundle.
    const vision = (await import(/* @vite-ignore */ VISION_MODULE_URL)) as VisionModule;
    const fileset = await vision.FilesetResolver.forVisionTasks(VISION_WASM_ROOT);
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: SELFIE_MULTICLASS_MODEL_URL, delegate },
      runningMode: "VIDEO",
      outputCategoryMask: true,
      outputConfidenceMasks: true,
    });

    try {
      segmenter = await vision.ImageSegmenter.createFromOptions(fileset, options("GPU"));
    } catch {
      // CPU is a compatibility fallback for devices without a usable WebGL delegate.
      segmenter = await vision.ImageSegmenter.createFromOptions(fileset, options("CPU"));
    }
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    modelError = `Could not load the person segmentation model.${detail} Live video is still running.`;
    setState(modelError);
  }

  return { start, stop };
}
