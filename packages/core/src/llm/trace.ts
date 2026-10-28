import type { AgentName, AgentStep } from "../agent-schema.js";

// Tracing is how we answer "what did the agent do and why": every LLM attempt
// (including failed ones, which is how a fallback shows up) and every tool
// call becomes one AgentStep row. The CLI keeps rows in memory and writes
// them into the report; the worker inserts them into agent_steps.

export type StepInput = Omit<AgentStep, "scanId" | "issueId" | "agent" | "step" | "createdAt"> &
  Partial<Pick<AgentStep, "issueId">>;

export interface AgentTrace {
  readonly agent: AgentName;
  record(step: StepInput): AgentStep;
}

export interface TraceSink {
  readonly scanId: string;
  // One trace per agent run; step numbers restart at 1 for each run so the
  // timeline reads "explainer step 1, 2..." rather than a global counter.
  forAgent(agent: AgentName, issueId?: string | null): AgentTrace;
  steps(): AgentStep[];
}

// Step payloads end up in a JSONB column and in the report file, so big
// strings (page HTML, base64 images) are clipped before they are stored.
const MAX_STRING = 4000;
export function clipForTrace(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) return `${value.slice(0, 40)}… (${value.length} chars)`;
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… (${value.length} chars)` : value;
  }
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => clipForTrace(v, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clipForTrace(v, depth + 1)]));
}

export function createMemoryTrace(scanId: string, onStep?: (step: AgentStep) => void): TraceSink {
  const all: AgentStep[] = [];
  return {
    scanId,
    forAgent(agent, issueId = null) {
      let step = 0;
      return {
        agent,
        record(input) {
          step += 1;
          const row: AgentStep = {
            ...input,
            input: clipForTrace(input.input),
            output: clipForTrace(input.output),
            scanId,
            issueId: input.issueId ?? issueId,
            agent,
            step,
            createdAt: new Date().toISOString(),
          };
          all.push(row);
          onStep?.(row);
          return row;
        },
      };
    },
    steps: () => [...all],
  };
}
