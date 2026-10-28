import type { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from "openai/resources/chat/completions";
import type { z } from "zod";
import type { AgentName } from "../agent-schema.js";
import { BudgetExhaustedError, type Budget } from "../llm/budget.js";
import { formatZodError } from "../llm/structured.js";
import type { AgentTrace } from "../llm/trace.js";
import {
  FINISH_TOOL,
  NUDGE,
  parseArguments,
  toolErrorContent,
  toolResultContent,
  toToolDefinitions,
  withTimeout,
  type AgentModel,
  type AgentTool,
  type UserContent,
} from "./tools.js";

// The agent loop (SPEC.md Phase 3). runAgent.test.ts is the contract; the
// per-case helpers live in ./tools.ts so this file reads as the algorithm.

export interface RunAgentOptions<F extends z.ZodType> {
  name: AgentName;
  systemPrompt: string;
  userContent: UserContent;
  // Domain tools. `finish` is added by the loop; don't include it here.
  tools: AgentTool[];
  // Shape of the agent's final answer: the arguments of the finish tool.
  finishSchema: F;
  // Upper bound on model calls in this run.
  maxSteps: number;
  budget: Budget;
  // Tool steps are recorded here. LLM steps are recorded by the model
  // (LlmClient), so the loop must not record them a second time.
  trace: AgentTrace;
  model: AgentModel;
  // Per tool call. Default 20 s (SPEC.md, Agent design).
  toolTimeoutMs?: number;
}

export type RunAgentStatus = "finished" | "max_steps" | "budget_exhausted";

export interface RunAgentResult<T> {
  status: RunAgentStatus;
  // Present only when status is "finished": the validated finish arguments.
  output?: T;
  // Number of model calls made.
  steps: number;
  // The whole conversation, for debugging and for callers that want the
  // best partial result when the run did not finish.
  messages: ChatCompletionMessageParam[];
}

export const DEFAULT_TOOL_TIMEOUT_MS = 20_000;

/**
 * The contract, in order:
 *
 * 1. Start the conversation with [system, user]. Tool definitions come from
 *    toToolDefinitions(tools, finishSchema) and go to every model call.
 * 2. Before each model call, stop with "budget_exhausted" if the budget is
 *    exhausted. If the model throws BudgetExhaustedError, stop the same way.
 *    Any other model error propagates (the caller decides what it means).
 * 3. Append the assistant message to the conversation. If it has no tool
 *    calls, append a user message with NUDGE and go to the next step.
 * 4. Handle each tool call in order. Every tool_call_id gets exactly one
 *    `tool` message back, and every tool call (finish included) records one
 *    trace step with kind "tool", the tool name, the arguments as input, the
 *    result as output, latencyMs, and error (null on success).
 *    - finish: parse and validate the arguments with finishSchema. Valid:
 *      return { status: "finished", output }. Invalid: send the validation
 *      error back as the tool result and keep going.
 *    - unknown tool, unparseable JSON or arguments failing the tool's schema:
 *      send an error back as the tool result; do NOT call run().
 *    - otherwise run the tool with withTimeout(..., toolTimeoutMs). If it
 *      throws or times out, send the error back. Never throw out of the loop
 *      because of a tool.
 *    Error results use toolErrorContent(); normal ones use toolResultContent().
 * 5. After maxSteps model calls without a valid finish, return "max_steps".
 */
export async function runAgent<F extends z.ZodType>(options: RunAgentOptions<F>): Promise<RunAgentResult<z.infer<F>>> {
  const { systemPrompt, userContent, tools, finishSchema, maxSteps, budget, trace, model } = options;
  const toolTimeoutMs = options.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const toolDefs = toToolDefinitions(tools, finishSchema);
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  // `steps` changes on exactly one line, so termination is easy to check.
  let steps = 0;
  while (steps < maxSteps) {
    // Checked before the call, not after: a run must never spend a call the
    // scan (or the day) can no longer afford.
    if (budget.exhausted) return { status: "budget_exhausted", steps, messages };

    let reply;
    try {
      reply = await model({ messages, tools: toolDefs });
    } catch (err) {
      // Running out of budget is an expected way for a run to end; anything
      // else (every provider down) is the caller's problem, not the loop's.
      if (err instanceof BudgetExhaustedError) return { status: "budget_exhausted", steps, messages };
      throw err;
    }
    steps++;
    messages.push(reply);

    // Some models answer in prose. Nudging back into the protocol is cheaper
    // than failing the run, and maxSteps still bounds a model that never complies.
    if (!reply.tool_calls?.length) {
      messages.push({ role: "user", content: NUDGE });
      continue;
    }

    for (const call of reply.tool_calls) {
      const startedAt = Date.now();
      const outcome = await handleCall(call, { tools, finishSchema, toolTimeoutMs });
      // One trace row and one tool message per call, whatever path it took:
      // providers reject a conversation with an unanswered tool_call_id.
      trace.record({
        kind: "tool",
        name: outcome.name,
        input: outcome.input,
        output: outcome.output,
        error: outcome.error,
        latencyMs: Date.now() - startedAt,
        provider: null,
        model: null,
        promptVersion: null,
        tokensIn: null,
        tokensOut: null,
      });
      messages.push({ role: "tool", tool_call_id: call.id, content: outcome.content });
      if (outcome.finished) return { status: "finished", output: outcome.finished.value, steps, messages };
    }
  }
  return { status: "max_steps", steps, messages };
}

// The result of one tool call. `content` goes back to the model; input,
// output and error go to the trace; `finished` is set only by a valid finish.
interface CallOutcome<T> {
  name: string;
  content: string;
  input: unknown;
  output: unknown;
  error: string | null;
  finished?: { value: T };
}

// Each case returns early, so there is no shared mutable state to get wrong.
// Model mistakes become error messages the model can read and correct;
// nothing here throws, because a bad tool call is data, not a crash.
async function handleCall<F extends z.ZodType>(
  call: ChatCompletionMessageToolCall,
  ctx: { tools: AgentTool[]; finishSchema: F; toolTimeoutMs: number },
): Promise<CallOutcome<z.infer<F>>> {
  // The SDK also types "custom" (free-text) tool calls; we only advertise
  // function tools, so anything else falls through as an unknown tool.
  const name = call.type === "function" ? call.function.name : `(${call.type} tool)`;
  const raw = call.type === "function" ? call.function.arguments : "";
  const fail = (input: unknown, message: string): CallOutcome<z.infer<F>> => ({ name, content: toolErrorContent(message), input, output: null, error: message });

  const args = parseArguments(raw);
  if (!args.ok) return fail(raw, args.error);

  if (name === FINISH_TOOL) {
    const result = ctx.finishSchema.safeParse(args.value);
    if (!result.success) return fail(args.value, `finish arguments are invalid:\n${formatZodError(result.error)}`);
    return { name, content: "Done.", input: args.value, output: result.data, error: null, finished: { value: result.data } };
  }

  const tool = ctx.tools.find((t) => t.name === name);
  if (!tool) return fail(args.value, `unknown tool "${name}". Use one of: ${[...ctx.tools.map((t) => t.name), FINISH_TOOL].join(", ")}`);

  // Validate before run(): defineTool's typed `run` relies on it.
  const parsed = tool.schema.safeParse(args.value);
  if (!parsed.success) return fail(args.value, `arguments for ${name} are invalid:\n${formatZodError(parsed.error)}`);

  try {
    const output = await withTimeout(tool.run(parsed.data), ctx.toolTimeoutMs, name);
    return { name, content: toolResultContent(output), input: args.value, output, error: null };
  } catch (err) {
    return fail(args.value, err instanceof Error ? err.message : String(err));
  }
}
