import type { VerifyResult, VerifySignal, VerifyVerdict } from "./types";

const ANALYSIS_WIDTH = 160;
const ANALYSIS_HEIGHT = 120;
const BUFFER_SIZE = 30;
const SAMPLE_INTERVAL_MS = 500;

export interface Verifier {
  start(): void;
  stop(): void;
  latest(): VerifyResult | null;
  onResult(cb: (result: VerifyResult) => void): void;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function createVerifier(video: HTMLVideoElement, canvas: HTMLCanvasElement): Verifier {
  canvas.width = ANALYSIS_WIDTH;
  canvas.height = ANALYSIS_HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const frames: Uint8ClampedArray[] = [];
  const greenMeans: number[] = [];
  let rafId = 0;
  let running = false;
  let lastSample = 0;
  let current: VerifyResult | null = null;
  const listeners: Array<(result: VerifyResult) => void> = [];

  function sample(): void {
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
    const data = ctx.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT).data;
    frames.push(data);
    if (frames.length > BUFFER_SIZE) frames.shift();

    let greenSum = 0;
    let count = 0;
    const startY = Math.floor(ANALYSIS_HEIGHT * 0.25);
    const endY = Math.floor(ANALYSIS_HEIGHT * 0.75);
    const startX = Math.floor(ANALYSIS_WIDTH * 0.3);
    const endX = Math.floor(ANALYSIS_WIDTH * 0.7);
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const offset = (y * ANALYSIS_WIDTH + x) * 4;
        greenSum += data[offset + 1];
        count += 1;
      }
    }
    greenMeans.push(count > 0 ? greenSum / count : 0);
    if (greenMeans.length > BUFFER_SIZE) greenMeans.shift();
  }

  function noiseFloor(): number {
    if (frames.length < 2) return Number.NaN;
    let total = 0;
    let pixels = 0;
    const bandHeight = Math.max(1, Math.floor(ANALYSIS_HEIGHT * 0.15));
    for (let i = 1; i < frames.length; i += 1) {
      const a = frames[i - 1];
      const b = frames[i];
      for (let y = 0; y < bandHeight; y += 1) {
        for (let x = 0; x < ANALYSIS_WIDTH; x += 1) {
          const offset = (y * ANALYSIS_WIDTH + x) * 4;
          total += Math.abs(a[offset] - b[offset]);
          total += Math.abs(a[offset + 1] - b[offset + 1]);
          total += Math.abs(a[offset + 2] - b[offset + 2]);
          pixels += 3;
        }
      }
    }
    return pixels > 0 ? total / pixels : Number.NaN;
  }

  function edgeFringing(): number {
    if (frames.length === 0) return Number.NaN;
    const data = frames[frames.length - 1];
    const midX = Math.floor(ANALYSIS_WIDTH / 2);
    const spanX = Math.floor(ANALYSIS_WIDTH * 0.2);
    let midStrength = 0;
    let strongStrength = 0;
    let samples = 0;
    for (let x = midX - spanX; x < midX + spanX; x += 1) {
      for (let y = 1; y < ANALYSIS_HEIGHT - 1; y += 1) {
        const offset = (y * ANALYSIS_WIDTH + x) * 4;
        const above = ((y - 1) * ANALYSIS_WIDTH + x) * 4;
        const below = ((y + 1) * ANALYSIS_WIDTH + x) * 4;
        const gradient =
          Math.abs(data[offset] - data[above]) +
          Math.abs(data[offset] - data[below]);
        if (gradient > 12 && gradient <= 45) midStrength += 1;
        if (gradient > 45) strongStrength += 1;
        samples += 1;
      }
    }
    if (samples === 0) return Number.NaN;
    const midRatio = midStrength / samples;
    const strongRatio = strongStrength / samples;
    return strongRatio > 0 ? midRatio / (midRatio + strongRatio) : 0;
  }

  function breathingBand(): number {
    if (greenMeans.length < 8) return Number.NaN;
    const values = greenMeans.slice();
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    if (!Number.isFinite(mean)) return Number.NaN;
    let energy = 0;
    let energyOut = 0;
    const sampleRate = 1000 / SAMPLE_INTERVAL_MS;
    for (let i = 1; i < values.length - 1; i += 1) {
      const band = values[i] - (values[i - 1] + values[i + 1]) / 2;
      energy += band * band;
      const drift = values[i] - mean;
      energyOut += drift * drift;
    }
    if (energyOut <= 0) return Number.NaN;
    const ratio = energy / energyOut;
    return Number.isFinite(ratio) ? ratio * sampleRate : Number.NaN;
  }

  function analyse(): void {
    const noise = noiseFloor();
    const fringing = edgeFringing();
    const breathing = breathingBand();

    const signals: VerifySignal[] = [
      { name: "noise_floor", value: noise, unit: "mean abs diff", passed: Number.isFinite(noise) ? noise > 0.6 : false },
      { name: "edge_fringing", value: fringing, unit: "mid/strong ratio", passed: Number.isFinite(fringing) ? fringing < 0.85 : false },
      { name: "breathing_band", value: breathing, unit: "band energy", passed: Number.isFinite(breathing) ? breathing > 0.02 : false },
    ];

    const finite = signals.every((s) => Number.isFinite(s.value));
    if (!finite) {
      current = { verdict: "INCONCLUSIVE", confidence: 0, signals };
      emit();
      return;
    }

    const passed = signals.filter((s) => s.passed).length;
    let verdict: VerifyVerdict;
    if (passed === 3) verdict = "PRESENT";
    else if (passed === 0) verdict = "ABSENT";
    else verdict = "INCONCLUSIVE";

    const confidence = clamp01(Math.abs(passed - 1.5) / 1.5);
    current = { verdict, confidence, signals };
    emit();
  }

  function emit(): void {
    if (!current) return;
    for (const listener of listeners) {
      try {
        listener(current);
      } catch (error) {
        console.error("Verifier listener threw", error);
      }
    }
  }

  function loop(): void {
    if (!running) return;
    const now = performance.now();
    if (now - lastSample >= SAMPLE_INTERVAL_MS) {
      lastSample = now;
      sample();
      if (frames.length >= 4) analyse();
    }
    rafId = requestAnimationFrame(loop);
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      lastSample = 0;
      rafId = requestAnimationFrame(loop);
    },
    stop(): void {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    },
    latest(): VerifyResult | null {
      return current;
    },
    onResult(cb: (result: VerifyResult) => void): void {
      listeners.push(cb);
    },
  };
}
