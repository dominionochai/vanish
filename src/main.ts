/// <reference types="vite/client" />

import "./styles.css";
import { bindModeTabs } from "./ui";
import { bindCameraControls } from "./camera";
import { bindPlateCapture, getCapturedPlate } from "./plate";
import { initializeLivePipeline } from "./pipeline";

bindModeTabs();
bindCameraControls();
bindPlateCapture();

const video = document.getElementById("source-video");
const outputCanvas = document.getElementById("stage");
const stateElement = document.getElementById("frame-state");

if (
  !(video instanceof HTMLVideoElement) ||
  !(outputCanvas instanceof HTMLCanvasElement) ||
  !(stateElement instanceof HTMLElement)
) {
  throw new Error("The live pipeline elements are missing from the page.");
}

async function startLivePipelineWhenReady(): Promise<void> {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await new Promise<void>((resolve) => {
      video.addEventListener("playing", () => resolve(), { once: true });
    });
  }

  while (!getCapturedPlate()) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  outputCanvas.hidden = false;
  video.style.display = "none";

  const pipeline = await initializeLivePipeline(
    video,
    outputCanvas,
    getCapturedPlate,
    stateElement,
  );
  pipeline.start();
}

void startLivePipelineWhenReady();
