/** Bind the in-memory clean-room plate capture control. */
export function bindPlateCapture(): void {
  const captureButton = document.getElementById("capture-plate");
  const video = document.getElementById("source-video");
  const thumbnail = document.getElementById("plate-thumb");
  const state = document.getElementById("plate-state");
  const placeholder = document.getElementById("plate-placeholder");

  if (
    !(captureButton instanceof HTMLButtonElement) ||
    !(video instanceof HTMLVideoElement) ||
    !(thumbnail instanceof HTMLImageElement) ||
    !(state instanceof HTMLElement)
  ) {
    throw new Error("Plate capture controls are missing from the page.");
  }

  // Keep the control available so a click without a camera can report why capture is unavailable.
  captureButton.disabled = false;
  let capturing = false;

  const hasActiveStream = (): boolean => {
    const stream = video.srcObject;
    return (
      stream instanceof MediaStream &&
      stream.active &&
      stream.getVideoTracks().some((track) => track.readyState === "live")
    );
  };

  captureButton.addEventListener("click", async () => {
    if (capturing) return;

    capturing = true;
    captureButton.disabled = true;
    let canvas: HTMLCanvasElement | null = null;

    try {
      if (!hasActiveStream()) {
        state.textContent = "No active camera stream. Connect the camera before capturing.";
        return;
      }
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        state.textContent = "The camera stream is not ready yet. Wait for a live frame and try again.";
        return;
      }

      for (let seconds = 3; seconds > 0; seconds -= 1) {
        if (!hasActiveStream()) {
          state.textContent = "The camera stream ended before capture. Connect it again and retry.";
          return;
        }
        state.textContent = `Capturing clean room in ${seconds}…`;
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
      }

      if (!hasActiveStream() || video.videoWidth === 0 || video.videoHeight === 0) {
        state.textContent = "No active camera frame is available. Connect the camera and try again.";
        return;
      }

      canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.setAttribute("aria-hidden", "true");
      canvas.style.position = "fixed";
      canvas.style.left = "-10000px";
      canvas.style.top = "0";
      canvas.style.visibility = "hidden";
      document.body.append(canvas);

      const context = canvas.getContext("2d");
      if (!context) throw new Error("A 2D canvas context is unavailable.");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      thumbnail.src = canvas.toDataURL("image/png");
      thumbnail.hidden = false;
      if (placeholder instanceof HTMLElement) placeholder.hidden = true;
      state.textContent = `Room plate captured (${canvas.width} × ${canvas.height}) in memory only; never saved.`;
    } catch {
      state.textContent = "Could not capture a frame. Check that the camera is active and try again.";
    } finally {
      canvas?.remove();
      capturing = false;
      captureButton.disabled = false;
    }
  });
}
