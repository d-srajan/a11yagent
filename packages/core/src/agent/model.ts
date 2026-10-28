import type { LlmClient } from "../llm/client.js";
import type { AgentTrace } from "../llm/trace.js";
import type { AgentModel } from "./tools.js";

// Adapts the provider client to the loop's AgentModel. Fallback, budget
// checks and LLM-step tracing all happen inside client.chat, which is why
// runAgent itself only records tool steps.
export function modelFromClient(
  client: LlmClient,
  options: { label: string; promptVersion: string; maxTokens: number; trace: AgentTrace; vision?: boolean },
): AgentModel {
  return async ({ messages, tools }) => {
    const result = await client.chat({ ...options, messages, tools });
    return result.message;
  };
}
