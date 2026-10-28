import type { IssueExplanation, LlmPartStatus } from "../agent-schema.js";
import { BudgetExhaustedError } from "../llm/budget.js";
import type { LlmClient } from "../llm/client.js";
import { AllProvidersFailedError } from "../llm/errors.js";
import { structuredCall } from "../llm/structured.js";
import type { TraceSink } from "../llm/trace.js";
import { EXPLAINER_PROMPT_VERSION, EXPLAINER_SYSTEM_PROMPT, explainerOutputSchema } from "../prompts/explainer.js";
import { untrusted } from "../prompts/untrusted.js";
import type { Finding, Issue } from "../report-schema.js";
import { describeBudget } from "./altReviewer.js";

export const MAX_EXPLAINED_ISSUES = 15;
const MAX_TOKENS = 6000;

// Our own checks have no axe description, so the model gets one from code.
// Same reason as everywhere else: facts come from us, wording from the model.
const OWN_RULES: Record<string, { help: string; description: string }> = {
  "a11y-keyboard-trap": { help: "Keyboard focus must not get trapped", description: "Pressing Tab keeps focus cycling inside a small group of elements, so keyboard users cannot reach the rest of the page." },
  "a11y-unreachable": { help: "Interactive elements must be reachable with the keyboard", description: "An element that responds to mouse clicks never receives keyboard focus, so keyboard users cannot use it." },
  "a11y-focus-visible": { help: "Focused elements must show a visible focus indicator", description: "When this element receives keyboard focus, nothing on screen changes, so keyboard users cannot see where they are." },
  "a11y-alt-quality": { help: "Alt text must describe the image", description: "The image has alt text, but it does not describe the image (for example a file name or a generic word), so screen reader users miss its content." },
};

function ruleInfo(issue: Issue, findings: Map<string, Finding>): { help: string | null; description: string | null } {
  const own = OWN_RULES[issue.ruleId];
  if (own) return own;
  const first = findings.get(issue.findingIds[0] ?? "");
  const description = typeof first?.data.description === "string" ? first.data.description : null;
  return { help: issue.help, description };
}

export function buildExplainerInput(issues: Issue[], findings: Finding[]): { keys: string[]; content: string } {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const items = issues.map((issue, i) => {
    const info = ruleInfo(issue, byId);
    return {
      key: `I${i + 1}`,
      ruleId: issue.ruleId,
      impact: issue.impact,
      occurrences: issue.occurrenceCount,
      pages: issue.pageCount,
      wcag: issue.wcag,
      help: info.help,
      description: info.description,
      // The one piece of page content: delimited, short, and never trusted.
      exampleHtml: issue.exampleHtml ? untrusted(issue.exampleHtml, 400) : null,
    };
  });
  return { keys: items.map((i) => i.key), content: `Issues:\n${JSON.stringify(items, null, 2)}` };
}

export interface ExplainResult {
  status: LlmPartStatus;
  // Keyed by issue id.
  explanations: Map<string, IssueExplanation>;
}

// One batched structured call for the top issues: 1 call instead of 15, and
// the model sees all issues together so titles don't repeat each other.
export async function explainIssues(issues: Issue[], findings: Finding[], deps: { client: LlmClient; sink: TraceSink }): Promise<ExplainResult> {
  const top = issues.slice(0, MAX_EXPLAINED_ISSUES);
  const explanations = new Map<string, IssueExplanation>();
  if (top.length === 0) return { status: { status: "ok", reason: null }, explanations };

  const { keys, content } = buildExplainerInput(top, findings);
  try {
    const { value } = await structuredCall(deps.client, explainerOutputSchema(keys), {
      label: "explain_issues",
      promptVersion: EXPLAINER_PROMPT_VERSION,
      maxTokens: MAX_TOKENS,
      trace: deps.sink.forAgent("explainer"),
      messages: [
        { role: "system", content: EXPLAINER_SYSTEM_PROMPT },
        { role: "user", content },
      ],
    });
    for (const item of value.issues) {
      const issue = top[keys.indexOf(item.key)];
      if (!issue || explanations.has(issue.id)) continue;
      explanations.set(issue.id, { title: item.title, explanation: item.explanation, whoIsAffected: item.whoIsAffected, howToFix: item.howToFix });
    }
    return { status: { status: "ok", reason: null }, explanations };
  } catch (err) {
    if (err instanceof BudgetExhaustedError) return { status: { status: "unavailable", reason: describeBudget(err) }, explanations };
    if (err instanceof AllProvidersFailedError) return { status: { status: "unavailable", reason: err.message.slice(0, 500) }, explanations };
    throw err;
  }
}
