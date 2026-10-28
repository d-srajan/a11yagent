import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { z } from "zod";
import { AllProvidersFailedError, ProviderError } from "./errors.js";
import type { ChatRequest, LlmClient } from "./client.js";

// Models wrap JSON in ```json fences or add a sentence before it, even in
// JSON mode on some providers. Take the outermost {...} and parse that.
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) throw new Error("no JSON object in the reply");
  return JSON.parse(text.slice(start, end + 1));
}

// Short, model-readable list of what was wrong, e.g.
// "issues.2.title: Too big: expected string to have <=60 characters".
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 10)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

export function parseStructured<T extends z.ZodType>(schema: T, text: string | null): { ok: true; value: z.infer<T> } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJson(text ?? "");
  } catch (err) {
    return { ok: false, error: `Reply was not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: formatZodError(parsed.error) };
}

export interface StructuredResult<T> {
  value: T;
  provider: string;
  model: string;
}

// One structured call with the spec's fallback rule: per provider, parse and
// validate; on failure send ONE repair turn with the exact errors; if the
// repair also fails, treat it like any provider failure and move on.
export async function structuredCall<T extends z.ZodType>(
  client: LlmClient,
  schema: T,
  request: Omit<ChatRequest, "json">,
): Promise<StructuredResult<z.infer<T>>> {
  const failures: string[] = [];
  for (const provider of client.providersFor(request.vision ?? false)) {
    try {
      const first = await client.callProvider(provider, { ...request, json: true });
      const parsed = parseStructured(schema, first.message.content);
      if (parsed.ok) return { value: parsed.value, provider: first.provider, model: first.model };

      // The repair turn shows the model its own reply plus the errors. Cheaper
      // and more reliable than asking a different model from scratch.
      const repairMessages: ChatCompletionMessageParam[] = [
        ...request.messages,
        { role: "assistant", content: first.message.content ?? "" },
        { role: "user", content: `Your reply did not match the required JSON schema:\n${parsed.error}\nReply again with only the corrected JSON object.` },
      ];
      const second = await client.callProvider(provider, { ...request, label: `${request.label}:repair`, messages: repairMessages, json: true });
      const repaired = parseStructured(schema, second.message.content);
      if (repaired.ok) return { value: repaired.value, provider: second.provider, model: second.model };
      failures.push(`${provider.name}: invalid output after repair (${repaired.error.split("\n")[0]})`);
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      failures.push(err.message);
    }
  }
  throw new AllProvidersFailedError(failures);
}

// JSON Schema for prompts and tool definitions, generated from zod so the
// schema the model sees can never drift from the one we validate with.
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  // $schema is noise to a model, and some providers reject unknown keys.
  const json = { ...(z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>) };
  delete json.$schema;
  return json;
}
