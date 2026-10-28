import type { AltReview, LlmSummary } from "../agent-schema.js";
import { groupFindings } from "../grouping.js";
import { Budget } from "../llm/budget.js";
import { LlmClient, type ChatTransport } from "../llm/client.js";
import type { LlmConfig } from "../llm/config.js";
import { createMemoryTrace, type TraceSink } from "../llm/trace.js";
import type { Logger } from "../logger.js";
import { ScanReport, type AltCandidate, type Finding } from "../report-schema.js";
import { openScanBrowser } from "../scanner/browser.js";
import { captureImage } from "../scanner/imageCapture.js";
import { reviewAltText } from "./altReviewer.js";
import { explainIssues, type ExplainResult } from "./explainer.js";

export interface EnrichOptions {
  config: LlmConfig;
  // LLM calls already made today across all scans (agent_steps count), for
  // DAILY_LLM_CALL_CAP. The CLI without a database passes 0.
  llmCallsToday: number;
  log: Logger;
  allowLocal: boolean;
  userAgent: string;
  scanId?: string;
  transport?: ChatTransport;
  sink?: TraceSink;
}

export const ALT_QUALITY_RULE = "a11y-alt-quality";

// Only verdicts that say "this alt text fails users" become findings; a
// "good" verdict quietly clears the deterministic candidate.
export function altFinding(candidate: AltCandidate, review: AltReview): Finding | null {
  if (review.verdict === "good") return null;
  const message = review.verdict === "should_be_decorative" ? `Alt text "${candidate.alt}" should be empty: ${review.reason}` : `Alt text "${candidate.alt}" does not describe the image: ${review.reason}`;
  return {
    id: crypto.randomUUID(),
    pageId: candidate.pageId,
    pageUrl: candidate.pageUrl,
    source: "alt_review",
    ruleId: ALT_QUALITY_RULE,
    impact: "moderate",
    wcag: ["1.1.1"],
    selector: candidate.selector,
    htmlSnippet: `<img src="${candidate.src}" alt="${candidate.alt.replace(/"/g, "&quot;")}">`,
    message,
    data: { verdict: review.verdict, suggestedAlt: review.suggestedAlt, reason: review.reason, candidateReasons: candidate.reasons },
  };
}

// Runs the LLM agents on a finished scan: alt review first (its findings
// change the issue list), then one explainer call over the final ranking.
// Never throws for LLM trouble: a part that can't run is marked unavailable
// and the rest of the report is returned as is.
export async function enrichReport(report: ScanReport, options: EnrichOptions): Promise<ScanReport> {
  const { config, log } = options;
  const limits = config.limits;
  const budget = new Budget({
    maxCalls: limits.MAX_LLM_CALLS_PER_SCAN,
    maxOutputTokens: limits.MAX_LLM_OUTPUT_TOKENS_PER_SCAN,
    dailyRemaining: Math.max(0, limits.DAILY_LLM_CALL_CAP - options.llmCallsToday),
  });
  const sink = options.sink ?? createMemoryTrace(options.scanId ?? crypto.randomUUID());
  const client = new LlmClient({ providers: config.providers, budget, log, timeoutMs: limits.LLM_TIMEOUT_MS, ...(options.transport ? { transport: options.transport } : {}) });

  // --- Alt review ---
  const candidates = report.altCandidates.map((c) => ({ ...c, review: null as AltReview | null }));
  const toReview = candidates.slice(0, limits.MAX_VISION_IMAGES);
  let reviewed = 0;
  let stopReason: string | null = null;
  const skipReasons: string[] = [];
  if (toReview.length > 0 && client.providersFor(true).length === 0) stopReason = "no LLM provider with a vision model is configured";
  if (toReview.length > 0 && !stopReason) {
    const browser = await openScanBrowser({ allowLocal: options.allowLocal, userAgent: options.userAgent, log });
    try {
      for (const candidate of toReview) {
        if (budget.exhausted || client.providersFor(true).length === 0) {
          stopReason = budget.exhausted ? "LLM budget used up" : "every vision provider failed";
          break;
        }
        const outcome = await reviewAltText(candidate, { client, sink, log, capture: (src) => captureImage(browser, src) });
        if (outcome.status === "reviewed") {
          candidate.review = outcome.review;
          reviewed += 1;
        } else if (outcome.status === "skipped") skipReasons.push(outcome.reason);
        else {
          stopReason = outcome.reason;
          break;
        }
      }
    } finally {
      await browser.close();
    }
  }
  const skipped = candidates.length - reviewed;
  const altStatus = toReview.length === 0 || reviewed === candidates.length ? "ok" : reviewed === 0 ? "unavailable" : "partial";
  const altReason = stopReason ?? skipReasons[0] ?? (candidates.length > toReview.length ? `only the first ${toReview.length} images are reviewed` : null);

  // --- Fold alt verdicts into findings and re-rank ---
  const altFindings = candidates.flatMap((c) => (c.review ? [altFinding(c, c.review)] : [])).filter((f): f is Finding => f !== null);
  const findings = [...report.findings, ...altFindings];
  const startPageId = report.pages.find((p) => p.isStartPage)?.id ?? report.pages[0]?.id ?? "";
  const regrouped = altFindings.length > 0 ? groupFindings(findings, startPageId) : report.issues;

  // --- Explainer ---
  const explained: ExplainResult =
    client.providersFor(false).length > 0
      ? await explainIssues(regrouped, findings, { client, sink })
      : // Configured providers can all be disabled by failures earlier in the
        // scan (e.g. a 429 during alt review); say which, or the fix looks wrong.
        { status: { status: "unavailable", reason: config.providers.length === 0 ? "no LLM provider is configured" : "every LLM provider failed earlier in this scan" }, explanations: new Map() };
  const issues = regrouped.map((issue) => ({ ...issue, explanation: explained.explanations.get(issue.id) ?? null }));

  const pages = report.pages.map((p) => ({ ...p, findingCount: findings.filter((f) => f.pageId === p.id).length }));
  const issuesByImpact: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const issue of issues) issuesByImpact[issue.impact] = (issuesByImpact[issue.impact] ?? 0) + 1;

  const llm: LlmSummary = {
    explainer: explained.status,
    altReview: { status: altStatus, reason: altReason, reviewed, skipped },
    usage: budget.usage(),
    steps: sink.steps(),
  };
  return ScanReport.parse({
    ...report,
    pages,
    findings,
    issues,
    altCandidates: candidates,
    summary: { ...report.summary, findings: findings.length, issues: issues.length, issuesByImpact },
    llm,
  });
}
