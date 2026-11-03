export type PresenceState = "detected" | "lost";

export interface PipelineHandle {
  start(): void;
  stop(): void;
  setPresented(present: boolean): void;
}

export interface VerifySignal {
  name: string;
  value: number;
  unit: string;
  passed: boolean;
}

export type VerifyVerdict = "PRESENT" | "ABSENT" | "INCONCLUSIVE";

export interface VerifyResult {
  verdict: VerifyVerdict;
  confidence: number;
  signals: VerifySignal[];
}
