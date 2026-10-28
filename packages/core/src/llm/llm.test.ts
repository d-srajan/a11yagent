import { APIConnectionTimeoutError, APIError } from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLogger } from "../logger.js";
import { Budget, BudgetExhaustedError } from "./budget.js";
import { LlmClient, type ChatTransport } from "./client.js";
import { loadLlmConfig, type ProviderConfig } from "./config.js";
import { AllProvidersFailedError } from "./errors.js";
import { structuredCall } from "./structured.js";
import { createMemoryTrace } from "./trace.js";

const log = createLogger({ level: "error", write: () => {} });
const provider = (name: string, vision = true): ProviderConfig => ({ name, baseURL: `https://${name}.test/v1`, apiKey: "test-placeholder", textModel: `${name}-text`, visionModel: vision ? `${name}-vision` : null, disableReasoning: false });

const reply = (content: string, tokensOut = 10): ChatCompletion => ({
  id: "x",
  object: "chat.completion",
  created: 0,
  model: "m",
  choices: [{ index: 0, finish_reason: "stop", logprobs: null, message: { role: "assistant", content, refusal: null } }],
  usage: { prompt_tokens: 5, completion_tokens: tokensOut, total_tokens: 5 + tokensOut },
});

// Each provider name maps to a queue of outcomes; Errors are thrown.
function scripted(script: Record<string, (ChatCompletion | Error)[]>): { transport: ChatTransport; calls: string[] } {
  const calls: string[] = [];
  const transport: ChatTransport = async (p) => {
    calls.push(p.name);
    const next = script[p.name]?.shift();
    if (!next) throw new Error(`unscripted call to ${p.name}`);
    if (next instanceof Error) throw next;
    return next;
  };
  return { transport, calls };
}

function setup(script: Record<string, (ChatCompletion | Error)[]>, providers = [provider("gemini"), provider("groq", false)], budget = new Budget({ maxCalls: 25, maxOutputTokens: 20_000, dailyRemaining: 1000 })) {
  const { transport, calls } = scripted(script);
  const client = new LlmClient({ providers, budget, log, transport });
  const sink = createMemoryTrace(crypto.randomUUID());
  const trace = sink.forAgent("explainer");
  const request = { label: "test", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 100, promptVersion: "t1", trace };
  return { client, calls, sink, request, budget };
}

describe("loadLlmConfig", () => {
  it("builds providers in LLM_PROVIDERS order and reports incomplete ones", () => {
    const config = loadLlmConfig({
      LLM_PROVIDERS: "groq, gemini,openrouter",
      GEMINI_API_KEY: "k", GEMINI_BASE_URL: "https://g", GEMINI_TEXT_MODEL: "gt", GEMINI_VISION_MODEL: "gv",
      GROQ_API_KEY: "k", GROQ_BASE_URL: "https://q", GROQ_TEXT_MODEL: "qt",
      GROQ_DISABLE_REASONING: "true",
      OPENROUTER_BASE_URL: "https://o",
    });
    expect(config.providers.map((p) => [p.name, p.visionModel, p.disableReasoning])).toEqual([["groq", null, true], ["gemini", "gv", false]]);
    expect(config.skipped).toEqual([{ name: "openrouter", missing: ["OPENROUTER_API_KEY", "OPENROUTER_TEXT_MODEL"] }]);
    expect(config.limits.MAX_LLM_CALLS_PER_SCAN).toBe(25);
  });
});

describe("Budget", () => {
  it("stops at the call limit, the token limit or the daily cap, whichever is first", () => {
    const calls = new Budget({ maxCalls: 2, maxOutputTokens: 100, dailyRemaining: 10 });
    calls.reserveCall();
    calls.reserveCall();
    expect(() => calls.reserveCall()).toThrow(BudgetExhaustedError);
    expect(calls.blockedBy()).toBe("scan_calls");

    const tokens = new Budget({ maxCalls: 5, maxOutputTokens: 100, dailyRemaining: 10 });
    tokens.reserveCall();
    tokens.recordUsage(10, 100);
    expect(tokens.blockedBy()).toBe("scan_output_tokens");

    expect(new Budget({ maxCalls: 5, maxOutputTokens: 100, dailyRemaining: 0 }).blockedBy()).toBe("daily_cap");
  });
});

