import { describe, expect, it } from "vitest";
import { buildReport, type ReportRows } from "./buildReport";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const F1 = "33333333-3333-4333-8333-333333333333";

const rows: ReportRows = {
  scan: { llm_calls: 3, tokens_in: 100, tokens_out: 50, created_at: "2026-10-28T10:00:00Z", finished_at: "2026-10-28T10:01:30Z" },
  pages: [
    { id: P1, url: "https://a.test/", title: "Home", http_status: 200, screenshot_path: "s/00-home.jpg", needs_review: { "color-contrast": 2 }, created_at: "x" },
    { id: P2, url: "https://a.test/menu", title: null, http_status: 200, screenshot_path: null, needs_review: { "color-contrast": 1, "aria-hidden-focus": 1 }, created_at: "y" },
  ],
  findings: [{ id: F1, page_id: P2, selector: "img.x", html_snippet: "<img>", message: "Fix this", data: { help: "Images must have alt text", helpUrl: "https://dequeuniversity.com/x" } }],
  issues: [
    { id: "44444444-4444-4444-8444-444444444444", rule_id: "image-alt", impact: "critical", severity_score: 10, rank: 1, occurrence_count: 1, page_count: 1, finding_ids: [F1], title: null, explanation: null, who_is_affected: null, how_to_fix: null },
  ],
  steps: [{ id: 7, agent: "explainer", step: 1, kind: "llm", name: "explain_issues", input: { messages: [1, 2], json: true }, output: { content: "{}" }, provider: "gemini", model: "m", tokens_in: 1, tokens_out: 2, latency_ms: 300, error: null }],
  screenshotUrls: new Map([["s/00-home.jpg", "https://signed/1"]]),
};

describe("buildReport", () => {
  const report = buildReport(rows);

  it("falls back to axe help text and links the example to its page", () => {
    expect(report.explanationsAvailable).toBe(false);
    expect(report.issues[0]).toMatchObject({ help: "Images must have alt text", exampleHtml: "<img>", examplePageUrl: "https://a.test/menu" });
  });

  it("sums needs-review counts per page and per rule", () => {
    expect(report.summary.needsReview).toBe(4);
    expect(report.needsReviewByRule).toEqual([{ ruleId: "color-contrast", count: 3 }, { ruleId: "aria-hidden-focus", count: 1 }]);
    expect(report.pages.map((p) => [p.findingCount, p.screenshotUrl])).toEqual([[0, "https://signed/1"], [1, null]]);
  });

  it("summarizes steps and totals", () => {
    expect(report.steps[0]).toMatchObject({ inputSummary: "2 messages, JSON output", outputSummary: "{}", latencyMs: 300 });
    expect(report.summary).toMatchObject({ llmCalls: 3, durationMs: 90_000, issuesByImpact: { critical: 1, serious: 0 } });
  });
});
