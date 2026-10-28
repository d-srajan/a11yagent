import { EVIDENCE_KINDS, type EvidenceKind } from "./evidence.js";
import type { MatchResult } from "./match.js";

export const TARGETS = { recall: 0.9, controlFalsePositives: 0, altCorrect: 5, llmCallsPerScan: 25 } as const;

// Only with --llm. Cost is the scan pipeline's own usage; the eval's extra
// "direct" alt reviews are reported apart because a real scan never makes them.
export interface LlmMetrics {
  altCorrect: number;
  altTotal: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  explained: number;
  explainable: number;
  explainerStatus: string;
  extraEvalCalls: number;
  passed: boolean;
}

export interface Metrics {
  planted: number;
  detected: number;
  // detected / planted, counting every evidence kind.
  recall: number;
  // Only real findings count. Lower until Phase 3 turns alt candidates into
  // findings; tracked so that gap stays visible.
  findingRecall: number;
  detectedBy: Record<EvidenceKind, number>;
  // Anything reported on a control page, of any kind. The same kinds count
  // toward recall, so a looser check can't raise recall without paying here.
  controlFalsePositives: number;
  // Reported on a planted page but matching no planted issue. Not a target
  // (the fixture can contain real issues nobody planted), but a jump here
  // after a change is worth a look.
  unmatchedEvidence: number;
  llm: LlmMetrics | null;
  passed: boolean;
}

export function computeMetrics(result: MatchResult, llm: Omit<LlmMetrics, "passed"> | null = null): Metrics {
  const planted = result.entries.length;
  const detectedBy = Object.fromEntries(EVIDENCE_KINDS.map((k) => [k, 0])) as Record<EvidenceKind, number>;
  for (const { evidence } of result.entries) if (evidence) detectedBy[evidence.kind] += 1;
  const detected = EVIDENCE_KINDS.reduce((sum, k) => sum + detectedBy[k], 0);
  const recall = planted === 0 ? 0 : detected / planted;
  const controlFalsePositives = result.control.length;
  const llmMetrics = llm ? { ...llm, passed: llm.altCorrect >= TARGETS.altCorrect && llm.calls <= TARGETS.llmCallsPerScan } : null;
  return {
    planted,
    detected,
    recall,
    findingRecall: planted === 0 ? 0 : detectedBy.finding / planted,
    detectedBy,
    controlFalsePositives,
    unmatchedEvidence: result.unmatched.length,
    llm: llmMetrics,
    passed: recall >= TARGETS.recall && controlFalsePositives <= TARGETS.controlFalsePositives && (llmMetrics?.passed ?? true),
  };
}
