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
