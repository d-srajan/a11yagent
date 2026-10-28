import type {
  ChatCompletionContentPart,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { z } from "zod";
import { jsonSchemaOf } from "../llm/structured.js";

// Building blocks for runAgent. Kept out of the loop file so the loop itself
// reads as the algorithm and nothing else.

export const FINISH_TOOL = "finish";

// A tool as the loop sees it: a schema to validate the model's arguments
// against, and a fixed function to run with them. Tools only ever receive
// validated data; the model's text is never executed.
export interface AgentTool {
  name: string;
  description: string;
  schema: z.ZodType;
  run(args: unknown): Promise<unknown>;
}

// Typed constructor: `run` gets the parsed type. The cast is sound only
// because runAgent validates with `schema` before calling `run`.
export function defineTool<S extends z.ZodType>(tool: {
  name: string;
  description: string;
  schema: S;
  run(args: z.infer<S>): Promise<unknown>;
}): AgentTool {
  return { ...tool, run: (args) => tool.run(args as z.infer<S>) };
}

// What runAgent needs from a model: messages and tool definitions in, one
// assistant message out. LlmClient provides this with fallback and tracing
// (see model.ts); tests provide a scripted fake.
export type AgentModel = (request: { messages: ChatCompletionMessageParam[]; tools: ChatCompletionTool[] }) => Promise<ChatCompletionMessage>;

export type UserContent = string | ChatCompletionContentPart[];

// The JSON Schema each tool advertises comes from its zod schema, so the
// model is told exactly what the validator will accept. finish is always
// last and takes the agent's output schema.
export function toToolDefinitions(tools: AgentTool[], finishSchema: z.ZodType): ChatCompletionTool[] {
  const fn = (name: string, description: string, schema: z.ZodType): ChatCompletionTool => ({
    type: "function",
    function: { name, description, parameters: jsonSchemaOf(schema) },
  });
  return [
    ...tools.map((t) => fn(t.name, t.description, t.schema)),
    fn(FINISH_TOOL, "Call this once with your final answer. The run ends when the arguments are valid.", finishSchema),
  ];
}

// Tool-call arguments arrive as a JSON string written by the model.
export function parseArguments(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: raw.trim() === "" ? {} : JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: `arguments are not valid JSON (${err instanceof Error ? err.message : String(err)})` };
  }
}

export class ToolTimeoutError extends Error {
  constructor(name: string, ms: number) {
    super(`tool ${name} timed out after ${ms} ms`);
    this.name = "ToolTimeoutError";
  }
}

// Rejects after `ms`. The tool keeps running in the background (JS can't
// cancel a promise), but the loop stops waiting for it.
export function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolTimeoutError(name, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Tool results go back to the model as text. Errors use one recognizable
// prefix so the model (and the tests) can tell them from normal output.
export function toolResultContent(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result ?? null);
}
export function toolErrorContent(message: string): string {
  return `Error: ${message}`;
}

// Sent when the model answers with plain text instead of a tool call.
export const NUDGE = `Reply by calling one of the tools, or call ${FINISH_TOOL} with your final answer.`;
