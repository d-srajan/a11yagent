import { z } from "zod";
import { AltReview, IssueExplanation, LlmSummary } from "./agent-schema.js";

// The ScanReport is the single output of the scanner. The CLI writes it as
// JSON, the worker maps it onto the pages/findings/issues tables, and the
// eval runner compares it with ground truth. Field names follow the DB
// columns (camelCased) so the mapping stays mechanical.

export const Impact = z.enum(["critical", "serious", "moderate", "minor"]);
export type Impact = z.infer<typeof Impact>;

export const FindingSource = z.enum(["axe", "keyboard", "alt_review"]);
export type FindingSource = z.infer<typeof FindingSource>;

export const Finding = z.object({
  id: z.uuid(),
  pageId: z.uuid(),
  pageUrl: z.string(),
  source: FindingSource,
  ruleId: z.string(),
  impact: Impact,
  wcag: z.array(z.string()),
  selector: z.string(),
  htmlSnippet: z.string().nullable(),
  message: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
});
export type Finding = z.infer<typeof Finding>;

export const Issue = z.object({
  id: z.uuid(),
  ruleId: z.string(),
  groupKey: z.string(),
  source: FindingSource,
  impact: Impact,
  severityScore: z.number(),
  rank: z.number().int().positive(),
  occurrenceCount: z.number().int().positive(),
  pageCount: z.number().int().positive(),
  onStartPage: z.boolean(),
  blocker: z.boolean(),
  findingIds: z.array(z.uuid()),
  wcag: z.array(z.string()),
  help: z.string().nullable(),
  helpUrl: z.string().nullable(),
  exampleSelector: z.string(),
  exampleHtml: z.string().nullable(),
  // Filled by the explainer agent with --llm; null when unavailable.
  explanation: IssueExplanation.nullable().optional(),
});
export type Issue = z.infer<typeof Issue>;

export const Rect = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

export const FocusStop = z.object({
  path: z.string(),
  tag: z.string(),
  role: z.string().nullable(),
  name: z.string(),
  rect: Rect,
  inFrame: z.boolean(),
  // null when not measured (iframes, or an element already measured earlier).
  focusVisible: z.boolean().nullable(),
});
export type FocusStop = z.infer<typeof FocusStop>;

export const KeyboardResult = z.object({
  tabbableCount: z.number().int().nonnegative(),
  presses: z.number().int().nonnegative(),
  completedCycle: z.boolean(),
  trapDetected: z.boolean(),
  // One entry per Tab press; null means focus left the page (body or browser UI).
  sequence: z.array(FocusStop.nullable()),
});
export type KeyboardResult = z.infer<typeof KeyboardResult>;

export const PageResult = z.object({
  id: z.uuid(),
  url: z.string(),
  finalUrl: z.string().nullable(),
  isStartPage: z.boolean(),
  title: z.string().nullable(),
  httpStatus: z.number().int().nullable(),
  screenshotPath: z.string().nullable(),
  findingCount: z.number().int().nonnegative(),
  // axe "incomplete" results: shown as "needs human review", never as findings.
  incompleteCount: z.number().int().nonnegative(),
  incompleteByRule: z.record(z.string(), z.number().int()),
  blockedRequests: z.array(z.object({ url: z.string(), reason: z.string() })),
  keyboard: KeyboardResult.nullable(),
  axeRaw: z.unknown().nullable(),
  error: z.string().nullable(),
  // Every <img> the probe saw. The alt reviewer only gets candidates; the
  // eval also uses these to check verdicts on good alt text.
  images: z
    .array(z.object({ selector: z.string(), src: z.string(), alt: z.string(), surroundingText: z.string(), inLink: z.boolean() }))
    .optional(),
  durationMs: z.number().int().nonnegative(),
});
export type PageResult = z.infer<typeof PageResult>;

export const AltReason = z.enum(["file_name", "generic_word", "too_short", "redundant_prefix", "repeated"]);
export type AltReason = z.infer<typeof AltReason>;

export const AltCandidate = z.object({
  pageId: z.uuid(),
  pageUrl: z.string(),
  selector: z.string(),
  src: z.string(),
  alt: z.string(),
  reasons: z.array(AltReason).min(1),
  surroundingText: z.string(),
  inLink: z.boolean(),
  occurrences: z.number().int().positive(),
  // The vision reviewer's verdict with --llm; absent when not reviewed.
  review: AltReview.nullable().optional(),
});
export type AltCandidate = z.infer<typeof AltCandidate>;

export const ScanReport = z.object({
  version: z.literal(1),
  startUrl: z.string(),
  normalizedUrl: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  options: z.object({ maxPages: z.number().int(), allowLocal: z.boolean(), userAgent: z.string() }),
  discovery: z.object({
    source: z.enum(["sitemap", "links"]),
    robotsStatus: z.number().int().nullable(),
    candidates: z.number().int().nonnegative(),
  }),
  pages: z.array(PageResult),
  skippedPages: z.array(z.object({ url: z.string(), reason: z.string() })),
  findings: z.array(Finding),
  issues: z.array(Issue),
  altCandidates: z.array(AltCandidate),
  summary: z.object({
    pages: z.number().int(),
    findings: z.number().int(),
    issues: z.number().int(),
    issuesByImpact: z.record(z.string(), z.number().int()),
    needsReview: z.number().int(),
  }),
  timings: z.object({ totalMs: z.number().int(), discoveryMs: z.number().int() }),
  // Present only when the scan ran with the LLM layer.
  llm: LlmSummary.optional(),
});
export type ScanReport = z.infer<typeof ScanReport>;
