import type { AgentStep } from "@a11yagent/core";
import { describe, expect, it } from "vitest";
import { startOfUtcDay, toAgentStepRow } from "./agentSteps.js";

describe("agent_steps mapping", () => {
  it("maps every AgentStep field onto its snake_case column", () => {
    const step: AgentStep = {
      scanId: "00000000-0000-4000-8000-000000000001", issueId: null, agent: "explainer", step: 1, kind: "llm", name: "explain_issues",
      input: { a: 1 }, output: null, provider: "groq", model: "m", promptVersion: "explainer-v1",
      tokensIn: 10, tokensOut: 5, latencyMs: 300, error: null, createdAt: "2026-10-27T10:00:00.000Z",
    };
    expect(toAgentStepRow(step)).toEqual({
      scan_id: step.scanId, issue_id: null, agent: "explainer", step: 1, kind: "llm", name: "explain_issues",
      input: { a: 1 }, output: null, provider: "groq", model: "m", prompt_version: "explainer-v1",
      tokens_in: 10, tokens_out: 5, latency_ms: 300, error: null, created_at: step.createdAt,
    });
  });

  it("counts the daily cap from UTC midnight", () => {
    expect(startOfUtcDay(new Date("2026-10-27T23:59:00-07:00"))).toBe("2026-10-28T00:00:00.000Z");
  });
});
