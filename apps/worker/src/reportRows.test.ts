import type { AgentStep, ScanReport } from "@a11yagent/core";
import { describe, expect, it } from "vitest";
import { reportToRows } from "./reportRows.js";

const scanId = "8f8b6c1e-6b8e-4c43-9d1a-2f4b7e7f1a10";
const pageA = "11111111-1111-4111-8111-111111111111";
const pageB = "22222222-2222-4222-8222-222222222222";
const findingId = "33333333-3333-4333-8333-333333333333";
const issueId = "44444444-4444-4444-8444-444444444444";

function page(id: string, url: string) {
  return {
    id, url, finalUrl: url, isStartPage: id === pageA, title: "Home", httpStatus: 200, screenshotPath: `${scanId}/00-home.jpg`,
    findingCount: 1, incompleteCount: 2, incompleteByRule: { "color-contrast": 2 }, blockedRequests: [], keyboard: null,
    axeRaw: { violations: [], incomplete: [] }, error: null, durationMs: 10,
  };
}

function step(issue: string | null): AgentStep {
  return {
    scanId: "00000000-0000-4000-8000-000000000000", issueId: issue, agent: "explainer", step: 1, kind: "llm", name: "explain_issues",
    input: null, output: null, provider: "gemini", model: "m", promptVersion: "v1", tokensIn: 1, tokensOut: 1, latencyMs: 5, error: null,
    createdAt: "2026-10-28T00:00:01Z",
  };
}

const report = {
  startedAt: "2026-10-28T00:00:00.000Z",
  pages: [page(pageA, "https://a.test/"), page(pageB, "https://a.test/menu")],
  findings: [{ id: findingId, pageId: pageA, pageUrl: "https://a.test/", source: "axe", ruleId: "image-alt", impact: "critical", wcag: ["1.1.1"], selector: "img", htmlSnippet: "<img>", message: "m", data: { help: "h" } }],
  issues: [{ id: issueId, ruleId: "image-alt", groupKey: "image-alt|img", impact: "critical", severityScore: 15, rank: 1, occurrenceCount: 1, pageCount: 1, findingIds: [findingId], explanation: { title: "T", explanation: "E", whoIsAffected: "W", howToFix: "H" } }],
  llm: { steps: [step(null), step(issueId), step("55555555-5555-4555-8555-555555555555")] },
} as unknown as ScanReport;

describe("reportToRows", () => {
  const rows = reportToRows(scanId, report);

  it("keeps crawl order through created_at and stores needs-review counts in axe_raw", () => {
    expect(rows.pages.map((p) => p.created_at)).toEqual(["2026-10-28T00:00:00.000Z", "2026-10-28T00:00:00.001Z"]);
    expect(rows.pages[0]?.axe_raw).toMatchObject({ incompleteByRule: { "color-contrast": 2 }, violations: [] });
  });

  it("copies explainer output onto the issue row", () => {
    expect(rows.issues[0]).toMatchObject({ scan_id: scanId, title: "T", how_to_fix: "H", finding_ids: [findingId] });
  });

  it("attaches steps to this scan and drops issue ids that are not in the report", () => {
    expect(rows.steps.map((s) => s.scan_id)).toEqual([scanId, scanId, scanId]);
    expect(rows.steps.map((s) => s.issue_id)).toEqual([null, issueId, null]);
  });
});
