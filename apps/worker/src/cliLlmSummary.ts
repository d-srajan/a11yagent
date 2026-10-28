import type { ScanReport } from "@a11yagent/core";

const wrap = (label: string, text: string): string => `      ${label.padEnd(10)} ${text}`;

// The LLM half of the terminal summary: explanations for the top issues, the
// alt reviewer's verdicts, and every agent step, so a fallback or a budget
// stop is visible without opening the JSON.
export function formatLlmSummary(report: ScanReport, top = 15): string {
  const llm = report.llm;
  if (!llm) return "";
  const lines: string[] = ["", "Explanations:"];
  if (llm.explainer.status !== "ok") lines.push(`  Explanations ${llm.explainer.status}: ${llm.explainer.reason ?? "unknown reason"}`);
  for (const issue of report.issues.slice(0, top)) {
    const e = issue.explanation;
    lines.push(`  #${issue.rank} ${issue.ruleId} (${issue.impact}, ${issue.occurrenceCount}x)`);
    if (!e) {
      lines.push(wrap("", "(explanation unavailable)"));
      continue;
    }
    lines.push(wrap("Title", e.title), wrap("What", e.explanation), wrap("Who", e.whoIsAffected), wrap("Fix", e.howToFix));
  }

  lines.push("", `Alt-text review: ${llm.altReview.status}, ${llm.altReview.reviewed} reviewed, ${llm.altReview.skipped} not reviewed${llm.altReview.reason ? ` (${llm.altReview.reason})` : ""}`);
  for (const c of report.altCandidates) {
    const r = c.review;
    lines.push(`  "${c.alt}" on ${new URL(c.pageUrl).pathname}: ${r ? `${r.verdict}${r.suggestedAlt ? ` -> "${r.suggestedAlt}"` : ""} (${r.reason})` : "not reviewed"}`);
  }

  lines.push("", `LLM usage: ${llm.usage.calls} calls, ${llm.usage.tokensIn} tokens in, ${llm.usage.tokensOut} tokens out`, "Agent steps:");
  for (const s of llm.steps) {
    const who = s.kind === "llm" ? `${s.provider}/${s.model}` : "tool";
    const cost = s.kind === "llm" && s.error === null ? ` ${s.tokensIn}/${s.tokensOut} tok` : "";
    lines.push(`  ${s.agent.padEnd(12)} ${String(s.step).padStart(2)} ${s.kind.padEnd(4)} ${s.name.padEnd(22)} ${who}${cost} ${s.latencyMs ?? "-"}ms${s.error ? ` ERROR ${s.error.slice(0, 120)}` : ""}`);
  }
  return lines.join("\n");
}
