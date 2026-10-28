import { describe, expect, it } from "vitest";
import { reportToMarkdown } from "./report-markdown";
import type { IssueView, ReportView, ScanView } from "./scan-view";

const issue: IssueView = {
  id: "i1", rank: 1, ruleId: "image-alt", impact: "critical", severityScore: 15, occurrenceCount: 3, pageCount: 2,
  title: "Images have no text alternative", explanation: "Screen readers can't describe these images.",
  whoIsAffected: "Blind visitors.", howToFix: "Add an alt attribute.", help: "Images must have alt text",
  helpUrl: "https://dequeuniversity.com/rules/axe/4.14/image-alt", exampleHtml: '<img src="a.png">\n```', exampleSelector: "img", examplePageUrl: "https://a.test/",
};

const report: ReportView = {
  summary: { pages: 2, issues: 1, findings: 3, issuesByImpact: { critical: 1, serious: 0, moderate: 0, minor: 0 }, needsReview: 4, llmCalls: 2, tokensIn: 10, tokensOut: 5, durationMs: 120_000 },
  explanationsAvailable: true, issues: [issue], pages: [], needsReviewByRule: [], steps: [],
};

const scan: ScanView = {
  id: "s1", url: "https://a.test/", status: "done", progress: {}, error: null, createdAt: "2026-10-28T10:00:00Z", finishedAt: "2026-10-28T10:02:00Z", queueAhead: null,
  report,
};

describe("reportToMarkdown", () => {
  const md = reportToMarkdown(scan, "https://a11yagent.test/scans/s1");

  it("has a heading, summary, ranked issues and the disclaimer", () => {
    expect(md).toContain("# Accessibility report for https://a.test/");
    expect(md).toContain("**1 issue** (1 critical, 0 serious, 0 moderate, 0 minor)");
    expect(md).toContain("### 1. Images have no text alternative");
    expect(md).toContain("**Who is affected:** Blind visitors.");
    expect(md).toContain("cannot certify WCAG or ADA compliance");
  });

  it("uses a fence longer than any backticks inside the snippet", () => {
    expect(md).toContain('````html\n<img src="a.png">\n```\n````');
  });

  it("falls back to the axe help text when there is no explanation", () => {
    const bare = { ...scan, report: { ...report, issues: [{ ...issue, title: null, explanation: null, whoIsAffected: null, howToFix: null }] } };
    expect(reportToMarkdown(bare, "u")).toContain("### 1. Images must have alt text");
  });
});
