import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { Logger } from "../logger.js";
import { BudgetExhaustedError, type Budget } from "./budget.js";
import type { ProviderConfig } from "./config.js";
import { AllProvidersFailedError, ProviderError, toProviderError } from "./errors.js";
import type { AgentTrace } from "./trace.js";

export interface ChatRequest {
  // The agent_steps "name" for this call, e.g. "explain_issues".
  label: string;
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  json?: boolean;
  vision?: boolean;
  maxTokens: number;
  promptVersion: string;
  trace: AgentTrace;
}

export interface ChatResult {
  message: ChatCompletionMessage;
  finishReason: string | null;
  provider: string;
  model: string;
}

// The seam the tests replace: one HTTP request to one provider.
export type ChatTransport = (provider: ProviderConfig, body: ChatCompletionCreateParamsNonStreaming, timeoutMs: number) => Promise<ChatCompletion>;

export function openAiTransport(): ChatTransport {
  const clients = new Map<string, OpenAI>();
  return (provider, body, timeoutMs) => {
    let client = clients.get(provider.name);
    if (!client) {
      // maxRetries 0: the SDK's own retries would hide 429s from our fallback
      // and spend free-tier quota without counting against the budget.
      client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL, maxRetries: 0, timeout: timeoutMs });
      clients.set(provider.name, client);
    }
    return client.chat.completions.create(body);
  };
}

export interface LlmClientOptions {
  providers: ProviderConfig[];
  budget: Budget;
  log: Logger;
  timeoutMs?: number;
  transport?: ChatTransport;
}

export class LlmClient {
  private readonly disabled = new Set<string>();
  private readonly transport: ChatTransport;

  constructor(private readonly options: LlmClientOptions) {
    this.transport = options.transport ?? openAiTransport();
  }

  get budget(): Budget {
    return this.options.budget;
  }

  // Providers to try for this kind of call, in LLM_PROVIDERS order.
  providersFor(vision: boolean): ProviderConfig[] {
    return this.options.providers.filter((p) => !this.disabled.has(p.name) && (!vision || p.visionModel));
  }

  // Tries each provider once, in order. Budget exhaustion is not a provider
  // problem, so it propagates immediately instead of trying the next one.
  async chat(request: ChatRequest): Promise<ChatResult> {
    const failures: string[] = [];
    for (const provider of this.providersFor(request.vision ?? false)) {
      try {
        return await this.callProvider(provider, request);
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
        failures.push(err.message);
      }
    }
    throw new AllProvidersFailedError(failures);
  }

  // Exactly one attempt against one provider, always traced. Exposed so the
  // structured-output helper can send its repair retry to the same model.
  async callProvider(provider: ProviderConfig, request: ChatRequest): Promise<ChatResult> {
    const budget = this.options.budget;
    budget.reserveCall();
    const model = (request.vision ? provider.visionModel : provider.textModel) ?? provider.textModel;
    const maxTokens = Math.min(request.maxTokens, budget.remainingOutputTokens());
    if (maxTokens <= 0) throw new BudgetExhaustedError("scan_output_tokens");
    const body: ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: request.messages,
      max_tokens: maxTokens,
      ...(request.tools?.length ? { tools: request.tools } : {}),
      ...(request.json ? { response_format: { type: "json_object" as const } } : {}),
      // OpenRouter's unified field; providers that don't know it ignore it.
      ...(provider.disableReasoning ? { reasoning: { enabled: false } } : {}),
    };
    const traceInput = { messages: request.messages, tools: request.tools?.map((t) => (t.type === "function" ? t.function.name : t.type)), json: request.json ?? false, maxTokens };
    const started = Date.now();
    const base = { kind: "llm" as const, name: request.label, provider: provider.name, model, promptVersion: request.promptVersion, input: traceInput };
    try {
      const completion = await this.transport(provider, body, this.options.timeoutMs ?? 20_000);
      const choice = completion.choices[0];
      if (!choice) throw new ProviderError(provider.name, "response had no choices", null, false);
      const tokensIn = completion.usage?.prompt_tokens ?? 0;
      const tokensOut = completion.usage?.completion_tokens ?? 0;
      budget.recordUsage(tokensIn, tokensOut);
      request.trace.record({ ...base, output: { content: choice.message.content, toolCalls: choice.message.tool_calls ?? null, finishReason: choice.finish_reason }, tokensIn, tokensOut, latencyMs: Date.now() - started, error: null });
      return { message: choice.message, finishReason: choice.finish_reason ?? null, provider: provider.name, model };
    } catch (err) {
      const failure = toProviderError(provider.name, err);
      if (failure.disable) this.disabled.add(provider.name);
      request.trace.record({ ...base, output: null, tokensIn: null, tokensOut: null, latencyMs: Date.now() - started, error: failure.message });
      this.options.log.warn("llm call failed", { provider: provider.name, model, status: failure.status, disabled: failure.disable, error: failure.message });
      throw failure;
    }
  }
}
