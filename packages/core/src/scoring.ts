import type { Finding, Impact } from "./report-schema.js";

// Deterministic severity score. Ranking is the product's core promise ("the
// five things to fix first"), so it must be explainable, stable between runs
// and free. An LLM would give none of those.
//
//   score = impactWeight × (1 + ln(occurrences)) × pageFactor × blockerBoost

export const IMPACT_WEIGHT: Record<Impact, number> = { critical: 10, serious: 6, moderate: 3, minor: 1 };
export const START_PAGE_FACTOR = 1.5;
export const BLOCKER_BOOST = 2;

const BLOCKER_CONTAINERS = new Set(["nav", "form", "group"]);

export interface ScoreInput {
  impact: Impact;
  occurrences: number;
  onStartPage: boolean;
  blocker: boolean;
}

export function severityScore(input: ScoreInput): number {
  const occurrences = Math.max(1, input.occurrences);
  const score =
    IMPACT_WEIGHT[input.impact] *
    // ln grows slowly: 50 copies of a header bug matter more than 1, but not 50x more.
    (1 + Math.log(occurrences)) *
    (input.onStartPage ? START_PAGE_FACTOR : 1) *
    (input.blocker ? BLOCKER_BOOST : 1);
  return Math.round(score * 100) / 100;
}

// Keyboard traps always block; an unreachable element blocks when it sits in
// navigation, a form or a button group, because that cuts off a whole task.
export function isBlocker(ruleId: string, findings: Pick<Finding, "data">[]): boolean {
  if (ruleId === "a11y-keyboard-trap") return true;
  if (ruleId !== "a11y-unreachable") return false;
  return findings.some((f) => BLOCKER_CONTAINERS.has(String(f.data.container)));
}

const IMPACT_ORDER: Impact[] = ["critical", "serious", "moderate", "minor"];

export function highestImpact(impacts: Impact[]): Impact {
  return IMPACT_ORDER.find((level) => impacts.includes(level)) ?? "minor";
}

export interface Rankable {
  severityScore: number;
  impact: Impact;
  occurrenceCount: number;
  groupKey: string;
}

// Score descending; ties broken by impact, then occurrences, then group key,
// so the same scan always produces the same order.
export function compareIssues(a: Rankable, b: Rankable): number {
  return (
    b.severityScore - a.severityScore ||
    IMPACT_WEIGHT[b.impact] - IMPACT_WEIGHT[a.impact] ||
    b.occurrenceCount - a.occurrenceCount ||
    a.groupKey.localeCompare(b.groupKey)
  );
}
