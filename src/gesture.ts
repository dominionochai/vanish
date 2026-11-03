import type { GestureEstimate, GesturePoint } from "./types";

const TAP_RADIUS_PX = 24;
const HOLD_DURATION_MS = 600;

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
    distance >= TAP_RADIUS_PX ? "swipe" : durationMs >= HOLD_DURATION_MS ? "hold" : "tap";
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