describe("LlmClient request body", () => {
  it("asks for no reasoning only on providers configured that way", async () => {
    const bodies: Record<string, unknown>[] = [];
    const transport: ChatTransport = async (_p, body) => {
      bodies.push(body as unknown as Record<string, unknown>);
      return reply("a");
    };
    const budget = new Budget({ maxCalls: 25, maxOutputTokens: 20_000, dailyRemaining: 1000 });
    const openrouter = { ...provider("openrouter"), disableReasoning: true };
    const groq = provider("groq");
    const client = new LlmClient({ providers: [openrouter, groq], budget, log, transport });
    const trace = createMemoryTrace(crypto.randomUUID()).forAgent("explainer");
    const request = { label: "test", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 100, promptVersion: "t1", trace };
    await client.callProvider(openrouter, request);
    await client.callProvider(groq, request);
    expect(bodies[0]?.reasoning).toEqual({ enabled: false });
    expect(bodies[1]).not.toHaveProperty("reasoning");
  });
});

describe("LlmClient fallback", () => {
  it("falls back on 429 and skips the rate-limited provider for the rest of the scan", async () => {
    const { client, calls, sink, request } = setup({ gemini: [new APIError(429, {}, "rate limited", new Headers())], groq: [reply("a"), reply("b")] });
    expect((await client.chat(request)).provider).toBe("groq");
    expect((await client.chat(request)).provider).toBe("groq");
    expect(calls).toEqual(["gemini", "groq", "groq"]);
    const steps = sink.steps();
    expect(steps.map((s) => [s.provider, s.error === null])).toEqual([["gemini", false], ["groq", true], ["groq", true]]);
    expect(steps.map((s) => s.step)).toEqual([1, 2, 3]);
  });

  it("treats Gemini's 400 API_KEY_INVALID like an auth failure", async () => {
    const { client, calls, request } = setup({ gemini: [APIError.generate(400, { error: { message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }, undefined, new Headers())], groq: [reply("a"), reply("b")] });
    await client.chat(request);
    await client.chat(request);
    expect(calls).toEqual(["gemini", "groq", "groq"]);
  });

  it("retries a timed-out provider on the next call (a timeout is not a verdict on the provider)", async () => {
    const { client, calls, request } = setup({ gemini: [new APIConnectionTimeoutError(), reply("ok")], groq: [reply("a")] });
    await client.chat(request);
    await client.chat(request);
    expect(calls).toEqual(["gemini", "groq", "gemini"]);
  });

  it("skips providers without a vision model for vision calls", async () => {
    const { client, calls, request } = setup({ groq: [reply("x")], openrouter: [reply("y")] }, [provider("groq", false), provider("openrouter")]);
    expect((await client.chat({ ...request, vision: true })).model).toBe("openrouter-vision");
    expect(calls).toEqual(["openrouter"]);
  });

  it("throws AllProvidersFailedError when every provider fails", async () => {
    const { client, request } = setup({ gemini: [new APIError(503, {}, "down", new Headers())], groq: [new APIError(500, {}, "oops", new Headers())] });
    await expect(client.chat(request)).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  it("counts failed attempts against the budget and stops before going over", async () => {
    const budget = new Budget({ maxCalls: 1, maxOutputTokens: 1000, dailyRemaining: 100 });
    const { client, calls, request } = setup({ gemini: [new APIError(503, {}, "down", new Headers())], groq: [reply("never")] }, undefined, budget);
    await expect(client.chat(request)).rejects.toBeInstanceOf(BudgetExhaustedError);
    expect(calls).toEqual(["gemini"]);
  });
});

describe("structuredCall", () => {
  const Schema = z.object({ answer: z.string().max(5) });

  it("accepts fenced JSON", async () => {
    const { client, request } = setup({ gemini: [reply('Sure!\n```json\n{"answer":"yes"}\n```')] });
    expect((await structuredCall(client, Schema, request)).value).toEqual({ answer: "yes" });
  });

  it("sends one repair turn with the validation errors to the same provider", async () => {
    const { client, calls, sink, request } = setup({ gemini: [reply('{"answer":"far too long"}'), reply('{"answer":"ok"}')] });
    const result = await structuredCall(client, Schema, request);
    expect(result).toMatchObject({ value: { answer: "ok" }, provider: "gemini" });
    expect(calls).toEqual(["gemini", "gemini"]);
    const repair = sink.steps()[1];
    expect(repair?.name).toBe("test:repair");
    expect(JSON.stringify(repair?.input)).toContain("answer");
  });

  it("falls back to the next provider when the repair also fails", async () => {
    const { client, calls, request } = setup({ gemini: [reply("nope"), reply("still nope")], groq: [reply('{"answer":"ok"}')] });
    expect((await structuredCall(client, Schema, request)).provider).toBe("groq");
    expect(calls).toEqual(["gemini", "gemini", "groq"]);
  });
});
