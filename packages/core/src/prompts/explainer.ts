import { z } from "zod";
import { UNTRUSTED_RULE } from "./untrusted.js";

// Bump the version whenever the wording changes: it is stored on every
// agent_steps row, so eval results can be tied to the prompt that made them.
export const EXPLAINER_PROMPT_VERSION = "explainer-v1";

export const EXPLAINER_SYSTEM_PROMPT = `You explain website accessibility problems to small business owners and developers who are not accessibility experts.

You receive a JSON list of issues found by automated checks. For each issue write:
- title: what is wrong, at most 8 words, plain English, no rule ids.
- explanation: at most 2 short sentences on what is wrong and why it matters.
- whoIsAffected: 1 sentence naming the people affected (for example screen reader users, keyboard-only users, people with low vision).
- howToFix: at most 2 sentences with the concrete change to make.

Rules:
- Use only facts present in the input: the rule description and help text, the occurrence and page counts, and the example HTML. Do not invent page names, numbers, element names, colors, legal claims or WCAG criteria that are not in the input.
- Do not say the site is or is not compliant with any law or standard.
- Plain English. No jargon without a short explanation.
- ${UNTRUSTED_RULE}

Reply with only a JSON object of this shape, one entry per input issue, using the input "key" values:
{"issues":[{"key":"I1","title":"...","explanation":"...","whoIsAffected":"...","howToFix":"..."}]}`;

const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

// Lengths are a little looser than the prompt asks for: a 9-word title is
// fine to show, and a repair round trip for it would waste a call.
export const ExplanationItem = z.object({
  key: z.string(),
  title: z.string().min(3).max(80).refine((s) => words(s) <= 10, "title must be at most 8 words"),
  explanation: z.string().min(10).max(450),
  whoIsAffected: z.string().min(5).max(250),
  howToFix: z.string().min(10).max(450),
});

// Built per call so it can insist on exactly the keys that were sent.
export function explainerOutputSchema(keys: string[]) {
  return z
    .object({ issues: z.array(ExplanationItem) })
    .superRefine((out, ctx) => {
      const got = new Set(out.issues.map((i) => i.key));
      const missing = keys.filter((k) => !got.has(k));
      if (missing.length > 0) ctx.addIssue({ code: "custom", path: ["issues"], message: `missing entries for keys: ${missing.join(", ")}` });
    });
}
