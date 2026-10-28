import type { ChatCompletionMessage, ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Budget, BudgetExhaustedError } from "../llm/budget.js";
import { createMemoryTrace } from "../llm/trace.js";
import { runAgent, type RunAgentOptions } from "./runAgent.js";
import { defineTool, NUDGE, type AgentModel } from "./tools.js";

// A scripted mock model: returns the next canned assistant message on each
// call and records what it was sent. No network, fully deterministic.

let callIds = 0;
const call = (name: string, args: unknown): NonNullable<ChatCompletionMessage["tool_calls"]>[number] => ({
  id: `call_${++callIds}`,
  type: "function",
  function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});
const says = (...toolCalls: ReturnType<typeof call>[]): ChatCompletionMessage => ({ role: "assistant", content: null, refusal: null, tool_calls: toolCalls });
const text = (content: string): ChatCompletionMessage => ({ role: "assistant", content, refusal: null });

interface Seen {
  messages: ChatCompletionMessageParam[];
  tools: ChatCompletionTool[];
}
function scriptedModel(script: (ChatCompletionMessage | Error)[]): { model: AgentModel; seen: Seen[] } {
  const seen: Seen[] = [];
  const model: AgentModel = async ({ messages, tools }) => {
    seen.push({ messages: structuredClone(messages), tools });
    const next = script.shift();
    if (!next) throw new Error("mock model ran out of scripted replies");
    if (next instanceof Error) throw next;
    return next;
  };
  return { model, seen };
}

const Finish = z.object({ summary: z.string().min(1), score: z.number().int().min(0).max(10) });

const toolMessages = (messages: ChatCompletionMessageParam[]) =>
  messages.filter((m): m is Extract<ChatCompletionMessageParam, { role: "tool" }> => m.role === "tool");

function setup(script: (ChatCompletionMessage | Error)[], overrides: Partial<RunAgentOptions<typeof Finish>> = {}) {
  const { model, seen } = scriptedModel(script);
  const sink = createMemoryTrace(crypto.randomUUID());
  const ran: unknown[] = [];
  const add = defineTool({
    name: "add",
    description: "Adds two numbers",
    schema: z.object({ a: z.number(), b: z.number() }),
    run: async ({ a, b }) => {
      ran.push({ a, b });
      return { sum: a + b };
    },
  });
  const explode = defineTool({ name: "explode", description: "Always fails", schema: z.object({}), run: async () => Promise.reject(new Error("boom: element not found")) });
  const options: RunAgentOptions<typeof Finish> = {
    name: "fixer",
    systemPrompt: "You are a test agent.",
    userContent: "Do the thing.",
    tools: [add, explode],
    finishSchema: Finish,
    maxSteps: 5,
    budget: new Budget({ maxCalls: 25, maxOutputTokens: 20_000, dailyRemaining: 1000 }),
    trace: sink.forAgent("fixer"),
    model,
    ...overrides,
  };
  return { options, seen, sink, ran };
}

