export type AppMode = "vanish" | "verify";

export type SignalId = "temporal-noise" | "mask-edge-fringing" | "green-band-energy";

export type SignalState = "collecting" | "weak" | "available";

export interface SignalReading {
  readonly id: SignalId;
  readonly value: number | null;
  readonly confidence: number;
  readonly state: SignalState;
}

export interface EvidenceSample {
  readonly capturedAt: number;
  readonly readings: readonly SignalReading[];
}

export interface VerificationSummary {
  readonly status: "INCONCLUSIVE";
  readonly evidenceCount: number;
  readonly requiredFrames: 3;
  readonly confidence: null;
  readonly note: string;
}

export interface FrameSnapshot {
  readonly image: ImageData;
  readonly capturedAt: number;
}

export interface GesturePoint {
  readonly x: number;
  readonly y: number;
  readonly timeMs: number;
}

export interface GestureEstimate {
  readonly kind: "tap" | "hold" | "swipe";
  readonly deltaX: number;
  readonly deltaY: number;
  readonly durationMs: number;
  readonly confidence: number;
}
