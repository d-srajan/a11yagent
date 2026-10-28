import { z } from "zod";

// Everything about providers and limits comes from env: model IDs on free
// tiers change every few months, and a code change per model swap would be
// silly. See .env.example for the IDs checked when this was written.

export interface ProviderConfig {
  name: string;
  baseURL: string;
  apiKey: string;
  textModel: string;
  // Absent: the provider is skipped for vision calls.
  visionModel: string | null;
  // Asks the model to skip hidden "thinking" before it answers. Reasoning
  // models on free tiers can spend most of their output on it, which costs
  // budget tokens and pushes calls past LLM_TIMEOUT_MS (see DECISIONS.md D29).
  disableReasoning: boolean;
}

const positiveInt = (fallback: number) => z.coerce.number().int().min(0).default(fallback);

export const LlmLimitsEnv = z.object({
  LLM_PROVIDERS: z.string().default("gemini,groq,openrouter"),
  MAX_LLM_CALLS_PER_SCAN: positiveInt(25),
  MAX_LLM_OUTPUT_TOKENS_PER_SCAN: positiveInt(20_000),
  MAX_VISION_IMAGES: positiveInt(8),
  DAILY_LLM_CALL_CAP: positiveInt(1000),
  LLM_TIMEOUT_MS: positiveInt(20_000),
});
export type LlmLimits = z.infer<typeof LlmLimitsEnv>;

export interface LlmConfig {
  providers: ProviderConfig[];
  // Providers named in LLM_PROVIDERS but missing a key or model: reported so
  // a typo doesn't silently shrink the fallback chain.
  skipped: { name: string; missing: string[] }[];
  limits: LlmLimits;
}

const read = (env: Record<string, string | undefined>, key: string): string | null => {
  const value = env[key]?.trim();
  return value ? value : null;
};

const flag = (env: Record<string, string | undefined>, key: string): boolean => /^(1|true|yes)$/i.test(read(env, key) ?? "");

// GEMINI_API_KEY, GEMINI_BASE_URL, GEMINI_TEXT_MODEL, GEMINI_VISION_MODEL,
// GEMINI_DISABLE_REASONING, ...
export function loadLlmConfig(env: Record<string, string | undefined> = process.env): LlmConfig {
  const limits = LlmLimitsEnv.parse(env);
  const providers: ProviderConfig[] = [];
  const skipped: LlmConfig["skipped"] = [];
  const names = limits.LLM_PROVIDERS.split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);
  for (const name of [...new Set(names)]) {
    const prefix = name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const apiKey = read(env, `${prefix}_API_KEY`);
    const baseURL = read(env, `${prefix}_BASE_URL`);
    const textModel = read(env, `${prefix}_TEXT_MODEL`);
    const missing = [
      ...(apiKey ? [] : [`${prefix}_API_KEY`]),
      ...(baseURL ? [] : [`${prefix}_BASE_URL`]),
      ...(textModel ? [] : [`${prefix}_TEXT_MODEL`]),
    ];
    if (!apiKey || !baseURL || !textModel) {
      skipped.push({ name, missing });
      continue;
    }
    providers.push({ name, apiKey, baseURL, textModel, visionModel: read(env, `${prefix}_VISION_MODEL`), disableReasoning: flag(env, `${prefix}_DISABLE_REASONING`) });
  }
  return { providers, skipped, limits };
}
