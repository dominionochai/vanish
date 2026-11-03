import type { VerifyResult, VerifySignal } from "./types";

interface Sample {
  pixels: Uint8ClampedArray;
  centreGreen: number;
}

const WIDTH = 160;
const HEIGHT = 120;
const SAMPLE_INTERVAL_MS = 500;
const BUFFER_LENGTH = 30;
const NOISE_THRESHOLD = 1.2;
const FRINGING_THRESHOLD = 0.65;
const BREATHING_RMS_THRESHOLD = 0.35;
const SAMPLE_RATE_HZ = 1000 / SAMPLE_INTERVAL_MS;

function meanGreenInCentre(pixels: Uint8ClampedArray): number {
  const x0 = Math.floor(WIDTH * 0.35);
  const x1 = Math.ceil(WIDTH * 0.65);
  const y0 = Math.floor(HEIGHT * 0.25);
  const y1 = Math.ceil(HEIGHT * 0.78);
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      sum += pixels[(y * WIDTH + x) * 4 + 1] ?? 0;
      count += 1;
    }
  }
  return count ? sum / count : 0;
}

function noiseFloor(samples: Sample[]): number {
  if (samples.length < 2) return 0;
  const topHeight = Math.max(1, Math.floor(HEIGHT * 0.15));
  let total = 0;
  let comparisons = 0;
  for (let frame = 1; frame < samples.length; frame += 1) {
    const previous = samples[frame - 1]?.pixels;
    const current = samples[frame]?.pixels;
    if (!previous || !current) continue;
    for (let y = 0; y < topHeight; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const index = (y * WIDTH + x) * 4;
        total += Math.abs((current[index] ?? 0) - (previous[index] ?? 0));
        total += Math.abs((current[index + 1] ?? 0) - (previous[index + 1] ?? 0));
        total += Math.abs((current[index + 2] ?? 0) - (previous[index + 2] ?? 0));
        comparisons += 3;
      }
    }
  }
  return comparisons ? total / comparisons : 0;
}

function edgeFringing(pixels: Uint8ClampedArray): number {
  const x0 = Math.max(1, Math.floor(WIDTH * 0.35));
  const x1 = Math.min(WIDTH - 1, Math.ceil(WIDTH * 0.65));
  let midEdges = 0;
  let strongEdges = 0;
  for (let y = 1; y < HEIGHT - 1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const left = ((y * WIDTH + x - 1) * 4);
      const right = ((y * WIDTH + x + 1) * 4);
      const above = (((y - 1) * WIDTH + x) * 4);
      const below = (((y + 1) * WIDTH + x) * 4);
      const luminance = (index: number): number =>
        (pixels[index] ?? 0) * 0.299 + (pixels[index + 1] ?? 0) * 0.587 + (pixels[index + 2] ?? 0) * 0.114;
      const dx = (luminance(right) - luminance(left)) / 2;
      const dy = (luminance(below) - luminance(above)) / 2;
      const magnitude = Math.sqrt(dx * dx + dy * dy);
      if (magnitude >= 8 && magnitude < 40) midEdges += 1;
      else if (magnitude >= 40) strongEdges += 1;
    }
  }
  const edgeCount = midEdges + strongEdges;
  return edgeCount ? midEdges / edgeCount : 0;
}

function breathingBand(samples: Sample[]): number {
  const values = samples.map((sample) => sample.centreGreen);
  const n = values.length;
  if (n < 6) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  let power = 0;
  let bins = 0;
  for (let k = 1; k <= Math.floor(n / 2); k += 1) {
    const frequency = (k * SAMPLE_RATE_HZ) / n;
    if (frequency < 0.1 || frequency > 0.5) continue;
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < n; index += 1) {
      const value = (values[index] ?? 0) - mean;
      const angle = (2 * Math.PI * k * index) / n;
      real += value * Math.cos(angle);
      imaginary -= value * Math.sin(angle);
    }
    power += (real * real + imaginary * imaginary) / (n * n);
    bins += 1;
  }
  return bins ? Math.sqrt((2 * power) / bins) : 0;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function makeResult(samples: Sample[]): VerifyResult {
  const current = samples[samples.length - 1]?.pixels ?? new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const noise = noiseFloor(samples);
  const fringing = edgeFringing(current);
  const breathing = breathingBand(samples);
  const passed = [
    noise > NOISE_THRESHOLD,
    fringing < FRINGING_THRESHOLD,
    breathing > BREATHING_RMS_THRESHOLD,
  ];
  const allPass = passed.every(Boolean);
  const allFail = passed.every((value) => !value);
  const verdict = allPass ? "PRESENT" : allFail ? "ABSENT" : "INCONCLUSIVE";
  const margins = [
    (noise - NOISE_THRESHOLD) / Math.max(noise + NOISE_THRESHOLD, 1),
    (FRINGING_THRESHOLD - fringing) / Math.max(FRINGING_THRESHOLD, 0.01),
    (breathing - BREATHING_RMS_THRESHOLD) / Math.max(breathing + BREATHING_RMS_THRESHOLD, 0.01),
  ];
  const consensus = margins.reduce((sum, value) => sum + value, 0) / margins.length;
  const confidence = allPass || allFail
    ? clamp01(0.5 + Math.abs(consensus) * 0.5)
    : clamp01(0.5 + Math.abs(consensus) * 0.25);
  const signals: VerifySignal[] = [
    { name: "noise_floor", value: noise, unit: "mean absolute RGB delta", passed: passed[0] ?? false },
    { name: "edge_fringing", value: fringing, unit: "mid-edge proportion", passed: passed[1] ?? false },
    { name: "breathing_band", value: breathing, unit: "green-channel RMS", passed: passed[2] ?? false },
  ];
  return { verdict, confidence, signals };
}

export function createVerifier(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): {
  start(): void;
  stop(): void;
  latest(): VerifyResult | null;
  onResult(cb: (r: VerifyResult) => void): void;
} {
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const samples: Sample[] = [];
  const callbacks: Array<(result: VerifyResult) => void> = [];
  let result: VerifyResult | null = null;
  let running = false;
  let frameId = 0;
  let lastSample = 0;

  const tick = (timestamp: number): void => {
    if (!running) return;
    frameId = requestAnimationFrame(tick);
    if (!context || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || timestamp - lastSample < SAMPLE_INTERVAL_MS) return;
    lastSample = timestamp;
    context.drawImage(video, 0, 0, WIDTH, HEIGHT);
    const pixels = context.getImageData(0, 0, WIDTH, HEIGHT).data;
    samples.push({ pixels: new Uint8ClampedArray(pixels), centreGreen: meanGreenInCentre(pixels) });
    if (samples.length > BUFFER_LENGTH) samples.shift();
    if (samples.length < 8) return;
    result = makeResult(samples);
    for (const callback of callbacks) callback(result);
  };

  return {
    start(): void {
      if (running) return;
      running = true;
      lastSample = 0;
      frameId = requestAnimationFrame(tick);
    },
    stop(): void {
      running = false;
      cancelAnimationFrame(frameId);
    },
    latest(): VerifyResult | null {
      return result;
    },
    onResult(callback: (value: VerifyResult) => void): void {
      callbacks.push(callback);
    },
  };
}