describe("runAgent", () => {
  it("returns the validated finish arguments", async () => {
    const { options, seen } = setup([says(call("finish", { summary: "done", score: 7 }))]);
    const result = await runAgent(options);
    expect(result).toMatchObject({ status: "finished", output: { summary: "done", score: 7 }, steps: 1 });
    // The first call sees exactly [system, user], plus every tool and finish.
    expect(seen[0]?.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(seen[0]?.tools.map((t) => (t.type === "function" ? t.function.name : t.type))).toEqual(["add", "explode", "finish"]);
  });

  it("runs a tool and sends its result back under the same tool_call_id", async () => {
    const addCall = call("add", { a: 2, b: 3 });
    const { options, seen, ran } = setup([says(addCall), says(call("finish", { summary: "sum is 5", score: 5 }))]);
    const result = await runAgent(options);
    expect(result.status).toBe("finished");
    expect(ran).toEqual([{ a: 2, b: 3 }]);
    const second = seen[1]?.messages ?? [];
    expect(second.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    const [toolMsg] = toolMessages(second);
    expect(toolMsg?.tool_call_id).toBe(addCall.id);
    expect(JSON.parse(String(toolMsg?.content))).toEqual({ sum: 5 });
  });

  it("sends a tool's thrown error back to the model instead of throwing", async () => {
    const { options, seen } = setup([says(call("explode", {})), says(call("finish", { summary: "gave up", score: 0 }))]);
    const result = await runAgent(options);
    expect(result.status).toBe("finished");
    const [toolMsg] = toolMessages(seen[1]?.messages ?? []);
    expect(toolMsg?.content).toMatch(/^Error: .*boom: element not found/);
  });

  it("rejects invalid tool arguments without running the tool", async () => {
    const { options, seen, ran } = setup([says(call("add", { a: "two", b: 3 }), call("add", "{not json")), says(call("finish", { summary: "ok", score: 1 }))]);
    await runAgent(options);
    expect(ran).toEqual([]);
    const results = toolMessages(seen[1]?.messages ?? []);
    expect(results).toHaveLength(2);
    for (const r of results) expect(r.content).toMatch(/^Error: /);
    expect(results[0]?.content).toMatch(/\ba\b/); // names the bad field
  });

  it("tells the model about an unknown tool", async () => {
    const { options, seen } = setup([says(call("delete_everything", {})), says(call("finish", { summary: "ok", score: 1 }))]);
    await runAgent(options);
    const [toolMsg] = toolMessages(seen[1]?.messages ?? []);
    expect(toolMsg?.content).toMatch(/^Error: .*delete_everything/);
  });

  it("times out a slow tool and reports it as an error", async () => {
    const slow = defineTool({ name: "slow", description: "Never returns", schema: z.object({}), run: () => new Promise(() => {}) });
    const { options, seen } = setup([says(call("slow", {})), says(call("finish", { summary: "ok", score: 1 }))]);
    const result = await runAgent({ ...options, tools: [slow], toolTimeoutMs: 20 });
    expect(result.status).toBe("finished");
    const [toolMsg] = toolMessages(seen[1]?.messages ?? []);
    expect(toolMsg?.content).toMatch(/^Error: .*timed out/);
  });

  it("rejects invalid finish arguments, returns the error, and keeps going", async () => {
    const { options, seen } = setup([says(call("finish", { summary: "", score: 99 })), says(call("finish", { summary: "fixed", score: 9 }))]);
    const result = await runAgent(options);
    expect(result).toMatchObject({ status: "finished", output: { summary: "fixed", score: 9 }, steps: 2 });
    const [toolMsg] = toolMessages(seen[1]?.messages ?? []);
    expect(toolMsg?.content).toMatch(/^Error: /);
    expect(toolMsg?.content).toMatch(/score/);
  });

  it("stops at maxSteps without a valid finish", async () => {
    const script = Array.from({ length: 10 }, () => says(call("add", { a: 1, b: 1 })));
    const { options, seen } = setup(script, { maxSteps: 3 });
    const result = await runAgent(options);
    expect(result.status).toBe("max_steps");
    expect(result.output).toBeUndefined();
    expect(result.steps).toBe(3);
    expect(seen).toHaveLength(3);
  });

  it("nudges a model that answers in plain text", async () => {
    const { options, seen } = setup([text("I think the answer is 5."), says(call("finish", { summary: "5", score: 5 }))]);
    const result = await runAgent(options);
    expect(result.status).toBe("finished");
    const second = seen[1]?.messages ?? [];
    expect(second.at(-1)).toEqual({ role: "user", content: NUDGE });
  });

  it("stops before calling the model when the budget is already exhausted", async () => {
    const { options, seen } = setup([says(call("finish", { summary: "x", score: 1 }))], {
      budget: new Budget({ maxCalls: 25, maxOutputTokens: 20_000, dailyRemaining: 0 }),
    });
    const result = await runAgent(options);
    expect(result).toMatchObject({ status: "budget_exhausted", steps: 0 });
    expect(seen).toHaveLength(0);
  });

  it("stops when the model reports the budget ran out mid-run", async () => {
    const { options } = setup([says(call("add", { a: 1, b: 2 })), new BudgetExhaustedError("scan_calls")]);
    const result = await runAgent(options);
    expect(result.status).toBe("budget_exhausted");
    expect(result.steps).toBe(1);
  });

  it("lets non-budget model errors propagate", async () => {
    const { options } = setup([new Error("all providers failed")]);
    await expect(runAgent(options)).rejects.toThrow("all providers failed");
  });

  it("records one tool step per tool call, finish included", async () => {
    const { options, sink } = setup([says(call("add", { a: 1, b: 2 }), call("explode", {})), says(call("finish", { summary: "ok", score: 3 }))]);
    await runAgent(options);
    const steps = sink.steps();
    expect(steps.map((s) => [s.kind, s.name, s.error === null])).toEqual([
      ["tool", "add", true],
      ["tool", "explode", false],
      ["tool", "finish", true],
    ]);
    expect(steps[0]).toMatchObject({ input: { a: 1, b: 2 }, output: { sum: 3 }, agent: "fixer" });
    expect(steps.every((s) => typeof s.latencyMs === "number")).toBe(true);
  });
});
