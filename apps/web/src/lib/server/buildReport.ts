import type { Impact } from "@a11yagent/core";
import type { IssueView, PageView, ReportView, StepView } from "../scan-view";
import { summarizeInput, summarizeOutput } from "../step-summary";
import type { FindingRow, IssueRow, PageRow, StepRow } from "./rows";

export interface ReportRows {
  scan: { llm_calls: number; tokens_in: number; tokens_out: number; created_at: string; finished_at: string | null };
  pages: PageRow[];
  findings: FindingRow[];
  issues: IssueRow[];
  steps: StepRow[];
  // screenshot_path -> short-lived signed URL
  screenshotUrls: Map<string, string>;
}

const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const sum = (values: Record<string, number> | null): number => Object.values(values ?? {}).reduce((a, b) => a + b, 0);

// Pure mapping from database rows to the report the page renders. The
// explanation fields fall back to the scanner's own text, so an issue card
// still says something useful when the LLM part was unavailable.
export function buildReport(rows: ReportRows): ReportView {
  const findingById = new Map(rows.findings.map((f) => [f.id, f]));
  const pageById = new Map(rows.pages.map((p) => [p.id, p]));

  const issues: IssueView[] = rows.issues.map((issue) => {
    const example = issue.finding_ids.map((id) => findingById.get(id)).find((f) => f !== undefined) ?? null;
    return {
      id: issue.id,
      rank: issue.rank,
      ruleId: issue.rule_id,
      impact: issue.impact,
      severityScore: issue.severity_score,
      occurrenceCount: issue.occurrence_count,
      pageCount: issue.page_count,
      title: issue.title,
      explanation: issue.explanation,
      whoIsAffected: issue.who_is_affected,
      howToFix: issue.how_to_fix,
      help: str(example?.data.help) ?? example?.message ?? null,
      helpUrl: str(example?.data.helpUrl),
      exampleHtml: example?.html_snippet ?? null,
      exampleSelector: example?.selector ?? null,
      examplePageUrl: example ? (pageById.get(example.page_id)?.url ?? null) : null,
    };
  });

  const findingsPerPage = new Map<string, number>();
  for (const f of rows.findings) findingsPerPage.set(f.page_id, (findingsPerPage.get(f.page_id) ?? 0) + 1);

  const pages: PageView[] = rows.pages.map((p) => ({
    url: p.url,
    title: p.title,
    httpStatus: p.http_status,
    screenshotUrl: p.screenshot_path ? (rows.screenshotUrls.get(p.screenshot_path) ?? null) : null,
    findingCount: findingsPerPage.get(p.id) ?? 0,
    needsReview: sum(p.needs_review),
  }));

  const byRule = new Map<string, number>();
  for (const p of rows.pages) for (const [rule, n] of Object.entries(p.needs_review ?? {})) byRule.set(rule, (byRule.get(rule) ?? 0) + n);
  const needsReviewByRule = [...byRule].map(([ruleId, count]) => ({ ruleId, count })).sort((a, b) => b.count - a.count);

  const steps: StepView[] = rows.steps.map((s) => ({
    id: s.id,
    agent: s.agent,
    step: s.step,
    kind: s.kind,
    name: s.name,
    provider: s.provider,
    model: s.model,
    latencyMs: s.latency_ms,
    tokensIn: s.tokens_in,
    tokensOut: s.tokens_out,
    error: s.error,
    inputSummary: summarizeInput(s.kind, s.input),
    outputSummary: summarizeOutput(s.kind, s.output),
  }));

  const issuesByImpact: Record<Impact, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const issue of issues) issuesByImpact[issue.impact] += 1;
  const { scan } = rows;

  return {
    summary: {
      pages: pages.length,
      issues: issues.length,
      findings: rows.findings.length,
      issuesByImpact,
      needsReview: pages.reduce((n, p) => n + p.needsReview, 0),
      llmCalls: scan.llm_calls,
      tokensIn: scan.tokens_in,
      tokensOut: scan.tokens_out,
      durationMs: scan.finished_at ? Date.parse(scan.finished_at) - Date.parse(scan.created_at) : null,
    },
    explanationsAvailable: issues.some((i) => i.title !== null),
    issues,
    pages,
    needsReviewByRule,
    steps,
  };
}
