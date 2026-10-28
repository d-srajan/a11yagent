import type { Evidence } from "./evidence.js";
import type { AltAccuracy } from "./altAccuracy.js";
import type { MatchResult } from "./match.js";
import { TARGETS, type Metrics } from "./metrics.js";

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const mark = (ok: boolean): string => (ok ? "PASS" : "FAIL");

function table(rows: string[][]): string {
  const widths = rows[0]?.map((_, c) => Math.max(...rows.map((r) => (r[c] ?? "").length))) ?? [];
  const line = (r: string[]): string => r.map((cell, c) => cell.padEnd(widths[c] ?? 0)).join("  ").trimEnd();
  const rule = widths.map((w) => "-".repeat(w)).join("  ");
  const [head, ...body] = rows;
  return [line(head ?? []), rule, ...body.map(line)].join("\n");
}

function llmRows(metrics: Metrics): string[][] {
  const llm = metrics.llm;
  if (!llm) return [];
  return [
    ["Alt verdict accuracy", `${llm.altCorrect}/${llm.altTotal}`, `>= ${TARGETS.altCorrect}`, mark(llm.altCorrect >= TARGETS.altCorrect)],
    ["LLM calls per scan", String(llm.calls), `<= ${TARGETS.llmCallsPerScan}`, mark(llm.calls <= TARGETS.llmCallsPerScan)],
    ["  output tokens per scan", String(llm.tokensOut), "", ""],
    ["  issues explained", `${llm.explained}/${llm.explainable} (${llm.explainerStatus})`, "info", ""],
    ["  extra eval-only calls", String(llm.extraEvalCalls), "info", ""],
  ];
}

const describe = (ev: Evidence): string => `${ev.page} ${ev.ruleId} ${ev.selector} (${ev.kind})`;

export function formatReport(metrics: Metrics, result: MatchResult, label: string, alt: AltAccuracy | null = null): string {
  const recallOk = metrics.recall >= TARGETS.recall;
  const fpOk = metrics.controlFalsePositives <= TARGETS.controlFalsePositives;
  const { finding, alt_candidate, needs_review } = metrics.detectedBy;
  const out = [
    `Eval: ${label}`,
    "",
    table([
      ["Metric", "Value", "Target", "Result"],
      ["Detection recall", `${metrics.detected}/${metrics.planted} (${pct(metrics.recall)})`, `>= ${pct(TARGETS.recall)}`, mark(recallOk)],
      ["Control false positives", String(metrics.controlFalsePositives), `= ${TARGETS.controlFalsePositives}`, mark(fpOk)],
      ["  detected as findings", `${finding} (${pct(metrics.findingRecall)})`, "", ""],
      ["  detected as alt candidates", String(alt_candidate), "", ""],
      ["  detected as needs review", String(needs_review), "", ""],
      ["Unmatched on planted pages", String(metrics.unmatchedEvidence), "info", ""],
      ...llmRows(metrics),
    ]),
  ];
  if (alt) {
    out.push("", "Alt verdicts:");
    for (const c of alt.cases) out.push(`  ${c.correct ? "ok  " : "MISS"} ${c.id.padEnd(24)} ${String(c.verdict ?? "none").padEnd(20)} want ${c.accept.join("|").padEnd(25)} via ${c.via}${c.suggestedAlt ? `  -> "${c.suggestedAlt}"` : ""}`);
  }
  const missed = result.entries.filter((e) => !e.evidence);
  if (missed.length > 0) {
    out.push("", "Missed planted issues:");
    for (const { entry } of missed) out.push(`  ${entry.id}  ${entry.page} ${entry.expected_rule} ${entry.selector}`);
  }
  if (result.control.length > 0) {
    out.push("", "False positives on control pages:");
    for (const ev of result.control) out.push(`  ${describe(ev)}`);
  }
  if (result.unmatched.length > 0) {
    out.push("", "Unmatched evidence on planted pages:");
    for (const ev of result.unmatched) out.push(`  ${describe(ev)}`);
  }
  out.push("", `Overall: ${mark(metrics.passed)}`);
  return out.join("\n");
}
