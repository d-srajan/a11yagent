import type { Impact, ScanProgress, ScanStatus } from "@a11yagent/core";

// The JSON shape of GET /api/scans/:id. Types only, so client components can
// import it without pulling any server code into the browser bundle.

export interface IssueView {
  id: string;
  rank: number;
  ruleId: string;
  impact: Impact;
  severityScore: number;
  occurrenceCount: number;
  pageCount: number;
  // From the explainer; null when the LLM part was unavailable.
  title: string | null;
  explanation: string | null;
  whoIsAffected: string | null;
  howToFix: string | null;
  // Deterministic fallbacks from the scanner (axe help text, finding message).
  help: string | null;
  helpUrl: string | null;
  exampleHtml: string | null;
  exampleSelector: string | null;
  examplePageUrl: string | null;
}

export interface PageView {
  url: string;
  title: string | null;
  httpStatus: number | null;
  screenshotUrl: string | null;
  findingCount: number;
  needsReview: number;
}

export interface StepView {
  id: number;
  agent: string;
  step: number;
  kind: "llm" | "tool";
  name: string;
  provider: string | null;
  model: string | null;
  latencyMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  error: string | null;
  inputSummary: string;
  outputSummary: string;
}

export interface ReportView {
  summary: {
    pages: number;
    issues: number;
    findings: number;
    issuesByImpact: Record<Impact, number>;
    needsReview: number;
    llmCalls: number;
    tokensIn: number;
    tokensOut: number;
    durationMs: number | null;
  };
  explanationsAvailable: boolean;
  issues: IssueView[];
  pages: PageView[];
  needsReviewByRule: { ruleId: string; count: number }[];
  steps: StepView[];
}

export interface ScanView {
  id: string;
  url: string;
  status: ScanStatus;
  progress: ScanProgress;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  // Scans that will run before this one; null once it has started.
  queueAhead: number | null;
  report: ReportView | null;
}

export interface ApiError {
  code: string;
  message: string;
}
