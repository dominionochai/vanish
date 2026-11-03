/** Wire the existing camera controls to a local getUserMedia preview. */
export function bindCameraControls(): void {
  const startButton = document.getElementById("start-camera");
  const stopButton = document.getElementById("stop-camera");
  const video = document.getElementById("source-video");
  const canvas = document.getElementById("stage");
  const emptyState = document.getElementById("stage-empty");
  const sourceLabel = document.getElementById("source-label");
  const resolutionLabel = document.getElementById("resolution-label");
  const controls = document.querySelector("#vanish-panel .control-row");

  if (
    !(startButton instanceof HTMLButtonElement) ||
    !(stopButton instanceof HTMLButtonElement) ||
    !(video instanceof HTMLVideoElement) ||
    !(canvas instanceof HTMLCanvasElement) ||
    !(emptyState instanceof HTMLElement) ||
    !(sourceLabel instanceof HTMLElement) ||
    !(resolutionLabel instanceof HTMLElement) ||
    !(controls instanceof HTMLElement)
  ) {
    throw new Error("Camera controls or preview elements are missing from the page.");
  }

  const status = document.createElement("p");
  status.className = "notice";
  status.id = "camera-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = "Camera is not connected.";
  controls.insertAdjacentElement("afterend", status);

  let activeStream: MediaStream | null = null;
  let requesting = false;

  video.muted = true;
  video.playsInline = true;
  stopButton.disabled = true;

  const resetPreview = (): void => {
    video.pause();
    video.srcObject = null;
    video.style.removeProperty("display");
    canvas.hidden = false;
    emptyState.hidden = false;
    sourceLabel.textContent = "SOURCE: NONE";
    resolutionLabel.textContent = "INPUT: —";
  };

  const stopCamera = (message: string): void => {
    const stream = activeStream;
    activeStream = null;
    stream?.getTracks().forEach((track) => track.stop());
    resetPreview();
    startButton.disabled = false;
    stopButton.disabled = true;
    status.textContent = message;
  };

  const updateResolution = (): void => {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      resolutionLabel.textContent = `INPUT: ${video.videoWidth} × ${video.videoHeight}`;
    }
  };

  const cameraErrorMessage = (error: unknown): string => {
    const name = error instanceof Error ? error.name : "";
    switch (name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Camera permission was denied or blocked. Allow camera access for this site in your browser settings, then try again.";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "No camera was found. Connect a camera and try again.";
      case "NotReadableError":
      case "TrackStartError":
        return "The camera could not start or is already in use. Close other apps using it and try again.";
      case "OverconstrainedError":
        return "The camera cannot meet the requested settings. Check the camera and try again.";
      case "AbortError":
        return "Camera startup was interrupted. Try connecting again.";
      default:
        return "Could not start the camera. Check browser permissions and that a camera is connected, then try again.";
    }
  };

  const startCamera = async (): Promise<void> => {
    if (activeStream || requesting) return;

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      status.textContent = "Camera access is unavailable here. Open this page over HTTPS or localhost in a supported browser.";
      return;
    }

    requesting = true;
    startButton.disabled = true;
    status.textContent = "Requesting camera access. Choose Allow if your browser asks.";

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      activeStream = stream;
      video.srcObject = stream;

      const videoTrack = stream.getVideoTracks()[0];
      videoTrack?.addEventListener("ended", () => {
        if (activeStream === stream) {
          stopCamera("Camera disconnected. Connect it again to resume the live preview.");
        }
      });

      await video.play();
      video.style.display = "block";
      canvas.hidden = true;
      emptyState.hidden = true;
      sourceLabel.textContent = "SOURCE: CAMERA";
      resolutionLabel.textContent = "INPUT: —";
      updateResolution();
      video.addEventListener("loadedmetadata", updateResolution, { once: true });
      stopButton.disabled = false;
      status.textContent = "Live camera preview connected. Video stays in this browser.";
    } catch (error) {
      if (activeStream === stream) activeStream = null;
      stream?.getTracks().forEach((track) => track.stop());
      resetPreview();
      stopButton.disabled = true;
      status.textContent = cameraErrorMessage(error);
    } finally {
      requesting = false;
      startButton.disabled = activeStream !== null;
    }
  };

  startButton.addEventListener("click", () => void startCamera());
  stopButton.addEventListener("click", () => {
    if (activeStream) {
      stopCamera("Camera disconnected. No video leaves your browser. Connect again to resume.");
    }
  });
}
