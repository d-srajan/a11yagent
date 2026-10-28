import { Impact } from "@a11yagent/core";
import { z } from "zod";

// Rows as PostgREST returns them for the report page. Parsing them keeps a
// schema drift between worker and web a loud error instead of a blank card.

const num = z.coerce.number(); // numeric columns arrive as strings

export const PageRow = z.object({
  id: z.uuid(),
  url: z.string(),
  title: z.string().nullable(),
  http_status: z.number().int().nullable(),
  screenshot_path: z.string().nullable(),
  // axe_raw->incompleteByRule, written by the worker; null for pages axe never reached.
  needs_review: z.record(z.string(), z.number()).nullable(),
  created_at: z.string(),
});
export type PageRow = z.infer<typeof PageRow>;

export const FindingRow = z.object({
  id: z.uuid(),
  page_id: z.uuid(),
  selector: z.string(),
  html_snippet: z.string().nullable(),
  message: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
});
export type FindingRow = z.infer<typeof FindingRow>;

export const IssueRow = z.object({
  id: z.uuid(),
  rule_id: z.string(),
  impact: Impact,
  severity_score: num,
  rank: z.number().int(),
  occurrence_count: z.number().int(),
  page_count: z.number().int(),
  finding_ids: z.array(z.uuid()),
  title: z.string().nullable(),
  explanation: z.string().nullable(),
  who_is_affected: z.string().nullable(),
  how_to_fix: z.string().nullable(),
});
export type IssueRow = z.infer<typeof IssueRow>;

export const StepRow = z.object({
  id: num,
  agent: z.string(),
  step: z.number().int(),
  kind: z.enum(["llm", "tool"]),
  name: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  latency_ms: z.number().int().nullable(),
  error: z.string().nullable(),
});
export type StepRow = z.infer<typeof StepRow>;
