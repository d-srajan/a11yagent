import type { ScanReport } from "@a11yagent/core";
import { toAgentStepRow } from "./agentSteps.js";

// Pure mapping from the ScanReport (the same object the CLI writes to JSON)
// onto the pages / findings / issues / agent_steps tables. Ids are generated
// by the scanner, so foreign keys line up without a round trip per row.

type Row = Record<string, unknown>;

export interface ReportRows {
  pages: Row[];
  findings: Row[];
  issues: Row[];
  steps: Row[];
}

export function reportToRows(scanId: string, report: ScanReport): ReportRows {
  // Rows inserted together share now(); spacing created_at by 1 ms per page
  // keeps the crawl order (start page first) when the report sorts by it.
  const base = Date.parse(report.startedAt);
  const pages = report.pages.map((p, i) => ({
    id: p.id,
    scan_id: scanId,
    url: p.url,
    title: p.title,
    http_status: p.httpStatus,
    screenshot_path: p.screenshotPath,
    // incompleteByRule rides along so the report can show "needs human
    // review" counts by selecting axe_raw->incompleteByRule, not the whole blob.
    axe_raw: { incompleteByRule: p.incompleteByRule, ...(p.axeRaw && typeof p.axeRaw === "object" ? p.axeRaw : {}) },
    keyboard_result: p.keyboard,
    created_at: new Date(base + i).toISOString(),
  }));

  const findings = report.findings.map((f) => ({
    id: f.id,
    scan_id: scanId,
    page_id: f.pageId,
    source: f.source,
    rule_id: f.ruleId,
    impact: f.impact,
    wcag: f.wcag,
    selector: f.selector,
    html_snippet: f.htmlSnippet,
    message: f.message,
    data: f.data,
  }));

  const issues = report.issues.map((issue) => ({
    id: issue.id,
    scan_id: scanId,
    rule_id: issue.ruleId,
    group_key: issue.groupKey,
    impact: issue.impact,
    severity_score: issue.severityScore,
    rank: issue.rank,
    occurrence_count: issue.occurrenceCount,
    page_count: issue.pageCount,
    finding_ids: issue.findingIds,
    title: issue.explanation?.title ?? null,
    explanation: issue.explanation?.explanation ?? null,
    who_is_affected: issue.explanation?.whoIsAffected ?? null,
    how_to_fix: issue.explanation?.howToFix ?? null,
  }));

  // A step may point at an issue that re-ranking dropped; the FK would reject it.
  const issueIds = new Set(report.issues.map((i) => i.id));
  const steps = (report.llm?.steps ?? []).map((s) => toAgentStepRow({ ...s, scanId, issueId: s.issueId && issueIds.has(s.issueId) ? s.issueId : null }));

  return { pages, findings, issues, steps };
}
