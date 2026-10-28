// One Budget per scan. Every LLM attempt reserves a call before it goes out,
// including attempts that end in a 429, because the spec's "calls per scan"
// is about how hard we hit free tiers, not how many answers we got back.

export type BudgetLimit = "scan_calls" | "scan_output_tokens" | "daily_cap";

export class BudgetExhaustedError extends Error {
  constructor(readonly limit: BudgetLimit) {
    super(`LLM budget exhausted (${limit})`);
    this.name = "BudgetExhaustedError";
  }
}

export interface BudgetOptions {
  maxCalls: number;
  maxOutputTokens: number;
  // DAILY_LLM_CALL_CAP minus calls already made today across all scans.
  dailyRemaining: number;
}

export class Budget {
  private calls = 0;
  private outputTokens = 0;
  private inputTokens = 0;

  constructor(private readonly options: BudgetOptions) {}

  // Which limit would stop the next call, or null if one more is allowed.
  blockedBy(): BudgetLimit | null {
    if (this.calls >= this.options.dailyRemaining) return "daily_cap";
    if (this.calls >= this.options.maxCalls) return "scan_calls";
    if (this.outputTokens >= this.options.maxOutputTokens) return "scan_output_tokens";
    return null;
  }

  get exhausted(): boolean {
    return this.blockedBy() !== null;
  }

  // Throws instead of returning false so a caller can't forget to check.
  reserveCall(): void {
    const limit = this.blockedBy();
    if (limit) throw new BudgetExhaustedError(limit);
    this.calls += 1;
  }

  recordUsage(tokensIn: number, tokensOut: number): void {
    this.inputTokens += tokensIn;
    this.outputTokens += tokensOut;
  }

  // Caps a single call's max_tokens so one long reply can't overshoot the
  // scan's token budget by more than that reply.
  remainingOutputTokens(): number {
    return Math.max(0, this.options.maxOutputTokens - this.outputTokens);
  }

  usage(): { calls: number; tokensIn: number; tokensOut: number } {
    return { calls: this.calls, tokensIn: this.inputTokens, tokensOut: this.outputTokens };
  }
}
