import type { AltReview } from "../agent-schema.js";
import { BudgetExhaustedError } from "../llm/budget.js";
import type { LlmClient } from "../llm/client.js";
import { AllProvidersFailedError } from "../llm/errors.js";
import { structuredCall } from "../llm/structured.js";
import type { TraceSink } from "../llm/trace.js";
import type { Logger } from "../logger.js";
import { ALT_REVIEWER_PROMPT_VERSION, ALT_REVIEWER_SYSTEM_PROMPT, AltReviewOutput } from "../prompts/altReviewer.js";
import { untrusted } from "../prompts/untrusted.js";
import type { CapturedImage } from "../scanner/imageCapture.js";

export interface AltReviewInput {
  src: string;
  alt: string;
  surroundingText: string;
  inLink: boolean;
}

export type AltReviewOutcome =
  | { status: "reviewed"; review: AltReview }
  | { status: "skipped"; reason: string }
  // Budget gone: later images won't fare better.
  | { status: "stopped"; reason: string };

export interface AltReviewDeps {
  client: LlmClient;
  sink: TraceSink;
  log: Logger;
  capture: (src: string) => Promise<CapturedImage | null>;
}

// Plenty for three short JSON fields; reasoning models need the headroom.
const MAX_TOKENS = 1500;

// One vision call per image. No tools, no loop: the reviewer sees the image
// and its context once and returns a verdict. Code decides what the verdict
// means (only poor / should_be_decorative become findings).
export async function reviewAltText(input: AltReviewInput, deps: AltReviewDeps): Promise<AltReviewOutcome> {
  const trace = deps.sink.forAgent("alt_reviewer");
  const image = await deps.capture(input.src);
  trace.record({
    kind: "tool",
    name: "capture_image",
    input: { src: input.src },
    output: image ? { width: image.width, height: image.height } : null,
    error: image ? null : "image could not be loaded",
    provider: null, model: null, promptVersion: null, tokensIn: null, tokensOut: null, latencyMs: null,
  });
  if (!image) return { status: "skipped", reason: "image could not be loaded" };

  const context = [
    `Current alt text: ${untrusted(JSON.stringify(input.alt), 300)}`,
    `Inside a link: ${input.inLink ? "yes" : "no"}`,
    `Nearby page text: ${untrusted(input.surroundingText || "(none)", 300)}`,
  ].join("\n");

  try {
    const { value } = await structuredCall(deps.client, AltReviewOutput, {
      label: "review_alt_text",
      vision: true,
      promptVersion: ALT_REVIEWER_PROMPT_VERSION,
      maxTokens: MAX_TOKENS,
      trace,
      messages: [
        { role: "system", content: ALT_REVIEWER_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: context },
            { type: "image_url", image_url: { url: image.dataUrl } },
          ],
        },
      ],
    });
    // Decorative means alt="": don't let a stray suggestion through.
    const review = value.verdict === "should_be_decorative" ? { ...value, suggestedAlt: "" } : value;
    return { status: "reviewed", review };
  } catch (err) {
    if (err instanceof BudgetExhaustedError) return { status: "stopped", reason: describeBudget(err) };
    if (err instanceof AllProvidersFailedError) {
      deps.log.warn("alt review failed on every provider", { src: input.src, error: err.message });
      return { status: "skipped", reason: "every LLM provider failed" };
    }
    throw err;
  }
}

export function describeBudget(err: BudgetExhaustedError): string {
  switch (err.limit) {
    case "daily_cap":
      return "daily LLM call cap reached";
    case "scan_calls":
      return "per-scan LLM call budget used up";
    case "scan_output_tokens":
      return "per-scan output token budget used up";
  }
}
