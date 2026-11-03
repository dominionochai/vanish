import type { EvidenceSample, VerificationSummary } from "./types";

const REQUIRED_FRAMES = 3 as const;

/** Keep the current signal scaffold conservative: evidence never implies identity or absence. */
export function summarizeEvidence(samples: readonly EvidenceSample[]): VerificationSummary {
  const evidenceCount = samples.length;
  const note =
    evidenceCount < REQUIRED_FRAMES
      ? `Collecting local evidence (${evidenceCount}/${REQUIRED_FRAMES} frames); absence is not asserted.`
      : "Signal measurements alone do not establish identity or prove absence.";

  return {
    status: "INCONCLUSIVE",
    evidenceCount,
    requiredFrames: REQUIRED_FRAMES,
    confidence: null,
    note,
  };
}
