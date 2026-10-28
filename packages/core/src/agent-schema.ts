import { z } from "zod";

// Shapes produced by the LLM layer. Pure zod (no Node imports) so the web app
// can render them. AgentStep mirrors the agent_steps table, camelCased.

export const AgentName = z.enum(["explainer", "alt_reviewer", "fixer"]);
export type AgentName = z.infer<typeof AgentName>;

export const AgentStep = z.object({
  scanId: z.uuid(),
  issueId: z.uuid().nullable(),
  agent: AgentName,
  step: z.number().int().positive(),
  kind: z.enum(["llm", "tool"]),
  name: z.string(),
  input: z.unknown().nullable(),
  output: z.unknown().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
  tokensIn: z.number().int().nullable(),
  tokensOut: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type AgentStep = z.infer<typeof AgentStep>;

export const AltVerdict = z.enum(["good", "poor", "should_be_decorative"]);
export type AltVerdict = z.infer<typeof AltVerdict>;

export const AltReview = z.object({
  verdict: AltVerdict,
  suggestedAlt: z.string(),
  reason: z.string(),
});
export type AltReview = z.infer<typeof AltReview>;

export const IssueExplanation = z.object({
  title: z.string(),
  explanation: z.string(),
  whoIsAffected: z.string(),
  howToFix: z.string(),
});
export type IssueExplanation = z.infer<typeof IssueExplanation>;

// "unavailable": we wanted the LLM but couldn't use it (budget, daily cap,
// every provider failed). The report says so instead of failing the scan.
export const LlmPartStatus = z.object({
  status: z.enum(["ok", "partial", "unavailable"]),
  reason: z.string().nullable(),
});
export type LlmPartStatus = z.infer<typeof LlmPartStatus>;

export const LlmSummary = z.object({
  explainer: LlmPartStatus,
  altReview: LlmPartStatus.extend({ reviewed: z.number().int(), skipped: z.number().int() }),
  usage: z.object({ calls: z.number().int(), tokensIn: z.number().int(), tokensOut: z.number().int() }),
  steps: z.array(AgentStep),
});
export type LlmSummary = z.infer<typeof LlmSummary>;
