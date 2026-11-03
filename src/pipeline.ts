import type { PipelineHandle } from "./types";

const VISION_MODULE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const VISION_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const SEGMENTER_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";

interface CategoryMask {
  width: number;
  height: number;
  getAsUint8Array(): Uint8Array;
  close?(): void;
}

interface SegmenterResult {
  categoryMask?: CategoryMask;
}

interface ImageSegmenter {
  segmentForVideo(video: HTMLVideoElement, timestamp: number): SegmenterResult;
  close(): void;
}

interface VisionTasksModule {
  FilesetResolver: {
    forVisionTasks(path: string): Promise<unknown>;
  };
  ImageSegmenter: {
    createFromOptions(fileset: unknown, options: {
      baseOptions: { modelAssetPath: string };
      runningMode: "VIDEO";
      outputCategoryMask: boolean;
    }): Promise<ImageSegmenter>;
  };
}

function meanRgb(data: Uint8ClampedArray | Uint8Array): [number, number, number] {
  let red = 0;
  let green = 0;
  let blue = 0;
  const count = Math.floor(data.length / 4);
  for (let i = 0; i < data.length; i += 4) {
    red += data[i] ?? 0;
    green += data[i + 1] ?? 0;
    blue += data[i + 2] ?? 0;
  }
  return count ? [red / count, green / count, blue / count] : [0, 0, 0];
}

export async function initializeLivePipeline(
  video: HTMLVideoElement,
  outputCanvas: HTMLCanvasElement,
  getPlate: () => HTMLCanvasElement | null,
  stateElement: HTMLElement,
): Promise<PipelineHandle> {
  let segmenter: ImageSegmenter | null = null;
  let loadFailed = false;
  try {
    const module = await import(/* @vite-ignore */ VISION_MODULE_URL) as VisionTasksModule;
    const fileset = await module.FilesetResolver.forVisionTasks(VISION_WASM_URL);
    segmenter = await module.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: SEGMENTER_MODEL_URL },
      runningMode: "VIDEO",
      outputCategoryMask: true,
    });
  } catch (error) {
    loadFailed = true;
    console.error("Unable to load the live segmentation model:", error);
    stateElement.textContent = "ERROR: unable to load segmentation model";
  }

  let presented = true;
  let running = false;
  let frameId = 0;
  let previousTimestamp = -1;
  const outputContext = outputCanvas.getContext("2d", { willReadFrequently: true });
  const liveCanvas = document.createElement("canvas");
  const liveContext = liveCanvas.getContext("2d");
  const maskCanvas = document.createElement("canvas");
  const maskContext = maskCanvas.getContext("2d");
  const analysisCanvas = document.createElement("canvas");
  analysisCanvas.width = 160;
  analysisCanvas.height = 120;
  const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });

  const drawFrame = (timestamp: number): void => {
    if (!running) return;
    frameId = requestAnimationFrame(drawFrame);
    if (!outputContext || !liveContext || !maskContext || !analysisContext || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return;
    if (outputCanvas.width !== width || outputCanvas.height !== height) {
      outputCanvas.width = width;
      outputCanvas.height = height;
      liveCanvas.width = width;
      liveCanvas.height = height;
    }

    let brightness = 1;
    const plate = getPlate();
    if (plate) {
      try {
        analysisContext.clearRect(0, 0, analysisCanvas.width, analysisCanvas.height);
        analysisContext.drawImage(plate, 0, 0, analysisCanvas.width, analysisCanvas.height);
        const platePixels = analysisContext.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height).data;
        const plateMean = meanRgb(platePixels);
        analysisContext.clearRect(0, 0, analysisCanvas.width, analysisCanvas.height);
        analysisContext.drawImage(video, 0, 0, width, Math.max(1, Math.round(height * 0.15)), 0, 0, analysisCanvas.width, analysisCanvas.height);
        const livePixels = analysisContext.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height).data;
        const liveMean = meanRgb(livePixels);
        const plateLuma = (plateMean[0] * 0.299 + plateMean[1] * 0.587 + plateMean[2] * 0.114) || 1;
        const liveLuma = liveMean[0] * 0.299 + liveMean[1] * 0.587 + liveMean[2] * 0.114;
        brightness = Math.min(1.8, Math.max(0.55, liveLuma / plateLuma));
      } catch (error) {
        console.warn("Plate colour matching was unavailable:", error);
      }
      outputContext.filter = `brightness(${brightness})`;
      outputContext.drawImage(plate, 0, 0, width, height);
      outputContext.filter = "none";
    } else {
      outputContext.clearRect(0, 0, width, height);
    }

    if (presented) {
      outputContext.drawImage(video, 0, 0, width, height);
      return;
    }
    if (!segmenter) return;
    if (timestamp <= previousTimestamp) timestamp = previousTimestamp + 1;
    previousTimestamp = timestamp;
    try {
      const result = segmenter.segmentForVideo(video, timestamp);
      const categoryMask = result.categoryMask;
      if (!categoryMask || categoryMask.width <= 0 || categoryMask.height <= 0) return;
      const maskWidth = categoryMask.width;
      const maskHeight = categoryMask.height;
      const categories = categoryMask.getAsUint8Array();
      const rgba = new Uint8ClampedArray(maskWidth * maskHeight * 4);
      for (let i = 0; i < maskWidth * maskHeight; i += 1) {
        const isPerson = (categories[i] ?? 0) !== 0;
        const offset = i * 4;
        rgba[offset] = 255;
        rgba[offset + 1] = 255;
        rgba[offset + 2] = 255;
        rgba[offset + 3] = isPerson ? 255 : 0;
      }
      const sourceMask = document.createElement("canvas");
      sourceMask.width = maskWidth;
      sourceMask.height = maskHeight;
      const sourceContext = sourceMask.getContext("2d");
      if (!sourceContext) return;
      sourceContext.putImageData(new ImageData(rgba, maskWidth, maskHeight), 0, 0);

      // Keep the feathered mask at no more than 2x the segmenter's native mask dimensions.
      const featherWidth = Math.min(width, maskWidth * 2);
      const featherHeight = Math.min(height, maskHeight * 2);
      if (maskCanvas.width !== featherWidth || maskCanvas.height !== featherHeight) {
        maskCanvas.width = featherWidth;
        maskCanvas.height = featherHeight;
      }
      maskContext.clearRect(0, 0, featherWidth, featherHeight);
      maskContext.filter = "blur(3px)";
      maskContext.drawImage(sourceMask, 0, 0, featherWidth, featherHeight);
      maskContext.filter = "none";
      liveContext.clearRect(0, 0, width, height);
      liveContext.drawImage(video, 0, 0, width, height);
      liveContext.globalCompositeOperation = "destination-in";
      liveContext.drawImage(maskCanvas, 0, 0, width, height);
      liveContext.globalCompositeOperation = "source-over";
      outputContext.drawImage(liveCanvas, 0, 0, width, height);
      categoryMask.close?.();
    } catch (error) {
      console.error("Segmentation failed for this frame:", error);
    }
  };

  return {
    start(): void {
      if (loadFailed || !segmenter || running) return;
      running = true;
      frameId = requestAnimationFrame(drawFrame);
    },
    stop(): void {
      running = false;
      cancelAnimationFrame(frameId);
      segmenter?.close();
      segmenter = null;
    },
    setPresented(value: boolean): void {
      presented = value;
      stateElement.textContent = `PRESENCE: ${value ? "DETECTED" : "LOST"}`;
    },
  };
}
