import type { AgentStep } from "@a11yagent/core";
import type { SupabaseClient } from "@supabase/supabase-js";

// The database side of tracing. The pipeline produces AgentStep objects;
// these functions store them in agent_steps and read back the one number the
// cost controls need: how many LLM calls were made today, across all scans.

export function toAgentStepRow(step: AgentStep): Record<string, unknown> {
  return {
    scan_id: step.scanId,
    issue_id: step.issueId,
    agent: step.agent,
    step: step.step,
    kind: step.kind,
    name: step.name,
    input: step.input ?? null,
    output: step.output ?? null,
    provider: step.provider,
    model: step.model,
    prompt_version: step.promptVersion,
    tokens_in: step.tokensIn,
    tokens_out: step.tokensOut,
    latency_ms: step.latencyMs,
    error: step.error,
    created_at: step.createdAt,
  };
}

// Used by the worker from Phase 4, once scans and issues are written to the
// database (agent_steps has foreign keys to both).
export async function insertAgentSteps(db: SupabaseClient, steps: AgentStep[]): Promise<void> {
  if (steps.length === 0) return;
  const { error } = await db.from("agent_steps").insert(steps.map(toAgentStepRow));
  if (error) throw new Error(`insert agent_steps failed: ${error.message}`);
}

export function startOfUtcDay(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

// DAILY_LLM_CALL_CAP is "calls per UTC day", counted from agent_steps.
// Failed attempts count too: they still hit the provider's rate limits.
export async function countLlmCallsToday(db: SupabaseClient, now = new Date()): Promise<number> {
  const { count, error } = await db
    .from("agent_steps")
    .select("id", { count: "exact", head: true })
    .eq("kind", "llm")
    .gte("created_at", startOfUtcDay(now));
  if (error) throw new Error(`count agent_steps failed: ${error.message}`);
  return count ?? 0;
}
