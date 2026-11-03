import { FilesetResolver, ImageSegmenter } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
import type { PipelineHandle } from "./types";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";

export async function initializeLivePipeline(
  video: HTMLVideoElement,
  outputCanvas: HTMLCanvasElement,
  getPlate: () => HTMLCanvasElement | null,
  stateElement: HTMLElement,
): Promise<PipelineHandle> {
  const ctx = outputCanvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable on the output canvas.");

  let segmenter: ImageSegmenter | null = null;
  let presented = true;
  let running = false;
  let initializing = false;
  let startRequested = false;
  let rafId = 0;
  let lastTimestamp = -1;

  let maskCanvas: HTMLCanvasElement | null = null;
  let maskCtx: CanvasRenderingContext2D | null = null;
  let maskImage: ImageData | null = null;
  let maskWidth = 0;
  let maskHeight = 0;
  let foregroundCanvas: HTMLCanvasElement | null = null;
  let foregroundCtx: CanvasRenderingContext2D | null = null;
  let foregroundWidth = 0;
  let foregroundHeight = 0;
  let lastSegmentedAt = 0;
  let personMask: ImageData | null = null;

  function setState(text: string): void {
    stateElement.textContent = text;
  }

  async function ensureSegmenter(): Promise<ImageSegmenter | null> {
    if (segmenter) return segmenter;
    try {
      const fileset = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
      );
      segmenter = await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL },
        runningMode: "VIDEO",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
      return segmenter;
    } catch (error) {
      console.error("Segmenter failed to load", error);
      setState("SEGMENTER UNAVAILABLE");
      return null;
    }
  }

  function ensureMaskBuffers(width: number, height: number): void {
    if (maskWidth === width && maskHeight === height && maskCanvas && maskImage) return;
    maskCanvas = document.createElement("canvas");
    maskCanvas.width = width;
    maskCanvas.height = height;
    maskCtx = maskCanvas.getContext("2d");
    maskImage = maskCtx ? maskCtx.createImageData(width, height) : null;
    personMask = maskImage;
    maskWidth = width;
    maskHeight = height;
  }

  function ensureForeground(width: number, height: number): void {
    if (foregroundCanvas && foregroundWidth === width && foregroundHeight === height) return;
    foregroundCanvas = document.createElement("canvas");
    foregroundCanvas.width = width;
    foregroundCanvas.height = height;
    foregroundCtx = foregroundCanvas.getContext("2d");
    foregroundWidth = width;
    foregroundHeight = height;
  }

  function buildPersonMask(data: Uint8Array, width: number, height: number): void {
    ensureMaskBuffers(width, height);
    if (!maskImage) return;
    const pixels = maskImage.data;
    for (let i = 0; i < width * height; i += 1) {
      const person = data[i] !== 0;
      const offset = i * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = person ? 255 : 0;
    }
  }

  function composite(timestamp: number): void {
    const plate = getPlate();
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!plate || width === 0 || height === 0) return;

    if (outputCanvas.width !== width || outputCanvas.height !== height) {
      outputCanvas.width = width;
      outputCanvas.height = height;
    }
    ensureForeground(width, height);

    if (presented || !segmenter) {
      ctx.drawImage(video, 0, 0, width, height);
      return;
    }

    if (timestamp - lastSegmentedAt > 50 && timestamp > lastTimestamp) {
      lastTimestamp = timestamp;
      lastSegmentedAt = timestamp;
      segmenter.segmentForVideo(video, timestamp, (result) => {
        const mask = result.categoryMask;
        if (!mask) return;
        try {
          buildPersonMask(mask.getAsUint8Array(), mask.width, mask.height);
        } finally {
          mask.close?.();
        }
      });
    }

    if (foregroundCtx) {
      foregroundCtx.clearRect(0, 0, width, height);
      foregroundCtx.drawImage(video, 0, 0, width, height);
      if (maskCanvas && personMask) {
        maskCtx?.putImageData(personMask, 0, 0);
        foregroundCtx.save();
        foregroundCtx.globalCompositeOperation = "destination-in";
        foregroundCtx.imageSmoothingEnabled = true;
        foregroundCtx.drawImage(maskCanvas, 0, 0, width, height);
        foregroundCtx.restore();
      }
      ctx.drawImage(plate, 0, 0, width, height);
      if (personMask) ctx.drawImage(foregroundCanvas!, 0, 0, width, height);
    } else {
      ctx.drawImage(video, 0, 0, width, height);
    }
  }

  function loop(): void {
    if (!running) return;
    composite(performance.now());
    rafId = requestAnimationFrame(loop);
  }

  return {
    start(): void {
      if (running) return;
      startRequested = true;
      if (initializing) return;
      initializing = true;
      void (async () => {
        try {
          const instance = await ensureSegmenter();
          if (!instance || !startRequested || running) return;
          running = true;
          rafId = requestAnimationFrame(loop);
        } catch (error) {
          console.error("Pipeline initialization failed", error);
        } finally {
          initializing = false;
        }
      })();
    },
    stop(): void {
      startRequested = false;
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    },
    setPresented(value: boolean): void {
      presented = value;
      setState(value ? "PRESENCE: DETECTED" : "PRESENCE: LOST");
    },
  };
}
