import { APIConnectionError, APIError } from "openai";

// Why one provider attempt failed, and whether to stop using that provider
// for the rest of the scan. Every failure moves on to the next provider; the
// "disable" flag only decides whether later calls in this scan try it again.
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status: number | null,
    // A rate limit or a bad key won't fix itself within one scan, so retrying
    // that provider on every later call would just burn the call budget.
    readonly disable: boolean,
  ) {
    super(`${provider}: ${message}`);
    this.name = "ProviderError";
  }
}

export class AllProvidersFailedError extends Error {
  constructor(readonly failures: string[]) {
    super(failures.length ? `All LLM providers failed: ${failures.join("; ")}` : "No LLM provider is configured for this call");
    this.name = "AllProvidersFailedError";
  }
}

export function toProviderError(provider: string, err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof APIConnectionError) {
    // Includes APIConnectionTimeoutError: the 20 s timeout.
    return new ProviderError(provider, err.message || "connection failed", null, false);
  }
  if (err instanceof APIError) {
    const status = err.status ?? null;
    const message = (err.message || "API error").slice(0, 300);
    // Gemini answers an invalid key with 400 API_KEY_INVALID, not 401.
    const badKey = status === 400 && /api[ _-]?key/i.test(message);
    const disable = status === 401 || status === 403 || status === 404 || status === 429 || badKey;
    return new ProviderError(provider, message, status, disable);
  }
  return new ProviderError(provider, err instanceof Error ? err.message : String(err), null, false);
}
